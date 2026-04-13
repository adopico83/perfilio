import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';

function escapeIlikePattern(s: string): string {
  return s.replace(/[%_*]/g, '');
}

function ymdTodayMadrid(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function parseYmdOptional(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function mesActualYyyyMmMadrid(): string {
  return ymdTodayMadrid().slice(0, 7);
}

function parseMesYyyyMm(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return mesActualYyyyMmMadrid();
}

function boundsForMonth(yyyyMm: string): { start: string; end: string } {
  const [yStr, moStr] = yyyyMm.split('-');
  const y = Number(yStr);
  const mo = Number(moStr);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    const fallback = mesActualYyyyMmMadrid();
    return boundsForMonth(fallback);
  }
  const start = `${yStr}-${moStr}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const end = `${yStr}-${moStr}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function parseHoras(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseFloat(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function buscarOperariosPorNombre(
  supabase: SupabaseClient,
  businessId: string,
  fragmento: string
): Promise<
  | { ok: true; filas: Array<{ id: string; nombre: string; coste_hora: number | null }> }
  | { ok: false; error: string }
> {
  const safe = escapeIlikePattern(fragmento).trim();
  if (safe.length < 1) {
    return { ok: false, error: 'operario_nombre es obligatorio' };
  }
  const pat = `%${safe}%`;
  const { data, error } = await supabase
    .from('operarios')
    .select('id, nombre, coste_hora')
    .eq('business_id', businessId)
    .eq('activo', true)
    .ilike('nombre', pat)
    .order('nombre', { ascending: true })
    .limit(20);
  if (error) return { ok: false, error: error.message };
  const filas = (data ?? []) as Array<{
    id: string;
    nombre: string | null;
    coste_hora: number | null;
  }>;
  return {
    ok: true,
    filas: filas.map((r) => ({
      id: r.id,
      nombre: String(r.nombre ?? '').trim() || 'Sin nombre',
      coste_hora: r.coste_hora ?? null,
    })),
  };
}

export const OPERARIOS_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'registrar_jornada',
      description:
        'Registra o actualiza horas de un operario en una obra. Mismo flujo SDD que los gastos: primera llamada con solo_vista_previa true (solo resumen, pendiente_confirmacion); cuando el usuario confirme, segunda llamada con solo_vista_previa false u omitido para guardar. Si ya existe un registro para el mismo operario, obra y fecha, el servidor hace UPDATE en lugar de insertar otro (las correcciones sustituyen el registro). Si solo hay un número de horas, usa horas o horas_reales y deja horas_convenio vacío para copiar el mismo valor. Si el usuario distingue reales vs convenio/nómina, envía ambos.',
      parameters: {
        type: 'object',
        properties: {
          operario_nombre: {
            type: 'string',
            description: 'Nombre o fragmento del operario (p. ej. Ale, Alejandro)',
          },
          obra_nombre: {
            type: 'string',
            description: 'Nombre o texto para identificar la obra (opcional si hay obra_id)',
          },
          obra_id: { type: 'string', description: 'UUID de la obra si se conoce' },
          fecha: {
            type: 'string',
            description: 'Fecha YYYY-MM-DD; por defecto hoy en Europa/Madrid',
          },
          horas: {
            type: 'number',
            description: 'Horas únicas (reales y convenio iguales) si el usuario no distingue',
          },
          horas_reales: { type: 'number', description: 'Horas efectivas en obra' },
          horas_convenio: {
            type: 'number',
            description: 'Horas de convenio/nómina; omitir para copiar horas_reales u horas',
          },
          notas: { type: 'string', description: 'Notas opcionales' },
          solo_vista_previa: {
            type: 'boolean',
            description:
              'True: solo muestra resumen y espera confirmación del usuario (no guarda en BD). False u omitido: guarda o actualiza el registro.',
          },
        },
        required: ['operario_nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_operarios',
      description: 'Lista los operarios activos del negocio (nombre, coste/hora si aplica).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_horas_obra',
      description:
        'Total de horas reales y de convenio agrupadas por operario en una obra concreta.',
      parameters: {
        type: 'object',
        properties: {
          obra_nombre: { type: 'string', description: 'Texto para identificar la obra' },
          obra_id: { type: 'string', description: 'UUID de la obra si se conoce' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_horas_operario',
      description:
        'Resumen mensual de un operario: totales de horas reales y convenio y detalle por día (útil para nómina). Mes en formato YYYY-MM; por defecto mes actual en Europa/Madrid.',
      parameters: {
        type: 'object',
        properties: {
          operario_nombre: { type: 'string', description: 'Nombre o fragmento del operario' },
          mes: { type: 'string', description: 'YYYY-MM opcional' },
        },
        required: ['operario_nombre'],
        additionalProperties: false,
      },
    },
  },
];

export async function ejecutarRegistrarJornada(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>,
  mensajeUsuario: string
): Promise<Record<string, unknown>> {
  const soloVista =
    toolArgs.solo_vista_previa === true ||
    String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';

  const operarioNombre = String(toolArgs.operario_nombre ?? '').trim();
  if (!operarioNombre) {
    return { error: 'operario_nombre es obligatorio' };
  }

  const opRes = await buscarOperariosPorNombre(supabase, businessId, operarioNombre);
  if (!opRes.ok) return { error: opRes.error };
  if (opRes.filas.length === 0) {
    return { error: `No encontré un operario activo que coincida con «${operarioNombre}».` };
  }
  if (opRes.filas.length > 1) {
    const lista = opRes.filas.map((o, i) => `${i + 1}. ${o.nombre}`).join('\n');
    return {
      mensaje: `Hay varios operarios que encajan:\n${lista}\nIndica el nombre completo o más concreto.`,
    };
  }
  const operario = opRes.filas[0]!;

  const obraNombreArg = String(toolArgs.obra_nombre ?? '').trim();
  const obraIdArg =
    typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
      ? toolArgs.obra_id.trim()
      : undefined;
  const textoBusqueda = [obraNombreArg, mensajeUsuario].filter(Boolean).join(' ').trim();
  const obraRes = await resolverObraDocumentoAgente(
    supabase,
    businessId,
    obraIdArg,
    textoBusqueda,
    'documento'
  );
  if (!obraRes.ok) return { mensaje: obraRes.mensaje };
  if (!obraRes.obra_id) {
    return { error: 'Indica la obra (nombre, dirección u obra_id) para registrar la jornada.' };
  }

  const fecha = parseYmdOptional(toolArgs.fecha) ?? ymdTodayMadrid();

  const hrFromReales = parseHoras(toolArgs.horas_reales);
  const hrFromHoras = parseHoras(toolArgs.horas);
  const hr = hrFromReales ?? hrFromHoras;
  if (hr == null || hr < 0) {
    return { error: 'Indica las horas (horas u horas_reales) con un número válido ≥ 0.' };
  }
  const hcRaw = toolArgs.horas_convenio;
  const hc =
    hcRaw === undefined || hcRaw === null || (typeof hcRaw === 'string' && !String(hcRaw).trim())
      ? hr
      : parseHoras(hcRaw);
  if (hc == null || hc < 0) {
    return { error: 'horas_convenio no es válido.' };
  }

  const notas =
    toolArgs.notas != null && String(toolArgs.notas).trim()
      ? String(toolArgs.notas).trim()
      : null;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const hrN = r2(hr);
  const hcN = r2(hc);

  const { data: obraRowPreview } = await supabase
    .from('obras')
    .select('nombre, direccion')
    .eq('id', obraRes.obra_id)
    .eq('business_id', businessId)
    .maybeSingle();

  const nombreObra =
    (obraRowPreview as { nombre?: string | null } | null)?.nombre?.trim() ||
    obraRes.obra_nombre?.trim() ||
    'Obra';
  const dir = String((obraRowPreview as { direccion?: string | null } | null)?.direccion ?? '').trim();
  const obraEtiqueta = dir ? `${nombreObra} - ${dir}` : nombreObra;

  const { data: registroExistente } = await supabase
    .from('registros_jornada')
    .select('id')
    .eq('business_id', businessId)
    .eq('operario_id', operario.id)
    .eq('obra_id', obraRes.obra_id)
    .eq('fecha', fecha)
    .maybeSingle();

  if (soloVista) {
    const lineas = [
      'Resumen de jornada (no guardado aún):',
      `• Operario: ${operario.nombre}`,
      `• Obra: ${obraEtiqueta}`,
      `• Fecha: ${fecha}`,
      `• Horas reales: ${hrN} h, horas convenio: ${hcN} h`,
    ];
    if (notas) lineas.push(`• Notas: ${notas}`);
    lineas.push(
      registroExistente?.id
        ? '• Ya existe un registro para este operario, obra y fecha: al confirmar se actualizará.'
        : '• Al confirmar se creará un registro nuevo.'
    );
    lineas.push('Pide confirmación explícita al usuario antes de guardar.');
    return {
      mensaje: lineas.join('\n'),
      pendiente_confirmacion: true,
    };
  }

  if (registroExistente?.id) {
    const { error: updErr } = await supabase
      .from('registros_jornada')
      .update({
        horas_reales: hrN,
        horas_convenio: hcN,
        notas,
      })
      .eq('id', registroExistente.id)
      .eq('business_id', businessId);

    if (updErr) {
      return { error: `No se pudo actualizar la jornada: ${updErr.message}` };
    }
    const mensaje = `Actualizado: ${operario.nombre} ${hrN}h reales (${hcN}h convenio) en ${obraEtiqueta}`;
    return { mensaje, actualizado: true, id: registroExistente.id };
  }

  const { data: insertado, error: insErr } = await supabase
    .from('registros_jornada')
    .insert({
      business_id: businessId,
      operario_id: operario.id,
      obra_id: obraRes.obra_id,
      fecha,
      horas_reales: hrN,
      horas_convenio: hcN,
      notas,
    })
    .select('id')
    .maybeSingle();

  if (insErr) {
    return { error: `No se pudo registrar la jornada: ${insErr.message}` };
  }

  const mensaje = `Registrado: ${operario.nombre} ${hrN}h reales (${hcN}h convenio) en ${obraEtiqueta}`;
  return { mensaje, id: (insertado as { id?: string } | null)?.id ?? null };
}

export async function ejecutarListarOperarios(
  supabase: SupabaseClient,
  businessId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('operarios')
    .select('id, nombre, coste_hora, activo')
    .eq('business_id', businessId)
    .eq('activo', true)
    .order('nombre', { ascending: true });
  if (error) return { error: error.message };
  return {
    items: (data ?? []).map((r: { id: string; nombre?: string | null; coste_hora?: number | null }) => ({
      id: r.id,
      nombre: r.nombre ?? null,
      coste_hora: r.coste_hora ?? null,
      activo: true,
    })),
  };
}

export async function ejecutarConsultarHorasObra(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>,
  mensajeUsuario: string
): Promise<Record<string, unknown>> {
  const obraNombreArg = String(toolArgs.obra_nombre ?? '').trim();
  const obraIdArg =
    typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
      ? toolArgs.obra_id.trim()
      : undefined;
  const textoBusqueda = [obraNombreArg, mensajeUsuario].filter(Boolean).join(' ').trim();
  const obraRes = await resolverObraDocumentoAgente(
    supabase,
    businessId,
    obraIdArg,
    textoBusqueda,
    'documento'
  );
  if (!obraRes.ok) return { mensaje: obraRes.mensaje };
  if (!obraRes.obra_id) {
    return { error: 'Indica la obra para consultar las horas (nombre u obra_id).' };
  }

  const { data, error } = await supabase
    .from('registros_jornada')
    .select('horas_reales, horas_convenio, operario_id, operarios ( nombre )')
    .eq('business_id', businessId)
    .eq('obra_id', obraRes.obra_id);

  if (error) return { error: error.message };

  type Fila = {
    horas_reales: number | null;
    horas_convenio: number | null;
    operario_id: string;
    operarios?: { nombre?: string | null } | null;
  };

  const byOp = new Map<
    string,
    { operario_id: string; nombre: string; horas_reales: number; horas_convenio: number }
  >();

  for (const row of (data ?? []) as Fila[]) {
    const oid = row.operario_id;
    const nomJoin =
      row.operarios && typeof row.operarios === 'object'
        ? String((row.operarios as { nombre?: string | null }).nombre ?? '').trim()
        : '';
    const nombre = nomJoin || oid;
    const hr = Number(row.horas_reales ?? 0) || 0;
    const hc = Number(row.horas_convenio ?? 0) || 0;
    const prev = byOp.get(oid);
    if (prev) {
      prev.horas_reales += hr;
      prev.horas_convenio += hc;
    } else {
      byOp.set(oid, {
        operario_id: oid,
        nombre,
        horas_reales: hr,
        horas_convenio: hc,
      });
    }
  }

  const items = [...byOp.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const nombreObra =
    obraRes.obra_nombre?.trim() ||
    (await (async () => {
      const { data: r } = await supabase
        .from('obras')
        .select('nombre')
        .eq('id', obraRes.obra_id)
        .eq('business_id', businessId)
        .maybeSingle();
      return String((r as { nombre?: string | null } | null)?.nombre ?? '').trim() || 'Obra';
    })());

  return { obra_id: obraRes.obra_id, obra_nombre: nombreObra, items };
}

export async function ejecutarConsultarHorasOperario(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const nombreFrag = String(toolArgs.operario_nombre ?? '').trim();
  if (!nombreFrag) return { error: 'operario_nombre es obligatorio' };

  const opRes = await buscarOperariosPorNombre(supabase, businessId, nombreFrag);
  if (!opRes.ok) return { error: opRes.error };
  if (opRes.filas.length === 0) {
    return { error: `No encontré un operario activo que coincida con «${nombreFrag}».` };
  }
  if (opRes.filas.length > 1) {
    const lista = opRes.filas.map((o, i) => `${i + 1}. ${o.nombre}`).join('\n');
    return {
      mensaje: `Hay varios operarios que encajan:\n${lista}\nIndica el nombre completo o más concreto.`,
    };
  }
  const operario = opRes.filas[0]!;

  const mes = parseMesYyyyMm(toolArgs.mes);
  const { start, end } = boundsForMonth(mes);

  const { data, error } = await supabase
    .from('registros_jornada')
    .select('fecha, horas_reales, horas_convenio, obras ( nombre )')
    .eq('business_id', businessId)
    .eq('operario_id', operario.id)
    .gte('fecha', start)
    .lte('fecha', end)
    .order('fecha', { ascending: true });

  if (error) return { error: error.message };

  type FilaD = {
    fecha: string;
    horas_reales: number | null;
    horas_convenio: number | null;
    obras?: { nombre?: string | null } | null;
  };

  let totalReales = 0;
  let totalConvenio = 0;
  const porDia: Array<{
    fecha: string;
    horas_reales: number;
    horas_convenio: number;
    obra: string | null;
  }> = [];

  for (const row of (data ?? []) as FilaD[]) {
    const hr = Number(row.horas_reales ?? 0) || 0;
    const hc = Number(row.horas_convenio ?? 0) || 0;
    totalReales += hr;
    totalConvenio += hc;
    const obraNom =
      row.obras && typeof row.obras === 'object'
        ? String((row.obras as { nombre?: string | null }).nombre ?? '').trim() || null
        : null;
    porDia.push({ fecha: row.fecha, horas_reales: hr, horas_convenio: hc, obra: obraNom });
  }

  return {
    operario: operario.nombre,
    mes,
    horas_reales_total: totalReales,
    horas_convenio_total: totalConvenio,
    detalle_por_dia: porDia,
  };
}
