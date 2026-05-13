/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import OpenAI from 'https://esm.sh/openai@6.22.0';
import { sendBichoNotification } from '../_shared/notify.ts';
import { createAdminClient } from '../_shared/supabase.ts';

const MADRID_TIME_ZONE = 'Europe/Madrid';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_OBRA_STATES = ['abierta', 'en_curso', 'activa'];
const HOURLY_COST = 32;
const MARGIN_RISK_THRESHOLD = 0.8;
const DEFAULT_BUSINESS_ID = 'pino';
const OPENAI_TIMEOUT_MS = 8000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type Urgency = 'alta' | 'media' | 'baja';

type ObraRow = {
  id: string;
  business_id: string;
  nombre: string;
  estado: string;
  direccion?: string | null;
  cliente_id?: string | null;
  fecha_inicio?: string | null;
  fecha_fin: string | null;
  descripcion?: string | null;
};

type JornadaRow = {
  obra_id: string | null;
  fecha?: string | null;
  horas_reales?: number | string | null;
  horas_convenio?: number | string | null;
  notas?: string | null;
  operario_id?: string | null;
};

type PresupuestoRow = {
  id?: string;
  obra_id: string | null;
  fecha?: string | null;
  estado?: string | null;
  importe_total: number | string | null;
  cliente_nombre?: string | null;
  mensaje_cliente?: string | null;
  presupuesto_generado?: string | null;
  numero_presupuesto?: string | null;
  es_extra?: boolean | null;
  created_at?: string | null;
};

type FacturaRow = {
  obra_id: string | null;
};

type DiarioRow = {
  id: string;
  obra_id: string | null;
  fecha: string | null;
  texto: string | null;
  fotos?: string[] | null;
  videos?: string[] | null;
};

type ContextoObra = {
  id: string;
  business_id: string;
  nombre: string;
  estado: string;
  direccion: string | null;
  cliente_id: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  descripcion: string | null;
  registros_jornada_ultimos_7_dias: {
    total_registros: number;
    total_horas_reales: number;
    total_horas_convenio: number;
    registros: Array<{
      fecha: string | null;
      operario_id: string | null;
      horas_reales: number;
      horas_convenio: number;
      notas: string | null;
    }>;
  };
  presupuesto: {
    id: string | null;
    fecha: string | null;
    estado: string | null;
    importe_total: number;
    cliente_nombre: string | null;
    numero_presupuesto: string | null;
    es_extra: boolean;
    mensaje_cliente: string | null;
    resumen: string | null;
  } | null;
  diario: Array<{
    id: string;
    fecha: string | null;
    texto: string | null;
    fotos_count: number;
    videos_count: number;
  }>;
};

type ContextoObras = {
  generated_at: string;
  desde: string;
  total_obras: number;
  obras: ContextoObra[];
};

type BichoReasoning = {
  model: string;
  content: string;
};

type Anomaly = {
  business_id: string;
  obra_id: string;
  type: 'obra_parada' | 'margen_riesgo' | 'factura_pendiente';
  category: 'inactividad' | 'rentabilidad' | 'facturacion';
  slug: string;
  urgency: Urgency;
  severity: Urgency;
  message: string;
  metadata: Record<string, unknown>;
};

type DailyCheckRequestBody = {
  business_id?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactText(value: string | null | undefined, maxLength = 240): string | null {
  const compacted = value?.replace(/\s+/g, ' ').trim();
  if (!compacted) return null;
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3).trimEnd()}...` : compacted;
}

function pushByObraId<T extends { obra_id: string | null }>(map: Map<string, T[]>, row: T) {
  if (!row.obra_id) return;
  const rows = map.get(row.obra_id) ?? [];
  rows.push(row);
  map.set(row.obra_id, rows);
}

async function buildContextoObras(
  adminClient: ReturnType<typeof createAdminClient>,
  activeObras: ObraRow[],
  sevenDaysAgo: string
): Promise<ContextoObras> {
  const obraIds = activeObras.map((obra) => obra.id);

  if (obraIds.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      desde: sevenDaysAgo,
      total_obras: 0,
      obras: [],
    };
  }

  const [jornadasResult, presupuestosResult, diarioResult] = await Promise.all([
    adminClient
      .from('registros_jornada')
      .select('obra_id, fecha, horas_reales, horas_convenio, notas, operario_id')
      .in('obra_id', obraIds)
      .gte('fecha', sevenDaysAgo)
      .order('fecha', { ascending: false }),
    adminClient
      .from('presupuestos')
      .select(
        'id, obra_id, fecha, estado, importe_total, cliente_nombre, mensaje_cliente, presupuesto_generado, numero_presupuesto, es_extra, created_at'
      )
      .in('obra_id', obraIds)
      .order('created_at', { ascending: false }),
    adminClient
      .from('diario_obra')
      .select('id, obra_id, fecha, texto, fotos, videos')
      .in('obra_id', obraIds)
      .order('fecha', { ascending: false }),
  ]);

  if (jornadasResult.error) {
    throw new Error(`Error cargando contexto de registros_jornada: ${jornadasResult.error.message}`);
  }

  if (presupuestosResult.error) {
    throw new Error(`Error cargando contexto de presupuestos: ${presupuestosResult.error.message}`);
  }

  if (diarioResult.error) {
    throw new Error(`Error cargando contexto de diario_obra: ${diarioResult.error.message}`);
  }

  const jornadasPorObra = new Map<string, JornadaRow[]>();
  for (const row of (jornadasResult.data ?? []) as JornadaRow[]) {
    pushByObraId(jornadasPorObra, row);
  }

  const presupuestosPorObra = new Map<string, PresupuestoRow[]>();
  for (const row of (presupuestosResult.data ?? []) as PresupuestoRow[]) {
    pushByObraId(presupuestosPorObra, row);
  }

  const diarioPorObra = new Map<string, DiarioRow[]>();
  for (const row of (diarioResult.data ?? []) as DiarioRow[]) {
    pushByObraId(diarioPorObra, row);
  }

  return {
    generated_at: new Date().toISOString(),
    desde: sevenDaysAgo,
    total_obras: activeObras.length,
    obras: activeObras.map((obra) => {
      const registros = jornadasPorObra.get(obra.id) ?? [];
      const presupuesto = presupuestosPorObra.get(obra.id)?.[0] ?? null;
      const diario = (diarioPorObra.get(obra.id) ?? []).slice(0, 3);

      return {
        id: obra.id,
        business_id: obra.business_id,
        nombre: obra.nombre,
        estado: obra.estado,
        direccion: obra.direccion ?? null,
        cliente_id: obra.cliente_id ?? null,
        fecha_inicio: obra.fecha_inicio ?? null,
        fecha_fin: obra.fecha_fin,
        descripcion: compactText(obra.descripcion),
        registros_jornada_ultimos_7_dias: {
          total_registros: registros.length,
          total_horas_reales: registros.reduce(
            (total, registro) => total + toNumber(registro.horas_reales),
            0
          ),
          total_horas_convenio: registros.reduce(
            (total, registro) => total + toNumber(registro.horas_convenio),
            0
          ),
          registros: registros.map((registro) => ({
            fecha: registro.fecha ?? null,
            operario_id: registro.operario_id ?? null,
            horas_reales: toNumber(registro.horas_reales),
            horas_convenio: toNumber(registro.horas_convenio),
            notas: compactText(registro.notas),
          })),
        },
        presupuesto: presupuesto
          ? {
              id: presupuesto.id ?? null,
              fecha: presupuesto.fecha ?? null,
              estado: presupuesto.estado ?? null,
              importe_total: toNumber(presupuesto.importe_total),
              cliente_nombre: presupuesto.cliente_nombre ?? null,
              numero_presupuesto: presupuesto.numero_presupuesto ?? null,
              es_extra: Boolean(presupuesto.es_extra),
              mensaje_cliente: compactText(presupuesto.mensaje_cliente),
              resumen: compactText(presupuesto.presupuesto_generado),
            }
          : null,
        diario: diario.map((entrada) => ({
          id: entrada.id,
          fecha: entrada.fecha ?? null,
          texto: compactText(entrada.texto),
          fotos_count: entrada.fotos?.length ?? 0,
          videos_count: entrada.videos?.length ?? 0,
        })),
      };
    }),
  };
}

async function runBichoReasoning(contexto_obras: ContextoObras): Promise<BichoReasoning | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');

  if (!apiKey) {
    console.error('[bicho-daily-check] Missing OPENAI_API_KEY, skipping reasoning layer');
    return null;
  }

  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';
  const openai = new OpenAI({ apiKey });
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), OPENAI_TIMEOUT_MS);

  try {
    const completion = await openai.chat.completions.create(
      {
        model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content:
              "Eres El Bicho, el asistente experto de Pino, un albañil autónomo del País Vasco. Tu objetivo es la rentabilidad y la paz mental de Pino. Analiza estos datos de sus obras activas y devuelve EXACTAMENTE un array JSON con máximo 3 insights.\nCada insight debe tener:\n- insight_text: texto humano y directo (max 100 chars)\n- ai_reasoning: explicación del porqué (max 200 chars)\n- urgency: 'alta' | 'media' | 'baja'\n- category: 'inactividad' | 'rentabilidad' | 'facturacion'\n- obra_id: el ID de la obra afectada\n\nRegla de Oro: Si todo va bien devuelve [].\nNo inventes problemas. Solo devuelve JSON puro.",
          },
          {
            role: 'user',
            content: JSON.stringify({ contexto_obras }),
          },
        ],
      },
      { signal: timeoutController.signal }
    );

    const rawContent = completion.choices[0]?.message?.content?.trim() ?? '';
    const content = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try {
      if (content) JSON.parse(content);
    } catch (error) {
      console.error('[bicho-daily-check] Error parseando respuesta del Brain', error);
      return null;
    }
    return content ? { model, content } : null;
  } catch (error) {
    if (timeoutController.signal.aborted) {
      console.error('[bicho-daily-check] Brain timeout, continúa sin Brain');
      return null;
    }
    console.error('[bicho-daily-check] Error en capa de razonamiento', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function resolveBusinessId(body: DailyCheckRequestBody | null): string {
  const requestedBusinessId = body?.business_id?.trim();
  return requestedBusinessId || DEFAULT_BUSINESS_ID;
}

async function readRequestBody(req: Request): Promise<DailyCheckRequestBody | null> {
  if (req.method !== 'POST') return null;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;

  const body = (await req.json().catch(() => null)) as DailyCheckRequestBody | null;
  return body && typeof body === 'object' ? body : null;
}

async function runDailyCheck(businessId: string) {
  const adminClient = createAdminClient();
  const now = new Date();
  const fecha = formatYmdInTimeZone(now, MADRID_TIME_ZONE);
  const sevenDaysAgo = formatYmdInTimeZone(
    new Date(now.getTime() - 7 * ONE_DAY_MS),
    MADRID_TIME_ZONE
  );
  const sevenDaysAhead = formatYmdInTimeZone(
    new Date(now.getTime() + 7 * ONE_DAY_MS),
    MADRID_TIME_ZONE
  );

  const { data: obras, error: obrasError } = await adminClient
    .from('obras')
    .select('id, business_id, nombre, cliente_id, direccion, estado, fecha_inicio, fecha_fin, descripcion')
    .in('estado', ACTIVE_OBRA_STATES);

  if (obrasError) {
    throw new Error(`Error cargando obras: ${obrasError.message}`);
  }

  const activeObras = (obras ?? []) as ObraRow[];
  const obraIds = activeObras.map((obra) => obra.id);
  const marginObraIds = activeObras
    .filter((obra) => obra.estado === 'activa')
    .map((obra) => obra.id);

  const contexto_obras = await buildContextoObras(adminClient, activeObras, sevenDaysAgo);
  console.log(contexto_obras);
  const razonamiento_bicho = await runBichoReasoning(contexto_obras);
  console.log({ razonamiento_bicho });

  if (obraIds.length === 0) {
    return {
      fecha,
      checked_obras: 0,
      business_id: businessId,
      anomalies: 0,
      inserted: 0,
      notified: 0,
      errors: [],
    };
  }

  const { data: recentJornadas, error: recentJornadasError } = await adminClient
    .from('registros_jornada')
    .select('obra_id, fecha')
    .in('obra_id', obraIds)
    .gte('fecha', sevenDaysAgo);

  if (recentJornadasError) {
    throw new Error(
      `Error cargando registros_jornada recientes: ${recentJornadasError.message}`
    );
  }

  const { data: jornadas, error: jornadasError } = await adminClient
    .from('registros_jornada')
    .select('obra_id, horas_reales')
    .in('obra_id', obraIds);

  if (jornadasError) {
    throw new Error(`Error cargando horas reales: ${jornadasError.message}`);
  }

  let presupuestos: PresupuestoRow[] = [];
  if (marginObraIds.length > 0) {
    const { data: presupuestosData, error: presupuestosError } = await adminClient
      .from('presupuestos')
      .select('obra_id, importe_total')
      .in('obra_id', marginObraIds);

    if (presupuestosError) {
      throw new Error(`Error cargando presupuestos: ${presupuestosError.message}`);
    }

    presupuestos = (presupuestosData ?? []) as PresupuestoRow[];
  }

  const { data: facturas, error: facturasError } = await adminClient
    .from('facturas')
    .select('obra_id')
    .in('obra_id', obraIds);

  if (facturasError) {
    throw new Error(`Error cargando facturas: ${facturasError.message}`);
  }

  const obrasConJornadaReciente = new Set(
    ((recentJornadas ?? []) as JornadaRow[])
      .map((row) => row.obra_id)
      .filter((obraId): obraId is string => Boolean(obraId))
  );

  const horasPorObra = new Map<string, number>();
  for (const row of (jornadas ?? []) as JornadaRow[]) {
    if (!row.obra_id) continue;
    const horas = Number(row.horas_reales ?? 0);
    horasPorObra.set(row.obra_id, (horasPorObra.get(row.obra_id) ?? 0) + horas);
  }

  const importePresupuestoPorObra = new Map<string, number>();
  for (const row of presupuestos) {
    if (!row.obra_id) continue;
    const importeTotal = Number(row.importe_total ?? 0);
    if (importeTotal <= 0) continue;
    const currentImporte = importePresupuestoPorObra.get(row.obra_id) ?? 0;
    importePresupuestoPorObra.set(row.obra_id, Math.max(currentImporte, importeTotal));
  }

  const obrasConFactura = new Set(
    ((facturas ?? []) as FacturaRow[])
      .map((row) => row.obra_id)
      .filter((obraId): obraId is string => Boolean(obraId))
  );

  const anomalies: Anomaly[] = [];

  for (const obra of activeObras) {
    if (!obrasConJornadaReciente.has(obra.id)) {
      anomalies.push({
        business_id: businessId,
        obra_id: obra.id,
        type: 'obra_parada',
        category: 'inactividad',
        slug: `${businessId}-obra-parada-${obra.id}-${fecha}`,
        urgency: 'media',
        severity: 'media',
        message: `La obra "${obra.nombre}" no tiene registros de jornada en los últimos 7 días.`,
        metadata: {
          fecha,
          obra_nombre: obra.nombre,
          seven_days_ago: sevenDaysAgo,
        },
      });
    }

    const importeTotal = importePresupuestoPorObra.get(obra.id) ?? 0;
    const horasReales = horasPorObra.get(obra.id) ?? 0;
    const costeHoras = horasReales * HOURLY_COST;

    if (
      obra.estado === 'activa' &&
      importeTotal > 0 &&
      costeHoras > importeTotal * MARGIN_RISK_THRESHOLD
    ) {
      anomalies.push({
        business_id: businessId,
        obra_id: obra.id,
        type: 'margen_riesgo',
        category: 'rentabilidad',
        slug: `${businessId}-margen-riesgo-${obra.id}-${fecha}`,
        urgency: 'alta',
        severity: 'alta',
        message: `La obra "${obra.nombre}" acumula ${formatMoney(
          costeHoras
        )} en horas reales, por encima del 80% de ${formatMoney(importeTotal)}.`,
        metadata: {
          fecha,
          obra_nombre: obra.nombre,
          horas_reales: horasReales,
          coste_horas: costeHoras,
          importe_total: importeTotal,
          threshold: MARGIN_RISK_THRESHOLD,
          hourly_cost: HOURLY_COST,
        },
      });
    }

    if (obra.fecha_fin && obra.fecha_fin <= sevenDaysAhead && !obrasConFactura.has(obra.id)) {
      anomalies.push({
        business_id: businessId,
        obra_id: obra.id,
        type: 'factura_pendiente',
        category: 'facturacion',
        slug: `${businessId}-factura-pendiente-${obra.id}-${fecha}`,
        urgency: 'alta',
        severity: 'alta',
        message: `La obra "${obra.nombre}" termina el ${obra.fecha_fin} y no tiene factura asociada.`,
        metadata: {
          fecha,
          obra_nombre: obra.nombre,
          fecha_fin: obra.fecha_fin,
          seven_days_ahead: sevenDaysAhead,
        },
      });
    }
  }

  const errors: Array<{ slug: string; error: string }> = [];
  let inserted = 0;
  let notified = 0;

  for (const anomaly of anomalies) {
    const contentHash = await sha256(
      JSON.stringify({
        type: anomaly.type,
        slug: anomaly.slug,
        message: anomaly.message,
        metadata: anomaly.metadata,
      })
    );

    const { error: insertError } = await adminClient.from('perfilio_insights').insert({
      business_id: anomaly.business_id,
      obra_id: anomaly.obra_id,
      type: anomaly.type,
      category: anomaly.category,
      severity: anomaly.severity,
      insight_text: anomaly.message,
      status: 'pendiente',
      slug: anomaly.slug,
      content_hash: contentHash,
      urgency: anomaly.urgency,
      message: anomaly.message,
      metadata: anomaly.metadata,
    });

    if (insertError) {
      errors.push({ slug: anomaly.slug, error: insertError.message });
      continue;
    }

    inserted += 1;

    const wasNotified = await sendBichoNotification(adminClient, {
      message: anomaly.message,
      urgency: anomaly.urgency,
      type: anomaly.type,
      slug: anomaly.slug,
      business_id: anomaly.business_id,
      content_hash: contentHash,
      metadata: anomaly.metadata,
    });

    if (wasNotified) {
      notified += 1;
    }
  }

  return {
    fecha,
    business_id: businessId,
    checked_obras: activeObras.length,
    anomalies: anomalies.length,
    inserted,
    notified,
    errors,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await readRequestBody(req);
    const businessId = resolveBusinessId(body);
    const result = await runDailyCheck(businessId);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    console.error('[bicho-daily-check]', error);
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});
