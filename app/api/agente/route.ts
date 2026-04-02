import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  buildDiarioObraPdf,
  fetchDiarioObraEntries,
  insertDiarioObraEntry,
  sanitizeDiarioFilePart,
} from '@/lib/diario-obra';
import { getGmailAccessTokenForUser } from '@/lib/gmail/get-access-token';
import {
  diasDesdeFechaHasta,
  hoyYmdEnZona,
  listarAlbaranesSinFacturar,
} from '@/lib/albaranes-sin-facturar';
import { enriquecerTextoConMaps, generarLinkMaps } from '@/lib/maps';
import {
  type PrediccionMeteo,
  formatearMensajeConsultaTiempo,
  geocodeDireccion,
  getPrediccionPorCiudad,
  getPrediccionPorCoordenadas,
} from '@/lib/weather';
import { TARIFAS_BASE_ALBANILERIA } from '@/lib/tarifas-base';
import {
  estructurarDictadoEnPartidas,
  formatearBorradorPresupuestoDictado,
  type TarifaReferencia,
} from '@/lib/dictado-presupuesto';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cliente de la obra (JOIN clientes) para heredar en documentos cuando no hay cliente_id explícito. */
async function clienteDesdeObraSiAplica(
  supabase: SupabaseClient,
  businessId: string,
  obraId: string
): Promise<{ cliente_id: string | null; cliente_nombre: string | null }> {
  const { data, error } = await supabase
    .from('obras')
    .select('cliente_id, clientes ( nombre )')
    .eq('id', obraId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error || !data) return { cliente_id: null, cliente_nombre: null };
  const row = data as {
    cliente_id: string | null;
    clientes?: { nombre?: string | null } | null;
  };
  const cid = row.cliente_id ?? null;
  if (!cid) return { cliente_id: null, cliente_nombre: null };
  const cn =
    row.clientes && typeof row.clientes === 'object'
      ? String((row.clientes as { nombre?: string | null }).nombre ?? '').trim() || null
      : null;
  return { cliente_id: cid, cliente_nombre: cn };
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** El modelo a veces envía un objeto o string JSON en lugar de un array; sin esto capturarCanvas no rellena canvas. */
function normalizarDatosCanvasVista(datos: unknown): unknown[] {
  if (Array.isArray(datos)) return datos;
  if (datos && typeof datos === 'object') return [datos];
  if (typeof datos === 'string') {
    const s = datos.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object') return [p];
    } catch {
      return [];
    }
  }
  return [];
}

/** YYYY-MM-DD del instante dado en la zona horaria indicada (p. ej. Europa/Madrid). */
function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Suma días a una fecha civil YYYY-MM-DD. */
function addDaysToYmd(ymd: string, days: number): string {
  const [y, mo, da] = ymd.split('-').map(Number);
  const u = Date.UTC(y, mo - 1, da + days);
  return new Date(u).toISOString().slice(0, 10);
}

const ESTADOS_DOC = ['pendiente', 'aceptado', 'rechazado', 'facturado', 'pagado'] as const;
type EstadoDoc = (typeof ESTADOS_DOC)[number];

function parseEstadoDoc(raw: unknown): EstadoDoc | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (ESTADOS_DOC as readonly string[]).includes(s) ? (s as EstadoDoc) : null;
}

const IMAGEN_VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGEN_DECODED_BYTES = 4 * 1024 * 1024;

/** Devuelve data URL lista para OpenAI vision, o null si es inválida o demasiado grande. */
function normalizarImagenVision(
  imagen: unknown,
  imagenMime: unknown
): string | null {
  if (imagen == null || typeof imagen !== 'string') return null;
  const s = imagen.trim();
  if (!s) return null;

  let mime: string;
  let b64: string;
  const marker = ';base64,';

  if (s.startsWith('data:image/')) {
    const mi = s.indexOf(marker);
    if (mi === -1) return null;
    mime = s.slice('data:'.length, mi).toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!IMAGEN_VISION_MIMES.has(mime)) return null;
    b64 = s.slice(mi + marker.length).replace(/\s/g, '');
  } else {
    const rawMime =
      typeof imagenMime === 'string' && imagenMime.trim()
        ? imagenMime.trim().toLowerCase()
        : 'image/jpeg';
    mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!IMAGEN_VISION_MIMES.has(mime)) return null;
    b64 = s.replace(/\s/g, '');
  }

  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0 || buf.length > MAX_IMAGEN_DECODED_BYTES) return null;
  } catch {
    return null;
  }

  return `data:${mime};base64,${b64}`;
}

const TIPOS_MEDICION = ['superficie', 'volumen', 'lineal', 'perimetro'] as const;
type TipoMedicion = (typeof TIPOS_MEDICION)[number];

/** Convierte dimensiones del usuario a metros y calcula totales en m², m³ o ml. */
function calcularMedicionObra(toolArgs: Record<string, unknown>):
  | { error: string }
  | {
      tipo: TipoMedicion;
      total: number;
      unidad: 'm²' | 'm³' | 'ml';
      desglose: string[];
      descripcion?: string;
    } {
  const tipoRaw = String(toolArgs.tipo ?? '').trim().toLowerCase();
  if (!(TIPOS_MEDICION as readonly string[]).includes(tipoRaw)) {
    return {
      error:
        'tipo inválido. Usa: superficie, volumen, lineal o perimetro',
    };
  }
  const tipo = tipoRaw as TipoMedicion;

  const unidadEntrada =
    toolArgs.unidad === undefined || toolArgs.unidad === null
      ? 'm'
      : String(toolArgs.unidad).trim().toLowerCase();
  if (unidadEntrada !== 'm' && unidadEntrada !== 'cm') {
    return { error: 'unidad debe ser "m" o "cm"' };
  }
  const factorAMetros = unidadEntrada === 'cm' ? 0.01 : 1;

  const dimensionesRaw = toolArgs.dimensiones;
  if (!Array.isArray(dimensionesRaw) || dimensionesRaw.length === 0) {
    return { error: 'dimensiones debe ser un array con al menos un elemento' };
  }

  type Dim = { largo: number; ancho: number; alto?: number };
  const dimensiones: Dim[] = [];
  for (let idx = 0; idx < dimensionesRaw.length; idx++) {
    const d = dimensionesRaw[idx];
    if (!d || typeof d !== 'object') {
      return { error: `dimensiones[${idx}] debe ser un objeto con largo y ancho` };
    }
    const o = d as Record<string, unknown>;
    const largo = Number(o.largo);
    const ancho = Number(o.ancho);
    const alto =
      o.alto !== undefined && o.alto !== null ? Number(o.alto) : undefined;
    if (!Number.isFinite(largo) || !Number.isFinite(ancho)) {
      return { error: 'cada dimensión necesita largo y ancho numéricos' };
    }
    if (tipo === 'volumen') {
      if (alto === undefined || !Number.isFinite(alto)) {
        return { error: 'para volumen cada dimensión necesita largo, ancho y alto' };
      }
    }
    dimensiones.push({ largo, ancho, alto });
  }

  let huecos: Array<{ cantidad: number; largo: number; ancho: number }> = [];
  if (toolArgs.huecos !== undefined && toolArgs.huecos !== null) {
    if (!Array.isArray(toolArgs.huecos)) {
      return { error: 'huecos debe ser un array de objetos' };
    }
    for (let i = 0; i < toolArgs.huecos.length; i++) {
      const h = toolArgs.huecos[i];
      if (!h || typeof h !== 'object') {
        return { error: `huecos[${i}] debe ser un objeto` };
      }
      const ho = h as Record<string, unknown>;
      const cantidad = Number(ho.cantidad);
      const hl = Number(ho.largo);
      const ha = Number(ho.ancho);
      if (!Number.isFinite(cantidad) || !Number.isFinite(hl) || !Number.isFinite(ha)) {
        return { error: 'cada hueco necesita cantidad, largo y ancho numéricos' };
      }
      huecos.push({ cantidad, largo: hl, ancho: ha });
    }
  }

  const descripcionStr =
    toolArgs.descripcion !== undefined && toolArgs.descripcion !== null
      ? String(toolArgs.descripcion).trim()
      : '';
  const descripcion = descripcionStr.length > 0 ? descripcionStr : undefined;

  const L = (n: number) => n * factorAMetros;
  const desglose: string[] = [];
  let total = 0;

  const unidadSalida: 'm²' | 'm³' | 'ml' =
    tipo === 'superficie' ? 'm²' : tipo === 'volumen' ? 'm³' : 'ml';

  if (tipo === 'superficie') {
    let bruto = 0;
    dimensiones.forEach((d, i) => {
      const area = L(d.largo) * L(d.ancho);
      bruto += area;
      desglose.push(
        `Pieza ${i + 1}: ${d.largo} × ${d.ancho} ${unidadEntrada} → ${area.toFixed(6)} m²`
      );
    });
    let restaHuecos = 0;
    huecos.forEach((h, i) => {
      const aHueco = L(h.largo) * L(h.ancho) * h.cantidad;
      restaHuecos += aHueco;
      desglose.push(
        `Hueco ${i + 1}: ${h.cantidad} × (${h.largo} × ${h.ancho} ${unidadEntrada}) → ${aHueco.toFixed(6)} m²`
      );
    });
    total = bruto - restaHuecos;
    desglose.push(`Subtotal superficies: ${bruto.toFixed(6)} m²`);
    if (restaHuecos > 0) {
      desglose.push(`Resta huecos: ${restaHuecos.toFixed(6)} m²`);
    }
    desglose.push(`Total neto: ${total.toFixed(6)} m²`);
  } else if (tipo === 'volumen') {
    dimensiones.forEach((d, i) => {
      const vol = L(d.largo) * L(d.ancho) * L(d.alto!);
      total += vol;
      desglose.push(
        `Volumen ${i + 1}: ${d.largo} × ${d.ancho} × ${d.alto} ${unidadEntrada} → ${vol.toFixed(6)} m³`
      );
    });
    desglose.push(`Total: ${total.toFixed(6)} m³`);
  } else if (tipo === 'lineal') {
    dimensiones.forEach((d, i) => {
      const len = L(d.largo);
      total += len;
      desglose.push(
        `Tramo ${i + 1}: largo ${d.largo} ${unidadEntrada} → ${len.toFixed(6)} ml`
      );
    });
    desglose.push(`Total lineal: ${total.toFixed(6)} ml`);
  } else {
    dimensiones.forEach((d, i) => {
      const p = 2 * (L(d.largo) + L(d.ancho));
      total += p;
      desglose.push(
        `Rectángulo ${i + 1}: perímetro 2×(${d.largo}+${d.ancho}) ${unidadEntrada} → ${p.toFixed(6)} ml`
      );
    });
    desglose.push(`Total perímetro: ${total.toFixed(6)} ml`);
  }

  const totalRedondeado = Math.round(total * 1e9) / 1e9;

  const out: {
    tipo: TipoMedicion;
    total: number;
    unidad: 'm²' | 'm³' | 'ml';
    desglose: string[];
    descripcion?: string;
  } = {
    tipo,
    total: totalRedondeado,
    unidad: unidadSalida,
    desglose,
  };
  if (descripcion !== undefined) {
    out.descripcion = descripcion;
  }
  return out;
}

type AgentIntentCategory =
  | 'documentos'
  | 'emails'
  | 'agenda'
  | 'gastos'
  | 'diario'
  | 'clientes'
  | 'calculo'
  | 'general';

const ROUTER_SYSTEM_PROMPT = `Eres un clasificador. Responde SOLO con una palabra en minúsculas, sin comillas ni puntuación:
documentos | emails | agenda | gastos | diario | clientes | calculo | general

documentos: presupuestos, facturas, albaranes, vincular documentos a una obra (asociar_documentos_a_obra), crear o actualizar obra (crear_obra, actualizar_obra), extras/modificados/imprevistos en obra, dictado de visita y presupuesto estructurado (generar_presupuesto_por_dictado, gestionar_tarifas), estados, edición, crear documentos, conversiones presupuesto↔albarán↔factura, tiempo en obra.
emails: Gmail, leer bandeja, enviar correo.
agenda: recordatorios, citas, eventos en calendario, tiempo meteorológico para obras o citas.
gastos: ticket, OCR, foto de compra, registrar gasto, vincular gasto.
diario: diario de obra, fotos de obra, PDF del diario.
clientes: ficha de cliente, buscar cliente, historial de cliente.
calculo: metros cuadrados, m³, perímetro, dimensiones de obra.
general: saludos, varias áreas a la vez, mensajes pendientes del negocio, meteorología o tiempo, extras o imprevistos en obra (registrar_extra), dictado de visita o presupuesto por voz, vincular documentos a una obra, actualizar datos de obra (cliente, dirección, estado, actualizar_obra), o petición ambigua.`;

const INTENT_TOOL_NAMES_DOCUMENTOS = new Set([
  'obtener_presupuestos_pendientes',
  'obtener_facturas_pendientes',
  'obtener_albaranes_pendientes',
  'listar_presupuestos',
  'listar_facturas',
  'listar_albaranes',
  'cambiar_estado_presupuesto',
  'cambiar_estado_factura',
  'cambiar_estado_albaran',
  'editar_presupuesto',
  'editar_factura',
  'editar_albaran',
  'generar_presupuesto_por_dictado',
  'gestionar_tarifas',
  'crear_presupuesto',
  'crear_factura',
  'crear_albaran',
  'crear_obra',
  'actualizar_obra',
  'buscar_obra',
  'ver_ficha_obra',
  'asociar_documentos_a_obra',
  'convertir_presupuesto_a_albaran',
  'convertir_albaran_a_factura',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
  'albaranes_sin_facturar',
  'consultar_tiempo',
  'registrar_extra',
  'listar_extras',
]);

const INTENT_TOOL_NAMES_EMAILS = new Set([
  'leer_emails_recientes',
  'enviar_email',
  'mostrar_vista_visual',
  'get_directions',
]);

const INTENT_TOOL_NAMES_AGENDA = new Set([
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'get_directions',
  'consultar_tiempo',
]);

const INTENT_TOOL_NAMES_GASTOS = new Set([
  'registrar_gasto_ticket',
  'vincular_gasto',
  'listar_facturas',
  'listar_albaranes',
  'mostrar_vista_visual',
  'get_directions',
]);

const INTENT_TOOL_NAMES_DIARIO = new Set([
  'crear_entrada_diario',
  'generar_pdf_diario',
  'mostrar_vista_visual',
  'get_directions',
]);

const INTENT_TOOL_NAMES_CLIENTES = new Set([
  'crear_cliente',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
]);

const INTENT_TOOL_NAMES_CALCULO = new Set(['calcular_medicion', 'get_directions']);

const INTENT_TOOL_NAMES: Record<AgentIntentCategory, Set<string> | null> = {
  documentos: INTENT_TOOL_NAMES_DOCUMENTOS,
  emails: INTENT_TOOL_NAMES_EMAILS,
  agenda: INTENT_TOOL_NAMES_AGENDA,
  gastos: INTENT_TOOL_NAMES_GASTOS,
  diario: INTENT_TOOL_NAMES_DIARIO,
  clientes: INTENT_TOOL_NAMES_CLIENTES,
  calculo: INTENT_TOOL_NAMES_CALCULO,
  general: null,
};

function parseAgentIntentCategory(raw: string): AgentIntentCategory {
  const allowed: AgentIntentCategory[] = [
    'documentos',
    'emails',
    'agenda',
    'gastos',
    'diario',
    'clientes',
    'calculo',
    'general',
  ];
  const trimmed = raw.trim().toLowerCase();
  const first = trimmed.split(/[\s,.;]+/)[0] ?? '';
  if (allowed.includes(first as AgentIntentCategory)) {
    return first as AgentIntentCategory;
  }
  for (const c of allowed) {
    if (trimmed.includes(c)) return c;
  }
  return 'general';
}

function toolsForAgentIntent(
  cat: AgentIntentCategory,
  all: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const names = INTENT_TOOL_NAMES[cat];
  if (!names) return all;
  return all.filter((t) => t.type === 'function' && names.has(t.function.name));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, business_id, historial, imagen, imagen_mime } = body;

    const mensajeTrim = typeof mensaje === 'string' ? mensaje.trim() : '';
    const imagenDataUrl = normalizarImagenVision(imagen, imagen_mime);

    if (!mensajeTrim && !imagenDataUrl) {
      return NextResponse.json(
        {
          error:
            'Envía un mensaje de texto o una imagen válida (base64 o data URL image/*)',
        },
        { status: 400 }
      );
    }
    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id es requerido' },
        { status: 400 }
      );
    }

    const historialValido = Array.isArray(historial)
      ? historial.filter(
          (m: unknown) =>
            m &&
            typeof m === 'object' &&
            'role' in m &&
            'content' in m &&
            (m as { role: string }).role !== 'system' &&
            typeof (m as { content: unknown }).content === 'string'
        ).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      : [];

    const supabase = createServiceClient();
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();
    const { data: profile, error: profileError } = await supabase
      .from('business_profiles')
      .select('nombre, sector, descripcion, servicios, tarifas, contexto_adicional')
      .eq('id', business_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'No se encontró el perfil del negocio' },
        { status: 404 }
      );
    }

    const nombre = profile.nombre ?? 'el negocio';
    const sector = profile.sector ?? 'no especificado';
    const descripcion = profile.descripcion ?? '';
    const servicios = profile.servicios ?? '';
    const tarifas = profile.tarifas ?? '';
    const contexto_adicional = profile.contexto_adicional ?? '';

    const fechaActual = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const ahora = new Date().toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let agendaContextoPrimerMensaje = '';
    const esPrimerMensajeConversacion =
      historialValido.length === 0 || historialValido.length === 1;

    if (esPrimerMensajeConversacion) {
      const tzAgenda = 'Europe/Madrid';
      const hoyYmd = formatYmdInTimeZone(new Date(), tzAgenda);
      const mananaYmd = addDaysToYmd(hoyYmd, 1);

      const { data: agendaRows, error: agendaError } = await supabase
        .from('agenda')
        .select('titulo, fecha, hora')
        .eq('business_id', business_id)
        .in('fecha', [hoyYmd, mananaYmd])
        .order('fecha', { ascending: true });

      if (!agendaError && agendaRows && agendaRows.length > 0) {
        const lineas = agendaRows.map(
          (row: { titulo?: string | null; fecha?: string | null; hora?: string | null }) => {
            const titulo = String(row.titulo ?? '').trim() || 'Evento';
            const fecha = row.fecha ?? '';
            const cuando =
              fecha === hoyYmd ? 'hoy' : fecha === mananaYmd ? 'mañana' : fecha;
            const horaStr = row.hora != null && String(row.hora).trim()
              ? ` a las ${String(row.hora).trim()}`
              : '';
            return `- ${titulo} (${cuando}${horaStr})`;
          }
        );
        agendaContextoPrimerMensaje = `

PRIMER MENSAJE — Eventos en agenda (solo hoy y mañana; fechas en calendario local del negocio):
${lineas.join('\n')}

Al inicio de tu respuesta, antes de atender lo que pide el usuario, menciona de forma breve y natural (una o dos frases, tono coloquial) lo relevante de estos eventos; no hagas una lista numerada ni viñetas. Puedes usar fórmulas del estilo "Por cierto, ..." y luego enlazar con "Dicho esto," o similar antes de seguir con su petición.`;
      }
    }

    const systemPrompt = `Fecha y hora: ${ahora}. Asistente de ${nombre} (${sector}).
${descripcion}
Servicios: ${servicios}
Tarifas: ${tarifas}
Contexto extra: ${contexto_adicional}

GESTIÓN DE OBRAS MÚLTIPLES:
Pino puede tener varias obras abiertas simultáneamente. Cuando el usuario mencione un nombre, cliente o dirección:
1. Identifica automáticamente la obra correspondiente (las tools resuelven obra_id desde el contexto).
2. Si hay ambigüedad entre varias obras, pregunta al usuario.
3. Nunca asumas una obra sin confirmación si hay ambigüedad.
4. Siempre asocia los documentos a la obra correcta usando obra_id cuando esté claro.
5. Si el usuario no menciona ninguna obra, crea el documento sin obra_id y pregunta si quiere asociarlo a alguna obra.

Responde en español, profesional y conciso.

Documentos: crear_factura / crear_albaran solo si pide crear o generar algo nuevo; si solo consulta, usa listar_* u obtener_*_pendientes. Estados: pendiente, aceptado, rechazado, facturado, pagado. Sin UUID: listar_* antes de cambiar_estado_* o editar_*. Factura nueva: si faltan datos, preguntar (cliente, NIF, mano de obra, materiales, otros); luego líneas, base, IVA 21 %, total. Albarán nuevo: cliente, trabajos, fecha, total si aplica. Confirma al guardar.

Para crear presupuestos:
- Si el usuario describe trabajos, medidas o materiales → usar SIEMPRE generar_presupuesto_por_dictado
- Solo usar crear_presupuesto si el usuario proporciona un presupuesto ya estructurado con partidas y totales definidos
- Nunca crear presupuestos con texto libre sin estructurar

Conversiones entre documentos: si confirma presupuesto aceptado o facturar albarán, ofrece convertir_presupuesto_a_albaran o convertir_albaran_a_factura.

Extras y modificados: cuando el usuario mencione "extra", "modificado", "imprevisto" o "añadido" en el contexto de una obra, usa registrar_extra. Siempre pregunta confirmación antes de enviar la notificación al cliente (el borrador lo aprueba en el panel).

gestionar_tarifas: ver o actualizar las tarifas del negocio para presupuestos estructurados (opcional junto con generar_presupuesto_por_dictado).

Emails: urgente si palabras como urgente, pago, presupuesto, factura, reclamación, avería, etc.; >48 h sin leer; cliente conocido; respuesta a presupuesto. enviar_email deja borrador; el usuario aprueba en el panel.

Canvas (mostrar_vista_visual): primero la tool de listado que toque; luego mostrar_vista_visual con el array completo en datos (p. ej. items). No abras canvas sin datos ni petición explícita de vista/tabla/panel. Tras abrir, mensaje breve.

Medidas de obra: siempre calcular_medicion; no calcules totales a mano.

Imagen ticket/factura: resume OCR y pregunta; registrar_gasto_ticket solo tras confirmación explícita en un mensaje siguiente. Tras registrar bien, ofrece vincular. vincular_gasto solo si el usuario indica documento (antes listar_facturas/listar_albaranes si hace falta el id).

Diario: crear_entrada_diario (obra_nombre para identificar la obra; detección automática desde nombre/cliente/dirección); generar_pdf_diario para exportar con el nombre exacto de obra.

Si hay mensajes de clientes pendientes de aprobar, menciónalos al inicio cuando aplique.

Fecha presupuestos: ${fechaActual}.${agendaContextoPrimerMensaje}`;

    const ALL_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'obtener_presupuestos_pendientes',
          description: 'Presupuestos en estado pendiente: cliente, importe, fecha.',
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
          name: 'obtener_facturas_pendientes',
          description: 'Facturas en estado pendiente: cliente, importe, fecha.',
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
          name: 'obtener_albaranes_pendientes',
          description: 'Albaranes pendientes: cliente y fecha.',
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
          name: 'listar_presupuestos',
          description:
            'Últimos 10 presupuestos (todos los estados). Listar o consultar sin crear uno nuevo.',
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
          name: 'listar_facturas',
          description: 'Últimas 10 facturas. Consultar o listar sin crear.',
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
          name: 'listar_albaranes',
          description: 'Últimos 10 albaranes. Consultar o listar sin crear.',
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
          name: 'albaranes_sin_facturar',
          description:
            'Albaranes sin factura vinculada (facturas.albaran_id) con más de 7 días desde la fecha del albarán. Saludo matinal o facturación pendiente.',
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
          name: 'cambiar_estado_presupuesto',
          description:
            'Cambia estado del presupuesto por UUID. Estados: pendiente, aceptado, rechazado, facturado, pagado. Sin id: listar_presupuestos antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_factura',
          description:
            'Cambia estado de la factura por UUID. Mismos estados que presupuestos. Sin id: listar_facturas antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_albaran',
          description:
            'Cambia estado del albarán por UUID. Mismos estados. Sin id: listar_albaranes antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_presupuesto',
          description:
            'Actualiza presupuesto por id: cliente_nombre, importe_total y/o texto (presupuesto_generado). Solo campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Importe total' },
              descripcion: {
                type: 'string',
                description: 'Nuevo texto del presupuesto (sustituye presupuesto_generado)',
              },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_factura',
          description:
            'Actualiza factura por id: cliente_nombre, total con IVA, descripcion_trabajos. Solo campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total con IVA (actualiza base e IVA al 21%)' },
              descripcion: { type: 'string', description: 'Descripción / conceptos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_albaran',
          description:
            'Actualiza albarán por id: cliente_nombre, importe_total, descripcion_trabajos. Solo campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total' },
              descripcion: { type: 'string', description: 'Descripción de trabajos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generar_presupuesto_por_dictado',
          description:
            "Usar SIEMPRE que el usuario pida crear un presupuesto describiendo trabajos, aunque la descripción sea breve. Ejemplos: 'presupuesto para enfoscado exterior 2500€', 'presupuesto para reforma de baño', 'presupuesto para pintar el salón de García'. También para dictado de visita: 'genera un presupuesto', 'haz un presupuesto de lo que he visto', 'acabo de visitar una obra'. Estructura el presupuesto en partidas automáticamente.",
          parameters: {
            type: 'object',
            properties: {
              dictado: {
                type: 'string',
                description: 'Descripción libre de los trabajos a realizar (dictado)',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              cliente_id: { type: 'string', description: 'UUID del cliente si se conoce' },
              direccion_obra: { type: 'string', description: 'Dirección de la obra' },
              obra_id: {
                type: 'string',
                description:
                  'UUID de la obra (opcional). Si no se envía, se detecta desde el dictado y el cliente.',
              },
            },
            required: ['dictado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gestionar_tarifas',
          description:
            'Añade, edita o lista las tarifas del negocio para generar presupuestos automáticos.',
          parameters: {
            type: 'object',
            properties: {
              accion: {
                type: 'string',
                enum: ['listar', 'añadir', 'editar'],
                description: 'Operación a realizar',
              },
              nombre: { type: 'string' },
              unidad: { type: 'string' },
              precio: { type: 'number' },
              categoria: { type: 'string' },
              tarifa_id: { type: 'string', description: 'UUID de la tarifa (editar)' },
            },
            required: ['accion'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_presupuesto',
          description:
            'IMPORTANTE: Solo usar cuando el presupuesto ya viene completamente estructurado con partidas y totales definidos. Si el usuario describe trabajos en lenguaje natural, usar generar_presupuesto_por_dictado en su lugar. Guarda un presupuesto nuevo (texto completo ya estructurado).',
          parameters: {
            type: 'object',
            properties: {
              texto_presupuesto: {
                type: 'string',
                description: 'Texto completo del presupuesto a guardar',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente si se conoce' },
              importe_total: { type: 'number', description: 'Importe total si se conoce' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['texto_presupuesto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_factura',
          description: 'Registra factura nueva. Solo si pidió crear/generar factura.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción o conceptos de la factura',
              },
              total: { type: 'number', description: 'Total con IVA si aplica' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_albaran',
          description: 'Registra albarán nuevo. Solo si pidió crear/generar albarán.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción de trabajos o entrega',
              },
              total: { type: 'number', description: 'Total opcional' },
              cliente_nombre: { type: 'string', description: 'Cliente si se conoce' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_obra',
          description:
            'Crea una nueva obra o proyecto. Usar cuando el usuario mencione una nueva obra, reforma o trabajo nuevo.',
          parameters: {
            type: 'object',
            properties: {
              nombre: {
                type: 'string',
                description: "Nombre de la obra (ej: 'Reforma Baño García', 'Fachada Calle Mayor')",
              },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              cliente_nombre: {
                type: 'string',
                description: 'Nombre del cliente si no se tiene cliente_id',
              },
              direccion: { type: 'string', description: 'Dirección de la obra' },
              direccion_obra: {
                type: 'string',
                description: 'Dirección física de la obra (si no se indica y el cliente tiene dirección, se usa la del cliente)',
              },
              fecha_inicio: {
                type: 'string',
                description: 'Fecha inicio (YYYY-MM-DD) opcional',
              },
              descripcion: { type: 'string', description: 'Descripción opcional' },
            },
            required: ['nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'actualizar_obra',
          description:
            'Actualiza los datos de una obra existente: cliente, dirección, estado, nombre.',
          parameters: {
            type: 'object',
            properties: {
              obra_id: { type: 'string', description: 'UUID de la obra' },
              obra_nombre: {
                type: 'string',
                description: 'Nombre de la obra (si no se conoce el id)',
              },
              nombre: { type: 'string', description: 'Nuevo nombre de la obra' },
              cliente_nombre: {
                type: 'string',
                description: 'Nombre del cliente a vincular si no se tiene cliente_id',
              },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente',
              },
              direccion: { type: 'string', description: 'Dirección de la obra' },
              estado: {
                type: 'string',
                description: 'abierta | en_curso | pausada | cerrada',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'buscar_obra',
          description: 'Busca una obra por nombre o cliente.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Texto a buscar' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ver_ficha_obra',
          description:
            "Muestra la ficha completa de una obra con todos sus documentos, diario y gastos. Si solo envías el nombre, busca la obra primero.",
          parameters: {
            type: 'object',
            properties: {
              obra_id: { type: 'string', description: 'UUID de la obra' },
              obra_nombre: {
                type: 'string',
                description: 'Nombre de la obra (buscar si no hay id)',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'asociar_documentos_a_obra',
          description:
            'Asocia documentos existentes (presupuestos, facturas, albaranes, gastos, entradas de diario) a una obra. Usar cuando el usuario pida vincular documentos de un cliente a una obra específica.',
          parameters: {
            type: 'object',
            properties: {
              obra_id: { type: 'string', description: 'UUID de la obra' },
              obra_nombre: { type: 'string', description: 'Nombre de la obra (buscar si no hay id)' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              cliente_id: { type: 'string', description: 'UUID del cliente (si existe)' },
              tipos: {
                type: 'array',
                description: 'Tipos a asociar (por defecto: todos)',
                items: {
                  type: 'string',
                  enum: ['presupuestos', 'facturas', 'albaranes', 'gastos', 'diario'],
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_mensajes_pendientes',
          description:
            'Respuestas IA del negocio pendientes de aprobación (texto, borrador, conversación).',
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
          name: 'leer_emails_recientes',
          description: 'Últimos 5 emails del inbox: remitente, asunto, resumen del cuerpo.',
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
          name: 'enviar_email',
          description:
            'Borrador Gmail (para, asunto, cuerpo); el envío requiere aprobación en el chat.',
          parameters: {
            type: 'object',
            properties: {
              destinatario: { type: 'string' },
              asunto: { type: 'string' },
              cuerpo: { type: 'string' },
            },
            required: ['destinatario', 'asunto', 'cuerpo'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_recordatorio',
          description:
            'Nuevo evento en agenda: título, fecha YYYY-MM-DD, hora opcional.',
          parameters: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Título del recordatorio' },
              fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
              hora: { type: 'string', description: 'Hora opcional (texto libre)' },
            },
            required: ['titulo', 'fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_recordatorio',
          description:
            'Actualiza recordatorio por id: título, fecha YYYY-MM-DD y/o hora (al menos un campo).',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
              titulo: { type: 'string', description: 'Nuevo título' },
              fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
              hora: { type: 'string', description: 'Nueva hora (texto libre) o vacío para quitar' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_recordatorio',
          description: 'Elimina un recordatorio de la agenda por id.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'calcular_medicion',
          description:
            'Cálculo de obra (m², m³, ml, perímetro). Pasa dimensiones y tipo; no inventes totales en texto.',
          parameters: {
            type: 'object',
            properties: {
              tipo: {
                type: 'string',
                enum: ['superficie', 'volumen', 'lineal', 'perimetro'],
                description:
                  'superficie: suma de largo×ancho menos huecos; volumen: suma de largo×ancho×alto; lineal: suma de largos; perimetro: suma de 2×(largo+ancho) por cada rectángulo',
              },
              dimensiones: {
                type: 'array',
                description:
                  'Lista de piezas o tramos. Para lineal solo se usa largo de cada objeto.',
                items: {
                  type: 'object',
                  properties: {
                    largo: { type: 'number' },
                    ancho: { type: 'number' },
                    alto: {
                      type: 'number',
                      description: 'Obligatorio si tipo es volumen',
                    },
                  },
                  required: ['largo', 'ancho'],
                  additionalProperties: false,
                },
              },
              huecos: {
                type: 'array',
                description:
                  'Opcional. Solo aplica a superficie: resta cantidad × largo × ancho por cada hueco',
                items: {
                  type: 'object',
                  properties: {
                    cantidad: { type: 'number' },
                    largo: { type: 'number' },
                    ancho: { type: 'number' },
                  },
                  required: ['cantidad', 'largo', 'ancho'],
                  additionalProperties: false,
                },
              },
              unidad: {
                type: 'string',
                enum: ['m', 'cm'],
                description: 'Unidad en la que vienen largo, ancho y alto. Por defecto metros.',
              },
              descripcion: {
                type: 'string',
                description: 'Opcional. Qué elemento se está midiendo (p. ej. "habitación principal")',
              },
            },
            required: ['tipo', 'dimensiones'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_directions',
          description:
            'Genera un enlace de Google Maps para una dirección. Usar cuando pregunten cómo llegar, indicaciones o ubicación de obra/cliente.',
          parameters: {
            type: 'object',
            properties: {
              direccion: {
                type: 'string',
                description: 'Dirección o ubicación a buscar en Maps',
              },
              nombre_lugar: {
                type: 'string',
                description: 'Etiqueta opcional (ej. Casa García, Cliente Martínez)',
              },
            },
            required: ['direccion'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'consultar_tiempo',
          description:
            'Previsión meteorológica para ciudad o dirección de obra. Tiempo, lluvia, obras en agenda.',
          parameters: {
            type: 'object',
            properties: {
              ubicacion: {
                type: 'string',
                description: 'Ciudad o dirección (ej. Madrid, Zarautz, Calle Mayor 1 Bilbao)',
              },
              dias: {
                type: 'number',
                description: '1 o 2 días de previsión (hoy y/o mañana)',
                enum: [1, 2],
              },
            },
            required: ['ubicacion'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'registrar_extra',
          description:
            "Registra un trabajo extra o modificado sobre un presupuesto existente. Usar cuando el usuario diga 'registra un extra', 'ha surgido un imprevisto', 'añade un modificado' o similar. Crea un presupuesto hijo vinculado al presupuesto original.",
          parameters: {
            type: 'object',
            properties: {
              descripcion: {
                type: 'string',
                description: 'Descripción del trabajo extra o imprevisto',
              },
              importe: {
                type: 'number',
                description: 'Coste adicional (IVA no incluido)',
              },
              presupuesto_parent_id: {
                type: 'string',
                description: 'UUID del presupuesto original, si se conoce',
              },
              cliente_nombre: {
                type: 'string',
                description: 'Nombre del cliente para localizar el presupuesto si no hay id',
              },
              notificar_cliente: {
                type: 'boolean',
                description: 'Si preparar borrador de email al cliente (por defecto true)',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional; si no, se detecta por contexto o mensaje)',
              },
            },
            required: ['descripcion', 'importe'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_extras',
          description:
            'Lista extras y modificados registrados, opcionalmente por cliente o presupuesto padre.',
          parameters: {
            type: 'object',
            properties: {
              cliente_nombre: { type: 'string', description: 'Filtrar por nombre de cliente' },
              presupuesto_parent_id: {
                type: 'string',
                description: 'Filtrar por UUID del presupuesto original',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'registrar_gasto_ticket',
          description:
            'Guarda gasto desde ticket/OCR solo tras confirmación explícita del usuario.',
          parameters: {
            type: 'object',
            properties: {
              proveedor: { type: 'string', description: 'Nombre del comercio o proveedor' },
              importe: {
                type: 'number',
                description: 'Importe sin IVA (base imponible)',
              },
              iva: { type: 'number', description: 'Cuantía del IVA en la misma moneda' },
              importe_total: { type: 'number', description: 'Total con IVA' },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
              cliente_id: {
                type: 'string',
                description:
                  'UUID del cliente si se conoce. Si no se envía y hay obra, se puede heredar de la obra.',
              },
              fecha: {
                type: 'string',
                description: 'Fecha del documento en formato YYYY-MM-DD',
              },
              descripcion: {
                type: 'string',
                description: 'Resumen breve del concepto del gasto (opcional)',
              },
            },
            required: ['proveedor', 'importe', 'iva', 'importe_total', 'fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'vincular_gasto',
          description:
            'Enlaza un gasto ya registrado a factura(s) o albarán(es) por UUID.',
          parameters: {
            type: 'object',
            properties: {
              gasto_id: {
                type: 'string',
                description: 'UUID del gasto a vincular',
              },
              documentos: {
                type: 'array',
                description: 'Lista de documentos a los que vincular el gasto',
                items: {
                  type: 'object',
                  properties: {
                    tipo: { type: 'string', enum: ['factura', 'albaran'] },
                    id: { type: 'string', description: 'UUID del documento' },
                  },
                  required: ['tipo', 'id'],
                  additionalProperties: false,
                },
              },
            },
            required: ['gasto_id', 'documentos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_entrada_diario',
          description:
            'Entrada en diario de obra: texto, fotos y/o vídeos (URLs). Obligatorio obra_nombre para identificar la obra; el servidor resuelve obra_id por nombre, cliente o dirección.',
          parameters: {
            type: 'object',
            properties: {
              obra_nombre: {
                type: 'string',
                description:
                  "Nombre o identificador de la obra (ej: 'Reforma Calle Mayor', 'Casa García')",
              },
              obra_id: {
                type: 'string',
                description:
                  'UUID de la obra (opcional). Si no se indica, se detecta por obra_nombre y el mensaje del usuario.',
              },
              obra_direccion: {
                type: 'string',
                description: 'Dirección física de la obra',
              },
              texto: {
                type: 'string',
                description:
                  'Descripción del trabajo realizado, observaciones, materiales usados, etc.',
              },
              fotos: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs de las fotos subidas previamente',
              },
              videos: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs de los vídeos subidos previamente',
              },
            },
            required: ['obra_nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generar_pdf_diario',
          description: 'PDF con todas las entradas de una obra (por nombre de obra).',
          parameters: {
            type: 'object',
            properties: {
              obra_nombre: {
                type: 'string',
                description: 'Nombre de la obra cuyo diario se quiere exportar',
              },
            },
            required: ['obra_nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_cliente',
          description: 'Nueva ficha de cliente (nombre obligatorio; contacto y notas opcionales).',
          parameters: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre o razón social' },
              telefono: { type: 'string', description: 'Teléfono' },
              email: { type: 'string', description: 'Email' },
              direccion: { type: 'string', description: 'Dirección' },
              nif: { type: 'string', description: 'NIF/CIF' },
              notas: { type: 'string', description: 'Notas internas' },
            },
            required: ['nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'buscar_cliente',
          description: 'Búsqueda parcial por nombre, email o teléfono.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Texto a buscar' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ver_cliente',
          description:
            'Ficha completa e historial: presupuestos, facturas, albaranes, diario.',
          parameters: {
            type: 'object',
            properties: {
              cliente_id: { type: 'string', description: 'UUID del cliente' },
            },
            required: ['cliente_id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'convertir_presupuesto_a_albaran',
          description:
            'Presupuesto aceptado → albarán (copia datos; actualiza estado del presupuesto).',
          parameters: {
            type: 'object',
            properties: {
              presupuesto_id: {
                type: 'string',
                description: 'UUID del presupuesto a convertir',
              },
              observaciones: {
                type: 'string',
                description: 'Notas adicionales para el albarán',
              },
            },
            required: ['presupuesto_id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'convertir_albaran_a_factura',
          description:
            'Albarán → factura (copia datos; IVA opcional; marca albarán facturado).',
          parameters: {
            type: 'object',
            properties: {
              albaran_id: {
                type: 'string',
                description: 'UUID del albarán a convertir',
              },
              iva: {
                type: 'number',
                description: 'Porcentaje de IVA (por defecto 21)',
              },
              observaciones: {
                type: 'string',
                description: 'Observaciones para la factura',
              },
            },
            required: ['albaran_id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mostrar_vista_visual',
          description:
            'Panel modal (tabla/canvas). Tras listar_* o leer_emails: pasa items en datos. No para listados de chat sin pedir vista.',
          parameters: {
            type: 'object',
            properties: {
              tipo: {
                type: 'string',
                enum: [
                  'presupuestos',
                  'facturas',
                  'albaranes',
                  'clientes',
                  'emails',
                  'gastos',
                  'diario',
                ],
                description: 'Tipo de datos a mostrar',
              },
              titulo: {
                type: 'string',
                description: "Título del panel, ej: 'Últimos presupuestos', 'Emails recientes'",
              },
              datos: {
                type: 'array',
                description:
                  'Array completo de filas obtenido en la respuesta de la tool de listado previa (p. ej. todos los elementos de "items"); no debe estar vacío.',
                items: { type: 'object' },
              },
            },
            required: ['tipo', 'titulo', 'datos'],
            additionalProperties: false,
          },
        },
      },
    ];

    const textoUsuario =
      mensajeTrim ||
      '(El usuario adjuntó una imagen, posiblemente un ticket o factura. Analízala e indica qué datos ves.)';

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: textoUsuario },
    ];
    if (imagenDataUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imagenDataUrl, detail: 'auto' },
      });
    }

    const routerCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: 30,
      temperature: 0,
    });

    const intentRaw = routerCompletion.choices[0]?.message?.content ?? '';
    const intentCategory = parseAgentIntentCategory(intentRaw);
    let tools = toolsForAgentIntent(intentCategory, ALL_AGENT_TOOLS);
    if (tools.length === 0) {
      tools = ALL_AGENT_TOOLS;
    }

    const historialLimitado = historialValido.slice(-10);

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historialLimitado.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const maxTokensAgente = imagenDataUrl ? 1600 : 800;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: maxTokensAgente,
    });

    const firstMessage = completion.choices[0]?.message;

    const getGmailAccessToken = async () => {
      if (!authUser?.id) return { error: 'No hay usuario autenticado para Gmail' } as const;
      const r = await getGmailAccessTokenForUser(authUser.id);
      if ('error' in r) {
        return { error: r.error } as const;
      }
      return { accessToken: r.accessToken } as const;
    };

    const runTool = async (toolName: string, toolArgs: Record<string, unknown>) => {
      console.log('Ejecutando tool:', toolName);

      const resolveClienteIdOpcional = async (
        raw: unknown
      ): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> => {
        if (raw == null || !String(raw).trim()) return { ok: true, id: null };
        const cid = String(raw).trim();
        const { data: row, error: e0 } = await supabase
          .from('clientes')
          .select('id')
          .eq('id', cid)
          .eq('business_id', business_id)
          .maybeSingle();
        if (e0) return { ok: false, error: e0.message };
        if (!row?.id) return { ok: false, error: 'cliente_id no válido para este negocio' };
        return { ok: true, id: cid };
      };

      switch (toolName) {
        case 'obtener_presupuestos_pendientes': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('cliente_nombre, importe_total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.importe_total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_facturas_pendientes': {
          const { data, error } = await supabase
            .from('facturas')
            .select('cliente_nombre, total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_albaranes_pendientes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('cliente_nombre, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'listar_presupuestos': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('id, cliente_nombre, cliente_id, importe_total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_presupuestos Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              cliente_nombre?: string | null;
              cliente_id?: string | null;
              importe_total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              cliente: r.cliente_nombre ?? null,
              cliente_id: r.cliente_id ?? null,
              importe_total: r.importe_total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_facturas': {
          const { data, error } = await supabase
            .from('facturas')
            .select('id, numero_factura, cliente_nombre, cliente_id, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_facturas Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              numero_factura?: string | null;
              cliente_nombre?: string | null;
              cliente_id?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              numero_factura: r.numero_factura ?? null,
              cliente: r.cliente_nombre ?? null,
              cliente_id: r.cliente_id ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_albaranes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('id, numero_albaran, cliente_nombre, cliente_id, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_albaranes Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              numero_albaran?: string | null;
              cliente_nombre?: string | null;
              cliente_id?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              numero_albaran: r.numero_albaran ?? null,
              cliente: r.cliente_nombre ?? null,
              cliente_id: r.cliente_id ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'albaranes_sin_facturar': {
          try {
            const { albaranes, total } = await listarAlbaranesSinFacturar(
              supabase,
              business_id
            );
            if (total === 0) {
              return { mensaje: 'No hay albaranes pendientes de facturar.' };
            }
            const hoyYmd = hoyYmdEnZona();
            const items = albaranes.map((a) => {
              const dias = diasDesdeFechaHasta(a.fecha, hoyYmd);
              return {
                id: a.id,
                numero_albaran: a.numero_albaran,
                cliente: a.cliente_nombre,
                importe: a.total,
                fecha: a.fecha,
                estado: a.estado,
                dias_transcurridos: dias,
              };
            });
            const lineas = items.map((i) => {
              const imp =
                i.importe != null && Number.isFinite(Number(i.importe))
                  ? `${Number(i.importe).toFixed(2)}€`
                  : '—';
              const ref = i.numero_albaran ?? String(i.id).slice(0, 8);
              return `- ${i.cliente ?? 'Cliente'} (albarán ${ref}): ${imp} (hace ${i.dias_transcurridos} días)`;
            });
            return {
              total,
              items,
              mensaje: `${total} albarán(es) sin factura vinculada (más de 7 días):\n${lineas.join('\n')}`,
            };
          } catch (e) {
            return {
              error: e instanceof Error ? e.message : 'Error al listar albaranes sin facturar',
            };
          }
        }
        case 'cambiar_estado_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_factura': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            importe_total?: number;
            presupuesto_generado?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.importe_total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.presupuesto_generado = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_factura': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            total?: number;
            base_imponible?: number;
            iva?: number;
            descripcion_trabajos?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const totalNum = Number(toolArgs.importe_total);
            if (!Number.isFinite(totalNum)) {
              return { error: 'importe_total debe ser un número válido' };
            }
            const baseImponible = totalNum ? totalNum / 1.21 : 0;
            const iva = totalNum ? totalNum - baseImponible : 0;
            updates.total = totalNum;
            updates.base_imponible = Number.isFinite(baseImponible) ? baseImponible : 0;
            updates.iva = Number.isFinite(iva) ? iva : 0;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: { cliente_nombre?: string; total?: number; descripcion_trabajos?: string } =
            {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'crear_presupuesto': {
          const texto = String(toolArgs.texto_presupuesto ?? '').trim();
          if (!texto) {
            return { error: 'texto_presupuesto es obligatorio' };
          }
          const clienteNombre =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const importeRaw = toolArgs.importe_total;
          const importe_total =
            importeRaw != null && Number.isFinite(Number(importeRaw))
              ? Number(importeRaw)
              : null;

          const cr = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };

          const explicitObra =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;

          let obraIdFinal = '';
          if (explicitObra) {
            const { data: obraRow, error: obraErr } = await supabase
              .from('obras')
              .select('id')
              .eq('business_id', business_id)
              .eq('id', explicitObra)
              .in('estado', ['abierta', 'en_curso'])
              .maybeSingle();
            if (obraErr || !obraRow?.id) {
              return { error: 'La obra indicada no existe o no está abierta.' };
            }
            obraIdFinal = obraRow.id;
          } else {
            const textoObra = [texto, clienteNombre, mensajeTrim].filter(Boolean).join(' ').trim();
            const obraRes = await resolverObraDocumentoAgente(
              supabase,
              business_id,
              undefined,
              textoObra,
              'documento'
            );
            if (!obraRes.ok) return { mensaje: obraRes.mensaje };
            obraIdFinal = obraRes.obra_id ?? '';
          }

          let clienteIdFinal = cr.id;
          let clienteNombreFinal = clienteNombre;
          if (obraIdFinal && cr.id == null) {
            const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
              supabase,
              business_id,
              obraIdFinal
            );
            if (cidO) {
              clienteIdFinal = cidO;
              if (cnO) clienteNombreFinal = cnO;
            }
          }

          const { error } = await supabase.from('presupuestos').insert({
            business_id,
            mensaje_cliente: mensaje,
            presupuesto_generado: texto,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'borrador',
            ...(importe_total != null && { importe_total }),
            ...(clienteNombreFinal.length > 0 && { cliente_nombre: clienteNombreFinal }),
            ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
            ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_factura': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : 0;
          const baseImponible = totalNum ? totalNum / 1.21 : 0;
          const iva = totalNum ? totalNum - baseImponible : 0;

          const cr = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };

          const explicitObra =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;
          const textoObra = [desc, mensajeTrim].filter(Boolean).join(' ').trim();
          const obraRes = await resolverObraDocumentoAgente(
            supabase,
            business_id,
            explicitObra,
            textoObra,
            'documento'
          );
          if (!obraRes.ok) return { mensaje: obraRes.mensaje };
          const obraIdFinal = obraRes.obra_id ?? '';

          let clienteIdFinal = cr.id;
          let clienteNombreFinal: string | null = null;
          if (obraIdFinal && cr.id == null) {
            const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
              supabase,
              business_id,
              obraIdFinal
            );
            if (cidO) {
              clienteIdFinal = cidO;
              clienteNombreFinal = cnO;
            }
          }

          const { error } = await supabase.from('facturas').insert({
            business_id,
            cliente_nombre: clienteNombreFinal,
            descripcion_trabajos: desc,
            base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
            iva: Number.isFinite(iva) ? iva : 0,
            total: Number.isFinite(totalNum) ? totalNum : 0,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
            ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
            ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_albaran': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw))
              ? Number(totalRaw)
              : null;
          const clienteAlb =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';

          const cr = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };

          const explicitObra =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;
          const textoObra = [desc, clienteAlb, mensajeTrim].filter(Boolean).join(' ').trim();
          const obraRes = await resolverObraDocumentoAgente(
            supabase,
            business_id,
            explicitObra,
            textoObra,
            'documento'
          );
          if (!obraRes.ok) return { mensaje: obraRes.mensaje };
          const obraIdFinal = obraRes.obra_id ?? '';

          let clienteIdFinal = cr.id;
          let clienteNombreFinal = clienteAlb.length > 0 ? clienteAlb : null;
          if (obraIdFinal && cr.id == null) {
            const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
              supabase,
              business_id,
              obraIdFinal
            );
            if (cidO) {
              clienteIdFinal = cidO;
              if (cnO) clienteNombreFinal = cnO;
            }
          }

          const { error } = await supabase.from('albaranes').insert({
            business_id,
            cliente_nombre: clienteNombreFinal,
            descripcion_trabajos: desc,
            total: totalNum,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
            ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
            ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_obra': {
          const nombre = String(toolArgs.nombre ?? '').trim();
          if (!nombre) return { error: 'nombre es obligatorio' };

          const direccionTool =
            typeof toolArgs.direccion_obra === 'string'
              ? toolArgs.direccion_obra.trim()
              : typeof toolArgs.direccion === 'string'
                ? toolArgs.direccion.trim()
                : '';
          const fechaInicio =
            typeof toolArgs.fecha_inicio === 'string' ? toolArgs.fecha_inicio.trim() : '';
          const descripcion =
            typeof toolArgs.descripcion === 'string' ? toolArgs.descripcion.trim() : '';

          let clienteId: string | null = null;
          let clienteNombreResuelto: string | null = null;
          let clienteDireccion: string | null = null;

          const cr = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };
          clienteId = cr.id;

          if (clienteId) {
            const { data: cliRow } = await supabase
              .from('clientes')
              .select('nombre, direccion')
              .eq('id', clienteId)
              .eq('business_id', business_id)
              .maybeSingle();
            if (cliRow) {
              clienteNombreResuelto = String((cliRow as { nombre?: string }).nombre ?? '').trim() || null;
              const d = (cliRow as { direccion?: string | null }).direccion;
              clienteDireccion = d != null && String(d).trim() ? String(d).trim() : null;
            }
          }

          let avisoSinCliente = false;
          if (!clienteId) {
            const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim();
            if (clienteNombre) {
              const safeQ = clienteNombre.replace(/[%_*]/g, '').slice(0, 120);
              const pat = `%${safeQ}%`;
              const { data: row } = await supabase
                .from('clientes')
                .select('id, nombre, email, direccion')
                .eq('business_id', business_id)
                .ilike('nombre', pat)
                .order('nombre', { ascending: true })
                .limit(1)
                .maybeSingle();
              if (row?.id) {
                clienteId = String((row as { id: string }).id);
                clienteNombreResuelto = String((row as { nombre?: string }).nombre ?? '').trim() || clienteNombre;
                const d = (row as { direccion?: string | null }).direccion;
                clienteDireccion = d != null && String(d).trim() ? String(d).trim() : null;
              } else {
                avisoSinCliente = true;
              }
            }
          }

          const direccionObraFinal =
            direccionTool ||
            (!direccionTool && clienteDireccion ? clienteDireccion : '') ||
            '';

          const { error } = await supabase.from('obras').insert({
            business_id,
            nombre,
            ...(clienteId ? { cliente_id: clienteId } : { cliente_id: null }),
            ...(direccionObraFinal ? { direccion: direccionObraFinal } : { direccion: null }),
            ...(fechaInicio ? { fecha_inicio: fechaInicio } : { fecha_inicio: null }),
            ...(descripcion ? { descripcion } : { descripcion: null }),
            estado: 'abierta',
          });

          if (error) return { error: error.message };

          const dirMsg = direccionObraFinal || 'sin dirección';
          if (avisoSinCliente) {
            const buscado = String(toolArgs.cliente_nombre ?? '').trim();
            return {
              mensaje: `Obra '${nombre}' creada sin cliente asociado (no se encontró '${buscado}' en clientes). Dirección: ${dirMsg}. Estado: Abierta.`,
            };
          }
          const cliMsg = clienteNombreResuelto ?? 'sin cliente';
          return {
            mensaje: `Obra '${nombre}' creada para ${cliMsg} en ${dirMsg}. Estado: Abierta.`,
          };
        }
        case 'actualizar_obra': {
          const ESTADOS_OBRA = new Set(['abierta', 'en_curso', 'pausada', 'cerrada']);
          let obraId = String(toolArgs.obra_id ?? '').trim();
          const obraNombreBuscar = String(toolArgs.obra_nombre ?? '').trim();

          if (!obraId) {
            if (!obraNombreBuscar) {
              return { error: 'obra_id u obra_nombre es obligatorio' };
            }
            const safeQ = obraNombreBuscar.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: rowObra, error: errObra } = await supabase
              .from('obras')
              .select('id')
              .eq('business_id', business_id)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (errObra) return { error: errObra.message };
            if (!rowObra?.id) return { error: 'No se encontró la obra' };
            obraId = rowObra.id;
          } else {
            const { data: ex } = await supabase
              .from('obras')
              .select('id')
              .eq('id', obraId)
              .eq('business_id', business_id)
              .maybeSingle();
            if (!ex?.id) return { error: 'Obra no encontrada' };
          }

          let clienteIdUpdate: string | undefined;
          const cidRaw = String(toolArgs.cliente_id ?? '').trim();
          const cnameRaw = String(toolArgs.cliente_nombre ?? '').trim();
          if (cidRaw) {
            const cr = await resolveClienteIdOpcional(cidRaw);
            if (!cr.ok) return { error: cr.error };
            if (!cr.id) return { error: 'cliente_id no válido' };
            clienteIdUpdate = cr.id;
          } else if (cnameRaw) {
            const safe = cnameRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safe}%`;
            const { data: rowC, error: errC } = await supabase
              .from('clientes')
              .select('id')
              .eq('business_id', business_id)
              .ilike('nombre', pat)
              .order('nombre', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (errC) return { error: errC.message };
            if (!rowC?.id) {
              return { error: `No se encontró el cliente "${cnameRaw}"` };
            }
            clienteIdUpdate = String((rowC as { id: string }).id);
          }

          const updates: Record<string, unknown> = {};
          const nombreNuevo = typeof toolArgs.nombre === 'string' ? toolArgs.nombre.trim() : '';
          if (nombreNuevo) updates.nombre = nombreNuevo;
          if (toolArgs.direccion !== undefined) {
            updates.direccion =
              typeof toolArgs.direccion === 'string' && toolArgs.direccion.trim()
                ? toolArgs.direccion.trim()
                : null;
          }
          if (typeof toolArgs.estado === 'string' && toolArgs.estado.trim()) {
            const est = toolArgs.estado.trim().toLowerCase();
            if (!ESTADOS_OBRA.has(est)) {
              return {
                error: `estado inválido. Usa: ${Array.from(ESTADOS_OBRA).join(', ')}`,
              };
            }
            updates.estado = est;
          }
          if (clienteIdUpdate !== undefined) {
            updates.cliente_id = clienteIdUpdate;
          }

          if (Object.keys(updates).length === 0) {
            return {
              error:
                'Indica al menos un campo a actualizar (nombre, direccion, estado, cliente_nombre o cliente_id)',
            };
          }

          updates.updated_at = new Date().toISOString();

          const { data: updated, error: updErr } = await supabase
            .from('obras')
            .update(updates)
            .eq('id', obraId)
            .eq('business_id', business_id)
            .select('nombre')
            .maybeSingle();

          if (updErr || !updated) {
            return { error: updErr?.message ?? 'No se pudo actualizar la obra' };
          }
          const nombreFinal = String((updated as { nombre?: string }).nombre ?? '');
          return { mensaje: `Obra '${nombreFinal}' actualizada correctamente.` };
        }
        case 'buscar_obra': {
          const qBus = String(toolArgs.query ?? '').trim();
          if (!qBus) return { error: 'query es obligatorio' };

          const safeQ = qBus.replace(/[%_*]/g, '').slice(0, 120);
          const pat = `%${safeQ}%`;

          const { data: obrasRows, error } = await supabase
            .from('obras')
            .select('id, nombre, cliente_id, direccion, estado, fecha_inicio, created_at')
            .eq('business_id', business_id)
            .ilike('nombre', pat)
            .order('created_at', { ascending: false })
            .limit(20);

          if (error) return { error: error.message };

          const obras = obrasRows ?? [];
          const clienteIds = (obras as Array<{ cliente_id: string | null }>).map((o) => o.cliente_id).filter((id0): id0 is string => Boolean(id0));
          if (clienteIds.length === 0) {
            return {
              items: (obras as any[]).map((o) => ({
                id: o.id,
                nombre: o.nombre,
                cliente_nombre: null,
                direccion: o.direccion ?? null,
                estado: o.estado ?? null,
                fecha_inicio: o.fecha_inicio ?? null,
              })),
            };
          }

          const { data: clientesRows } = await supabase
            .from('clientes')
            .select('id, nombre')
            .eq('business_id', business_id)
            .in('id', clienteIds);

          const clienteMap = new Map<string, string>();
          for (const c of (clientesRows ?? []) as Array<{ id: string; nombre: string }>) {
            clienteMap.set(c.id, c.nombre);
          }

          return {
            items: (obras as any[]).map((o) => ({
              id: o.id,
              nombre: o.nombre,
              cliente_nombre: o.cliente_id ? clienteMap.get(o.cliente_id) ?? null : null,
              direccion: o.direccion ?? null,
              estado: o.estado ?? null,
              fecha_inicio: o.fecha_inicio ?? null,
            })),
          };
        }
        case 'ver_ficha_obra': {
          const obraIdRaw = String(toolArgs.obra_id ?? '').trim();
          const obraNombreRaw = String(toolArgs.obra_nombre ?? '').trim();

          if (!obraIdRaw && !obraNombreRaw) {
            return { error: 'obra_id u obra_nombre es obligatorio' };
          }

          let obraId = obraIdRaw;
          let obraNombre = obraNombreRaw;

          if (!obraId) {
            const safeQ = obraNombre.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre, cliente_id')
              .eq('business_id', business_id)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            if (!row?.id) return { error: 'No se encontró la obra' };
            obraId = row.id;
            obraNombre = row.nombre ?? obraNombre;
          }

          const { data: obraRow, error: obraErr } = await supabase
            .from('obras')
            .select('id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, descripcion')
            .eq('id', obraId)
            .maybeSingle();

          if (obraErr || !obraRow) return { error: 'Obra no encontrada' };

          const clienteId = (obraRow.cliente_id as string | null) ?? null;
          const { data: clienteRow } = clienteId
            ? await supabase
                .from('clientes')
                .select('id, nombre, telefono, email, direccion, nif, notas')
                .eq('id', clienteId)
                .maybeSingle()
            : { data: null };

          const [presRes, facRes, albRes, dioRes, gastRes] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('facturas')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('albaranes')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('diario_obra')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('gastos')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
          ]);

          const presupuestos = presRes.data ?? [];
          const facturas = facRes.data ?? [];
          const albaranes = albRes.data ?? [];
          const entradasDiario = dioRes.data ?? [];
          const gastos = gastRes.data ?? [];

          const resumen = [
            `📋 **Ficha de obra**: ${obraRow.nombre}`,
            `Cliente: ${clienteRow?.nombre ?? '—'}`,
            `Estado: ${obraRow.estado ?? '—'}`,
            `Presupuestos: ${presupuestos.length}`,
            `Facturas: ${facturas.length}`,
            `Albaranes: ${albaranes.length}`,
            `Entradas diario: ${entradasDiario.length}`,
            `Gastos: ${gastos.length}`,
          ].join('\n');

          return {
            mensaje: resumen,
            accion: 'abrir_ficha_obra',
            obra_id: obraId,
            obra_nombre: obraNombre,
          };
        }
        case 'asociar_documentos_a_obra': {
          const obraIdRaw = String(toolArgs.obra_id ?? '').trim();
          const obraNombreRaw = String(toolArgs.obra_nombre ?? '').trim();

          const clienteIdRaw = String(toolArgs.cliente_id ?? '').trim();
          const clienteNombreRaw = String(toolArgs.cliente_nombre ?? '').trim();

          const tiposPermitidos = ['presupuestos', 'facturas', 'albaranes', 'gastos', 'diario'] as const;
          const tiposFinal =
            Array.isArray(toolArgs.tipos) && toolArgs.tipos.length > 0
              ? (toolArgs.tipos as unknown[])
                  .map((t) => String(t).trim().toLowerCase())
                  .filter((t) => (tiposPermitidos as readonly string[]).includes(t as any))
              : [...tiposPermitidos];

          if (tiposFinal.length === 0) {
            return { error: 'tipos no válido' };
          }

          let obraId = obraIdRaw;
          let obraNombre = obraNombreRaw;

          if (!obraId && obraNombreRaw) {
            const safeQ = obraNombreRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre')
              .eq('business_id', business_id)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            if (!row?.id) return { error: 'No se encontró la obra' };
            obraId = row.id;
            obraNombre = row.nombre ?? obraNombreRaw;
          }

          if (!obraId) {
            return { error: 'obra_id u obra_nombre es obligatorio' };
          }

          if (!obraNombre) {
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre')
              .eq('business_id', business_id)
              .eq('id', obraId)
              .maybeSingle();
            if (err) return { error: err.message };
            obraNombre = row?.nombre ?? obraNombreRaw ?? '';
          }

          let clienteId = clienteIdRaw;
          if (!clienteId && clienteNombreRaw) {
            const safeQ = clienteNombreRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('clientes')
              .select('id, nombre')
              .eq('business_id', business_id)
              .ilike('nombre', pat)
              .order('nombre', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            clienteId = row?.id ?? '';
          }

          const necesitaCliente =
            tiposFinal.some((t) => (['presupuestos', 'facturas', 'albaranes', 'gastos'] as const).includes(t as any));
          if (necesitaCliente && !clienteId) {
            return { error: 'cliente_id o cliente_nombre es obligatorio para asociar presupuestos/facturas/albaranes/gastos' };
          }

          if (tiposFinal.includes('diario' as any) && !clienteId && !(obraNombre || obraNombreRaw)) {
            return { error: 'obra_nombre o cliente_id es obligatorio para asociar entradas de diario' };
          }

          const updateNoDiario = async (table: string) => {
            const { data, error } = await supabase
              .from(table)
              .update({ obra_id: obraId })
              .eq('business_id', business_id)
              .eq('cliente_id', clienteId)
              .is('obra_id', null)
              .select('id');
            if (error) throw new Error(error.message);
            return (data ?? []).length;
          };

          const updateDiario = async () => {
            let q = supabase
              .from('diario_obra')
              .update({ obra_id: obraId })
              .eq('business_id', business_id)
              .is('obra_id', null);

            if (clienteId) {
              q = q.eq('cliente_id', clienteId);
            } else {
              const safeQ = (obraNombre || obraNombreRaw).replace(/[%_*]/g, '').slice(0, 120);
              const pat = `%${safeQ}%`;
              q = q.ilike('obra_nombre', pat);
            }

            const { data, error } = await q.select('id');
            if (error) throw new Error(error.message);
            return (data ?? []).length;
          };

          const [nPres, nFac, nAlb, nGast, nDio] = await Promise.all([
            tiposFinal.includes('presupuestos' as any) ? updateNoDiario('presupuestos') : Promise.resolve(0),
            tiposFinal.includes('facturas' as any) ? updateNoDiario('facturas') : Promise.resolve(0),
            tiposFinal.includes('albaranes' as any) ? updateNoDiario('albaranes') : Promise.resolve(0),
            tiposFinal.includes('gastos' as any) ? updateNoDiario('gastos') : Promise.resolve(0),
            tiposFinal.includes('diario' as any) ? updateDiario() : Promise.resolve(0),
          ]);

          const mensaje = `Asociados ${nPres} presupuestos, ${nFac} facturas, ${nAlb} albaranes a la obra '${obraNombre}'.`;

          return { mensaje, ok: true };
        }
        case 'crear_cliente': {
          const nombreCli = String(toolArgs.nombre ?? '').trim();
          if (!nombreCli) {
            return { error: 'nombre es obligatorio' };
          }
          const telefono =
            toolArgs.telefono != null ? String(toolArgs.telefono).trim() || null : null;
          const email = toolArgs.email != null ? String(toolArgs.email).trim() || null : null;
          const direccion =
            toolArgs.direccion != null ? String(toolArgs.direccion).trim() || null : null;
          const nif = toolArgs.nif != null ? String(toolArgs.nif).trim() || null : null;
          const notas = toolArgs.notas != null ? String(toolArgs.notas).trim() || null : null;

          const { error } = await supabase.from('clientes').insert({
            business_id,
            nombre: nombreCli,
            telefono,
            email,
            direccion,
            nif,
            notas,
          });

          if (error) return { error: error.message };
          return { mensaje: `Cliente ${nombreCli} creado correctamente.` };
        }
        case 'buscar_cliente': {
          const qBus = String(toolArgs.query ?? '').trim();
          if (!qBus) {
            return { error: 'query es obligatorio' };
          }
          const safeQ = qBus.replace(/[%_*]/g, '').slice(0, 120);
          if (!safeQ) {
            return { items: [] };
          }
          const pat = `%${safeQ}%`;
          const { data: rowsB, error: errB } = await supabase
            .from('clientes')
            .select('id, nombre, email, telefono')
            .eq('business_id', business_id)
            .or(`nombre.ilike.${pat},email.ilike.${pat},telefono.ilike.${pat}`)
            .order('nombre', { ascending: true })
            .limit(50);
          if (errB) return { error: errB.message };
          const listB = rowsB ?? [];
          const idsB = listB.map((r: { id: string }) => r.id);
          if (idsB.length === 0) return { items: [] };

          const [presB, facB, albB] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('cliente_id')
              .eq('business_id', business_id)
              .in('cliente_id', idsB),
            supabase
              .from('facturas')
              .select('cliente_id')
              .eq('business_id', business_id)
              .in('cliente_id', idsB),
            supabase
              .from('albaranes')
              .select('cliente_id')
              .eq('business_id', business_id)
              .in('cliente_id', idsB),
          ]);

          const acumDocs = (rows: { cliente_id: string | null }[] | null) => {
            const m = new Map<string, number>();
            for (const id0 of idsB) m.set(id0, 0);
            for (const r of rows ?? []) {
              const c = r.cliente_id;
              if (!c) continue;
              m.set(c, (m.get(c) ?? 0) + 1);
            }
            return m;
          };
          const mpB = acumDocs(presB.data as { cliente_id: string | null }[] | null);
          const mfB = acumDocs(facB.data as { cliente_id: string | null }[] | null);
          const maB = acumDocs(albB.data as { cliente_id: string | null }[] | null);

          return {
            items: listB.map(
              (r: {
                id: string;
                nombre: string;
                email: string | null;
                telefono: string | null;
              }) => ({
                id: r.id,
                nombre: r.nombre,
                email: r.email,
                telefono: r.telefono,
                num_documentos:
                  (mpB.get(r.id) ?? 0) + (mfB.get(r.id) ?? 0) + (maB.get(r.id) ?? 0),
              })
            ),
          };
        }
        case 'ver_cliente': {
          const idVer = String(toolArgs.cliente_id ?? '').trim();
          if (!idVer) {
            return { error: 'cliente_id es obligatorio' };
          }
          const { data: cliV, error: eCli } = await supabase
            .from('clientes')
            .select(
              'id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at'
            )
            .eq('id', idVer)
            .eq('business_id', business_id)
            .maybeSingle();
          if (eCli) return { error: eCli.message };
          if (!cliV) return { error: 'Cliente no encontrado' };

          const [presV, facV, albV, dioV] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('id, estado, importe_total, fecha')
              .eq('cliente_id', idVer)
              .eq('business_id', business_id)
              .order('fecha', { ascending: false }),
            supabase
              .from('facturas')
              .select('id, estado, total, fecha, numero_factura')
              .eq('cliente_id', idVer)
              .eq('business_id', business_id)
              .order('fecha', { ascending: false }),
            supabase
              .from('albaranes')
              .select('id, estado, fecha, total, numero_albaran')
              .eq('cliente_id', idVer)
              .eq('business_id', business_id)
              .order('fecha', { ascending: false }),
            supabase
              .from('diario_obra')
              .select('id, obra_nombre, texto, fecha')
              .eq('cliente_id', idVer)
              .eq('business_id', business_id)
              .order('fecha', { ascending: false }),
          ]);

          const c = cliV as Record<string, unknown>;
          const lineas: string[] = [];
          lineas.push(`**${String(c.nombre ?? '')}**`);
          lineas.push(`Teléfono: ${c.telefono != null && String(c.telefono) ? String(c.telefono) : '—'}`);
          lineas.push(`Email: ${c.email != null && String(c.email) ? String(c.email) : '—'}`);
          lineas.push(`Dirección: ${c.direccion != null && String(c.direccion) ? String(c.direccion) : '—'}`);
          lineas.push(`NIF: ${c.nif != null && String(c.nif) ? String(c.nif) : '—'}`);
          if (c.notas != null && String(c.notas).trim()) {
            lineas.push(`Notas: ${String(c.notas).trim()}`);
          }
          lineas.push('');
          lineas.push('### Presupuestos');
          const pv = presV.data ?? [];
          if (pv.length === 0) lineas.push('— Ninguno');
          else {
            for (const p of pv as { fecha?: string; estado?: string; importe_total?: number }[]) {
              lineas.push(
                `- ${p.fecha ?? '—'} · ${p.estado ?? '—'} · ${p.importe_total != null ? `${p.importe_total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Facturas');
          const fv = facV.data ?? [];
          if (fv.length === 0) lineas.push('— Ninguna');
          else {
            for (const f of fv as {
              fecha?: string;
              estado?: string;
              total?: number;
              numero_factura?: string | null;
            }[]) {
              lineas.push(
                `- ${f.numero_factura ?? '—'} · ${f.fecha ?? '—'} · ${f.estado ?? '—'} · ${f.total != null ? `${f.total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Albaranes');
          const av = albV.data ?? [];
          if (av.length === 0) lineas.push('— Ninguno');
          else {
            for (const a of av as {
              fecha?: string;
              estado?: string;
              total?: number | null;
              numero_albaran?: string | null;
            }[]) {
              lineas.push(
                `- ${a.numero_albaran ?? '—'} · ${a.fecha ?? '—'} · ${a.estado ?? '—'} · ${a.total != null ? `${a.total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Diario de obra');
          const dv = dioV.data ?? [];
          if (dv.length === 0) lineas.push('— Sin entradas');
          else {
            for (const d of dv as { fecha?: string; obra_nombre?: string; texto?: string | null }[]) {
              const frag = d.texto != null && String(d.texto).trim() ? String(d.texto).slice(0, 80) : '';
              lineas.push(`- ${d.obra_nombre ?? 'Obra'} (${d.fecha ?? '—'})${frag ? `: ${frag}` : ''}`);
            }
          }

          return {
            ficha: lineas.join('\n'),
            cliente: cliV,
            presupuestos: presV.data ?? [],
            facturas: facV.data ?? [],
            albaranes: albV.data ?? [],
            diario_obra: dioV.data ?? [],
          };
        }
        case 'convertir_presupuesto_a_albaran': {
          const presupuestoId = String(toolArgs.presupuesto_id ?? '').trim();
          const observaciones =
            toolArgs.observaciones != null
              ? String(toolArgs.observaciones).trim()
              : '';
          if (!presupuestoId) return { error: 'presupuesto_id es obligatorio' };

          const { data: pRow, error: pErr } = await supabase
            .from('presupuestos')
            .select('id, estado, cliente_nombre, cliente_id, presupuesto_generado, importe_total')
            .eq('id', presupuestoId)
            .eq('business_id', business_id)
            .maybeSingle();
          if (pErr) return { error: pErr.message };
          if (!pRow) return { error: 'Presupuesto no encontrado' };

          const clienteNombre = (pRow.cliente_nombre ?? '') as string;
          const totalNum =
            pRow.importe_total != null && Number.isFinite(Number(pRow.importe_total))
              ? Number(pRow.importe_total)
              : 0;
          const texto = (pRow.presupuesto_generado ?? '') as string;

          const { error: insertErr } = await supabase.from('albaranes').insert({
            business_id,
            cliente_nombre: clienteNombre || null,
            cliente_id: pRow.cliente_id ?? null,
            descripcion_trabajos: texto || null,
            total: totalNum,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
            observaciones:
              observaciones.length > 0 ? observaciones : 'Generado desde presupuesto',
          });

          if (insertErr) return { error: insertErr.message };

          if ((pRow.estado ?? '').toLowerCase() !== 'aceptado') {
            const { error: updErr } = await supabase
              .from('presupuestos')
              .update({ estado: 'aceptado' })
              .eq('id', presupuestoId)
              .eq('business_id', business_id)
              .select('id')
              .maybeSingle();
            if (updErr) return { error: updErr.message };
          }

          return {
            mensaje:
              `Albarán creado correctamente a partir del presupuesto de ${clienteNombre}.\n` +
              'El presupuesto ha sido marcado como aceptado.',
          };
        }
        case 'convertir_albaran_a_factura': {
          const albaranId = String(toolArgs.albaran_id ?? '').trim();
          const ivaPctRaw = toolArgs.iva ?? 21;
          const observaciones =
            toolArgs.observaciones != null ? String(toolArgs.observaciones).trim() : '';

          if (!albaranId) return { error: 'albaran_id es obligatorio' };
          const iva_porcentaje = Number(ivaPctRaw);
          if (!Number.isFinite(iva_porcentaje)) return { error: 'iva debe ser un número' };

          const { data: aRow, error: aErr } = await supabase
            .from('albaranes')
            .select(
              'id, estado, cliente_nombre, cliente_id, cliente_direccion, descripcion_trabajos, lineas, total'
            )
            .eq('id', albaranId)
            .eq('business_id', business_id)
            .maybeSingle();
          if (aErr) return { error: aErr.message };
          if (!aRow) return { error: 'Albarán no encontrado' };

          const clienteNombre = (aRow.cliente_nombre ?? '') as string;
          const totalNum =
            aRow.total != null && Number.isFinite(Number(aRow.total))
              ? Number(aRow.total)
              : 0;

          const round2 = (n: number) => Math.round(n * 100) / 100;

          let extrasRows: Array<{
            importe_total?: number | null;
            presupuesto_generado?: string | null;
            mensaje_cliente?: string | null;
          }> = [];

          const cidAlb = aRow.cliente_id ?? null;
          const cnTrim = clienteNombre.trim();
          if (cidAlb || cnTrim) {
            let extrasQuery = supabase
              .from('presupuestos')
              .select('importe_total, presupuesto_generado, mensaje_cliente')
              .eq('business_id', business_id)
              .eq('es_extra', true)
              .eq('estado', 'aceptado');
            if (cidAlb) {
              extrasQuery = extrasQuery.eq('cliente_id', cidAlb);
            } else {
              extrasQuery = extrasQuery.ilike('cliente_nombre', cnTrim);
            }
            const { data: extraData, error: exErr } = await extrasQuery;
            if (exErr) return { error: exErr.message };
            extrasRows = (extraData ?? []) as typeof extrasRows;
          }

          let extrasSum = 0;
          const extraLines: string[] = [];
          for (const ex of extrasRows) {
            const imp =
              ex.importe_total != null && Number.isFinite(Number(ex.importe_total))
                ? Number(ex.importe_total)
                : 0;
            extrasSum += imp;
            const texto =
              (ex.presupuesto_generado ?? '').trim() ||
              (ex.mensaje_cliente ?? '').trim() ||
              'Extra';
            extraLines.push(`- ${texto} (${round2(imp).toFixed(2)} €)`);
          }

          const totalConExtras = totalNum + extrasSum;

          let descripcionTrabajos = (aRow.descripcion_trabajos ?? '') || '';
          if (extraLines.length > 0) {
            const bloque = `Extras aceptados (IVA no incluido en importes de extra):\n${extraLines.join('\n')}`;
            descripcionTrabajos = descripcionTrabajos.trim()
              ? `${descripcionTrabajos.trim()}\n\n${bloque}`
              : bloque;
          }

          const base_imponible = round2(totalConExtras / (1 + iva_porcentaje / 100));
          const iva_importe = round2(totalConExtras - base_imponible);

          const { error: insertErr } = await supabase.from('facturas').insert({
            business_id,
            albaran_id: albaranId,
            cliente_nombre: clienteNombre || null,
            cliente_id: aRow.cliente_id ?? null,
            cliente_direccion: aRow.cliente_direccion ?? null,
            descripcion_trabajos: descripcionTrabajos || null,
            lineas: aRow.lineas ?? null,
            base_imponible,
            iva: iva_importe,
            total: totalConExtras,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
            observaciones:
              observaciones.length > 0 ? observaciones : 'Generada desde albarán',
          });

          if (insertErr) return { error: insertErr.message };

          const { error: updErr } = await supabase
            .from('albaranes')
            .update({ estado: 'facturado' })
            .eq('id', albaranId)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();

          if (updErr) return { error: updErr.message };

          const extraNote =
            extrasSum > 0
              ? ` (incluye extras aceptados: ${round2(extrasSum).toFixed(2)}€)`
              : '';

          return {
            mensaje:
              `Factura creada correctamente a partir del albarán de ${clienteNombre}.\n` +
              `Total: ${round2(totalConExtras).toFixed(2)}€${extraNote}. El albarán ha sido marcado como facturado.`,
          };
        }
        case 'obtener_mensajes_pendientes': {
          const { data: convRows, error: convError } = await supabase
            .from('conversation_history')
            .select('conversation_id')
            .eq('business_id', business_id);

          if (convError) {
            console.log('Resultado mensajes:', null, convError);
            return { error: convError.message };
          }

          const conversationIds = [
            ...new Set(
              (convRows ?? [])
                .map((r: { conversation_id?: string | null }) => r.conversation_id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
            ),
          ];

          if (conversationIds.length === 0) {
            console.log('Resultado mensajes:', [], null);
            return { items: [] };
          }

          const { data, error } = await supabase
            .from('ai_responses')
            .select(
              'id, conversation_id, created_at, ai_response, edited_response, approved_at, rejected_at'
            )
            .in('conversation_id', conversationIds)
            .is('approved_at', null)
            .is('rejected_at', null)
            .order('created_at', { ascending: false })
            .limit(50);

          console.log('Resultado mensajes:', data, error);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              conversation_id?: string | null;
              created_at?: string | null;
              ai_response?: string | null;
              edited_response?: string | null;
              approved_at?: string | null;
              rejected_at?: string | null;
            }) => ({
              id: r.id ?? null,
              conversation_id: r.conversation_id ?? null,
              creado_en: r.created_at ?? null,
              respuesta_ia: r.ai_response ?? null,
              borrador_editado: r.edited_response ?? null,
              pendiente_de_aprobacion: !r.approved_at && !r.rejected_at,
            })),
          };
        }
        case 'leer_emails_recientes': {
          const tokenResult = await getGmailAccessToken();
          if ('error' in tokenResult) return { error: tokenResult.error };
          const accessToken = tokenResult.accessToken;

          const listRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (!listRes.ok) {
            return { error: 'No se pudieron leer emails recientes de Gmail' };
          }

          const listJson = (await listRes.json()) as {
            messages?: Array<{ id: string }>;
          };

          const msgIds = listJson.messages ?? [];
          const items: Array<{ remitente: string | null; asunto: string | null; resumen: string | null }> = [];

          for (const msg of msgIds) {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );
            if (!msgRes.ok) continue;

            const msgJson = (await msgRes.json()) as {
              snippet?: string;
              payload?: { headers?: Array<{ name?: string; value?: string }> };
            };

            const headers = msgJson.payload?.headers ?? [];
            const from =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
            const subject =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ??
              null;

            items.push({
              remitente: from,
              asunto: subject,
              resumen: msgJson.snippet ?? null,
            });
          }

          return { items };
        }
        case 'enviar_email': {
          const destinatario = String(toolArgs.destinatario ?? '').trim();
          const asunto = String(toolArgs.asunto ?? '').trim();
          const cuerpo = String(toolArgs.cuerpo ?? '').trim();

          if (!destinatario || !asunto || !cuerpo) {
            return { error: 'Faltan parámetros obligatorios para enviar email' };
          }

          return {
            tipo: 'email_pendiente_aprobacion',
            para: destinatario,
            asunto,
            cuerpo,
          };
        }
        case 'crear_recordatorio': {
          const titulo = String(toolArgs.titulo ?? '').trim();
          const fechaRaw = String(toolArgs.fecha ?? '').trim();
          const horaOpt = toolArgs.hora != null ? String(toolArgs.hora).trim() : '';

          if (!titulo) {
            return { error: 'El título del recordatorio es obligatorio' };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
            return { error: 'La fecha debe tener formato YYYY-MM-DD' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const insertPayload: {
            business_id: string;
            titulo: string;
            fecha: string;
            hora?: string;
          } = {
            business_id: businessIdBody,
            titulo,
            fecha: fechaRaw,
          };
          if (horaOpt) {
            insertPayload.hora = horaOpt;
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .insert(insertPayload)
            .select('id')
            .single();

          if (error || !row?.id) {
            return { error: error?.message ?? 'No se pudo crear el recordatorio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const updates: { titulo?: string; fecha?: string; hora?: string | null } = {};
          if (toolArgs.titulo !== undefined) {
            const t = String(toolArgs.titulo ?? '').trim();
            if (!t) {
              return { error: 'El título no puede estar vacío' };
            }
            updates.titulo = t;
          }
          if (toolArgs.fecha !== undefined) {
            const f = String(toolArgs.fecha ?? '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
              return { error: 'La fecha debe tener formato YYYY-MM-DD' };
            }
            updates.fecha = f;
          }
          if (toolArgs.hora !== undefined) {
            const h = String(toolArgs.hora ?? '').trim();
            updates.hora = h.length > 0 ? h : null;
          }

          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (titulo, fecha u hora)' };
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .update(updates)
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!row?.id) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'eliminar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const { data: deleted, error } = await supabase
            .from('agenda')
            .delete()
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!deleted) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true };
        }
        case 'calcular_medicion': {
          return calcularMedicionObra(toolArgs);
        }
        case 'get_directions': {
          const direccion = String(toolArgs.direccion ?? '').trim();
          const nombreLugar =
            toolArgs.nombre_lugar != null ? String(toolArgs.nombre_lugar).trim() : '';
          if (!direccion) {
            return { error: 'direccion es obligatoria' };
          }
          const url = generarLinkMaps(direccion);
          const label = nombreLugar || direccion;
          return { mensaje: `📍 [${label}](${url})` };
        }
        case 'consultar_tiempo': {
          const ubicacion = String(toolArgs.ubicacion ?? '').trim();
          const diasRaw = toolArgs.dias;
          const dias = diasRaw === 2 ? 2 : 1;
          if (!ubicacion) {
            return { error: 'ubicacion es obligatoria' };
          }
          if (!process.env.OPENWEATHER_API_KEY?.trim()) {
            return {
              error: 'Servicio meteorológico no configurado (OPENWEATHER_API_KEY).',
            };
          }
          try {
            const geo = await geocodeDireccion(ubicacion);
            let preds: PrediccionMeteo[];
            let etiqueta = ubicacion;
            if (geo) {
              preds = await getPrediccionPorCoordenadas(geo.lat, geo.lon);
              etiqueta = geo.name;
            } else {
              preds = await getPrediccionPorCiudad(ubicacion);
            }
            const slice = preds.slice(0, dias);
            if (slice.length === 0) {
              return {
                mensaje: 'No se pudo obtener la previsión para esa ubicación.',
              };
            }
            const mensaje = formatearMensajeConsultaTiempo(slice, etiqueta);
            return { mensaje, items: slice };
          } catch (e) {
            return {
              error: e instanceof Error ? e.message : 'Error al consultar el tiempo',
            };
          }
        }
        case 'registrar_extra': {
          const descripcion = String(toolArgs.descripcion ?? '').trim();
          const importeNum = Number(toolArgs.importe);
          const parentIdRaw = String(toolArgs.presupuesto_parent_id ?? '').trim();
          const clienteNombreParam =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const notificar = toolArgs.notificar_cliente !== false;
          const explicitObraExtra =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;

          if (!descripcion) return { error: 'descripcion es obligatoria' };
          if (!Number.isFinite(importeNum) || importeNum < 0) {
            return { error: 'importe debe ser un número válido' };
          }

          const r2 = (n: number) => Math.round(n * 100) / 100;
          const impFmt = r2(importeNum).toFixed(2);

          type ParentRow = {
            id: string;
            cliente_nombre: string | null;
            cliente_id: string | null;
          };

          let parent: ParentRow | null = null;

          if (parentIdRaw) {
            const { data: p, error: pe } = await supabase
              .from('presupuestos')
              .select('id, cliente_nombre, cliente_id')
              .eq('id', parentIdRaw)
              .eq('business_id', business_id)
              .maybeSingle();
            if (pe) return { error: pe.message };
            if (!p) return { error: 'No se encontró el presupuesto padre' };
            parent = p as ParentRow;
          } else if (clienteNombreParam) {
            const safe = clienteNombreParam.replace(/[%_]/g, '').slice(0, 120);
            if (!safe) return { error: 'cliente_nombre no válido' };
            const pat = `%${safe}%`;
            const { data: p, error: pe } = await supabase
              .from('presupuestos')
              .select('id, cliente_nombre, cliente_id')
              .eq('business_id', business_id)
              .eq('es_extra', false)
              .neq('estado', 'rechazado')
              .ilike('cliente_nombre', pat)
              .order('fecha', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (pe) return { error: pe.message };
            if (!p) {
              return {
                error:
                  'No se encontró un presupuesto activo reciente para ese cliente. Indica presupuesto_parent_id o crea el presupuesto antes.',
              };
            }
            parent = p as ParentRow;
          } else {
            return {
              error:
                'Indica presupuesto_parent_id o cliente_nombre para vincular el extra al presupuesto original.',
            };
          }

          const clienteNombreFinal =
            (parent.cliente_nombre && String(parent.cliente_nombre).trim()) ||
            clienteNombreParam ||
            'Cliente';

          const textoObraExtra = [descripcion, clienteNombreParam, mensajeTrim]
            .filter(Boolean)
            .join(' ')
            .trim();
          const obraExtraRes = await resolverObraDocumentoAgente(
            supabase,
            business_id,
            explicitObraExtra,
            textoObraExtra,
            'extra'
          );
          if (!obraExtraRes.ok) return { mensaje: obraExtraRes.mensaje };
          const obraIdExtra = obraExtraRes.obra_id ?? '';

          const { error: insErr } = await supabase.from('presupuestos').insert({
            business_id,
            parent_id: parent.id,
            es_extra: true,
            presupuesto_generado: descripcion,
            importe_total: importeNum,
            cliente_nombre: clienteNombreFinal,
            cliente_id: parent.cliente_id ?? null,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
            mensaje_cliente: `EXTRA/MODIFICADO: ${descripcion}`,
            ...(obraIdExtra ? { obra_id: obraIdExtra } : {}),
          });

          if (insErr) return { error: insErr.message };

          let baseMsg =
            `Extra registrado correctamente: '${descripcion}' por ${impFmt}€, vinculado al presupuesto de ${clienteNombreFinal}.`;

          if (!notificar) {
            return { mensaje: baseMsg };
          }

          let emailCliente: string | null = null;
          if (parent.cliente_id) {
            const { data: cli, error: cErr } = await supabase
              .from('clientes')
              .select('email')
              .eq('id', parent.cliente_id)
              .eq('business_id', business_id)
              .maybeSingle();
            if (!cErr && cli?.email != null) {
              const em = String(cli.email).trim();
              if (em) emailCliente = em;
            }
          }

          if (!emailCliente) {
            return {
              mensaje:
                baseMsg +
                ' No hay email del cliente en ficha: no se preparó borrador de notificación.',
            };
          }

          const cuerpo =
            `Hola ${clienteNombreFinal}, según lo hablado en obra, se ha detectado el siguiente imprevisto: ${descripcion}. El coste adicional será de ${impFmt}€ (IVA no incluido). Por favor, confírmenos su aprobación para proceder. Quedamos a su disposición.`;

          return {
            mensaje:
              baseMsg +
              ' He preparado un borrador de notificación al cliente. ¿Lo enviamos?',
            tipo: 'email_pendiente_aprobacion',
            para: emailCliente,
            asunto: `Imprevisto / extra en obra — ${clienteNombreFinal}`,
            cuerpo,
          };
        }
        case 'listar_extras': {
          const cn =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const pid =
            toolArgs.presupuesto_parent_id != null
              ? String(toolArgs.presupuesto_parent_id).trim()
              : '';

          let q = supabase
            .from('presupuestos')
            .select('id, presupuesto_generado, importe_total, cliente_nombre, fecha, estado, parent_id')
            .eq('business_id', business_id)
            .eq('es_extra', true)
            .order('fecha', { ascending: false })
            .limit(50);

          if (pid) {
            q = q.eq('parent_id', pid);
          }
          if (cn) {
            const safe = cn.replace(/[%_]/g, '').slice(0, 120);
            if (safe) {
              const pat = `%${safe}%`;
              q = q.ilike('cliente_nombre', pat);
            }
          }

          const { data, error } = await q;
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map(
              (r: {
                id?: string;
                presupuesto_generado?: string | null;
                importe_total?: number | null;
                cliente_nombre?: string | null;
                fecha?: string | null;
                estado?: string | null;
              }) => ({
                id: r.id ?? null,
                descripcion: r.presupuesto_generado ?? null,
                importe: r.importe_total ?? null,
                cliente: r.cliente_nombre ?? null,
                fecha: r.fecha ?? null,
                estado: r.estado ?? null,
              })
            ),
          };
        }
        case 'generar_presupuesto_por_dictado': {
          const dictado = String(toolArgs.dictado ?? '').trim();
          const clienteNombre =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const direccionObra =
            toolArgs.direccion_obra != null
              ? String(toolArgs.direccion_obra).trim().slice(0, 500)
              : '';

          if (!dictado) return { error: 'dictado es obligatorio' };

          const cr = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };

          const explicitObra =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;

          let obraIdFinal = '';
          if (explicitObra) {
            const { data: obraRow, error: obraErr } = await supabase
              .from('obras')
              .select('id')
              .eq('business_id', business_id)
              .eq('id', explicitObra)
              .in('estado', ['abierta', 'en_curso'])
              .maybeSingle();
            if (obraErr || !obraRow?.id) {
              return { error: 'La obra indicada no existe o no está abierta.' };
            }
            obraIdFinal = obraRow.id;
          } else {
            const textoObra = [dictado, clienteNombre, direccionObra, mensajeTrim]
              .filter(Boolean)
              .join(' ')
              .trim();
            const obraRes = await resolverObraDocumentoAgente(
              supabase,
              business_id,
              undefined,
              textoObra,
              'documento'
            );
            if (!obraRes.ok) return { mensaje: obraRes.mensaje };
            obraIdFinal = obraRes.obra_id ?? '';
          }

          let clienteIdFinal = cr.id;
          let clienteNombreParaDoc = clienteNombre;
          if (obraIdFinal && cr.id == null) {
            const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
              supabase,
              business_id,
              obraIdFinal
            );
            if (cidO) {
              clienteIdFinal = cidO;
              if (cnO) clienteNombreParaDoc = cnO;
            }
          }

          const { data: tarifasRows, error: tErr } = await supabase
            .from('tarifas')
            .select('nombre, unidad, precio, categoria')
            .eq('business_id', business_id)
            .order('nombre', { ascending: true });

          if (tErr) return { error: tErr.message };

          const tarifasPropias = (tarifasRows ?? []) as Array<{
            nombre: string;
            unidad: string;
            precio: number | string;
            categoria: string | null;
          }>;

          const tarifasForApi: TarifaReferencia[] =
            tarifasPropias.length > 0
              ? tarifasPropias.map((r) => ({
                  nombre: r.nombre,
                  unidad: r.unidad,
                  precio: Number(r.precio),
                  categoria: (r.categoria ?? '').trim() || 'varios',
                }))
              : TARIFAS_BASE_ALBANILERIA.map((r) => ({
                  nombre: r.nombre,
                  unidad: r.unidad,
                  precio: r.precio,
                  categoria: r.categoria,
                }));

          let partidas;
          try {
            partidas = await estructurarDictadoEnPartidas(dictado, tarifasForApi);
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'Error al estructurar el dictado' };
          }

          const { texto, totalConIva } = formatearBorradorPresupuestoDictado(
            partidas,
            clienteNombreParaDoc,
            direccionObra
          );

          const mensajeClienteDictado =
            typeof mensaje === 'string' && mensaje.trim().length > 0
              ? mensaje.trim().slice(0, 2000)
              : 'Presupuesto generado por dictado de visita';

          const { error: insErr } = await supabase.from('presupuestos').insert({
            business_id,
            presupuesto_generado: texto,
            importe_total: totalConIva,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'borrador',
            mensaje_cliente: mensajeClienteDictado,
            ...(clienteNombreParaDoc.length > 0 && { cliente_nombre: clienteNombreParaDoc }),
            ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
            ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
          });

          if (insErr) return { error: insErr.message };

          return {
            mensaje:
              `Borrador generado y guardado (revisa importes y textos).\n\n${texto}`,
            partidas,
            importe_total: totalConIva,
          };
        }
        case 'gestionar_tarifas': {
          const accion = String(toolArgs.accion ?? '').trim().toLowerCase();
          if (!['listar', 'añadir', 'editar'].includes(accion)) {
            return { error: 'accion debe ser listar, añadir o editar' };
          }

          if (accion === 'listar') {
            const { data, error } = await supabase
              .from('tarifas')
              .select('id, nombre, unidad, precio, categoria, created_at')
              .eq('business_id', business_id)
              .order('nombre', { ascending: true });
            if (error) return { error: error.message };
            return {
              items: (data ?? []).map(
                (r: {
                  id: string;
                  nombre: string;
                  unidad: string;
                  precio: number | string;
                  categoria: string | null;
                  created_at?: string;
                }) => ({
                  id: r.id,
                  nombre: r.nombre,
                  unidad: r.unidad,
                  precio: r.precio != null ? Number(r.precio) : null,
                  categoria: r.categoria,
                  created_at: r.created_at ?? null,
                })
              ),
            };
          }

          if (accion === 'añadir') {
            const nombre = String(toolArgs.nombre ?? '').trim();
            const unidad = String(toolArgs.unidad ?? '').trim();
            const precio = Number(toolArgs.precio);
            const categoria =
              toolArgs.categoria != null ? String(toolArgs.categoria).trim().slice(0, 120) : '';
            if (!nombre) return { error: 'nombre es obligatorio para añadir' };
            if (!unidad) return { error: 'unidad es obligatoria para añadir' };
            if (!Number.isFinite(precio) || precio < 0) {
              return { error: 'precio debe ser un número válido' };
            }

            const { data: row, error } = await supabase
              .from('tarifas')
              .insert({
                business_id,
                nombre,
                unidad,
                precio,
                ...(categoria ? { categoria } : { categoria: null }),
              })
              .select('id')
              .single();
            if (error) return { error: error.message };
            return { ok: true, id: row?.id as string, mensaje: `Tarifa "${nombre}" añadida.` };
          }

          if (accion === 'editar') {
            const tarifaId = String(toolArgs.tarifa_id ?? '').trim();
            if (!tarifaId) return { error: 'tarifa_id es obligatorio para editar' };
            const updates: Record<string, unknown> = {};
            if (toolArgs.nombre !== undefined) {
              const n = String(toolArgs.nombre).trim();
              if (!n) return { error: 'nombre no puede estar vacío' };
              updates.nombre = n;
            }
            if (toolArgs.unidad !== undefined) {
              const u = String(toolArgs.unidad).trim();
              if (!u) return { error: 'unidad no puede estar vacía' };
              updates.unidad = u;
            }
            if (toolArgs.precio !== undefined) {
              const pr = Number(toolArgs.precio);
              if (!Number.isFinite(pr) || pr < 0) return { error: 'precio inválido' };
              updates.precio = pr;
            }
            if (toolArgs.categoria !== undefined) {
              updates.categoria = String(toolArgs.categoria).trim() || null;
            }
            if (Object.keys(updates).length === 0) {
              return {
                error:
                  'Indica al menos un campo a editar (nombre, unidad, precio, categoria)',
              };
            }
            updates.updated_at = new Date().toISOString();
            const { data: row, error } = await supabase
              .from('tarifas')
              .update(updates)
              .eq('id', tarifaId)
              .eq('business_id', business_id)
              .select('id')
              .maybeSingle();
            if (error) return { error: error.message };
            if (!row?.id) return { error: 'Tarifa no encontrada' };
            return { ok: true, id: row.id as string, mensaje: 'Tarifa actualizada.' };
          }

          return { error: 'accion no reconocida' };
        }
        case 'registrar_gasto_ticket': {
          const proveedor = String(toolArgs.proveedor ?? '').trim();
          const importe = Number(toolArgs.importe);
          const iva = Number(toolArgs.iva);
          const importeTotal = Number(toolArgs.importe_total);
          const fecha = String(toolArgs.fecha ?? '').trim();
          const descripcion = String(toolArgs.descripcion ?? '').trim();
          const businessIdGasto =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdGasto) {
            return { error: 'business_id es requerido' };
          }

          const crGasto = await resolveClienteIdOpcional(toolArgs.cliente_id);
          if (!crGasto.ok) return { error: crGasto.error };

          const explicitObraGasto =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;
          const textoObraGasto = [descripcion, proveedor, mensajeTrim].filter(Boolean).join(' ').trim();
          const obraGastoRes = await resolverObraDocumentoAgente(
            supabase,
            businessIdGasto,
            explicitObraGasto,
            textoObraGasto,
            'gasto'
          );
          if (!obraGastoRes.ok) return { mensaje: obraGastoRes.mensaje };
          const obraIdFinal = obraGastoRes.obra_id ?? '';

          let clienteIdGasto: string | null = crGasto.id;
          if (obraIdFinal && crGasto.id == null) {
            const { cliente_id: cidO } = await clienteDesdeObraSiAplica(
              supabase,
              businessIdGasto,
              obraIdFinal
            );
            if (cidO) clienteIdGasto = cidO;
          }

          if (!proveedor) {
            return { error: 'El proveedor es obligatorio' };
          }
          if (
            !Number.isFinite(importe) ||
            !Number.isFinite(iva) ||
            !Number.isFinite(importeTotal)
          ) {
            return { error: 'importe, iva e importe_total deben ser números válidos' };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return { error: 'La fecha debe tener formato YYYY-MM-DD' };
          }

          const { data: row, error } = await supabase
            .from('gastos')
            .insert({
              business_id: businessIdGasto,
              proveedor,
              importe,
              iva,
              importe_total: importeTotal,
              fecha,
              descripcion: descripcion.length > 0 ? descripcion : null,
              ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
              ...(clienteIdGasto ? { cliente_id: clienteIdGasto } : {}),
            })
            .select('id')
            .single();

          if (error || !row?.id) {
            return { error: error?.message ?? 'No se pudo registrar el gasto' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'vincular_gasto': {
          const gastoId = String(toolArgs.gasto_id ?? '').trim();
          const documentosRaw = toolArgs.documentos;

          const businessIdVinc =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdVinc) {
            return { error: 'business_id es requerido' };
          }

          const uuidRe =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (!gastoId || !uuidRe.test(gastoId)) {
            return { error: 'gasto_id debe ser un UUID válido' };
          }
          if (!Array.isArray(documentosRaw) || documentosRaw.length === 0) {
            return { error: 'documentos debe ser un array con al menos un elemento' };
          }

          const { data: gastoRow, error: gastoErr } = await supabase
            .from('gastos')
            .select('id')
            .eq('id', gastoId)
            .eq('business_id', businessIdVinc)
            .maybeSingle();

          if (gastoErr) {
            return { error: `No se pudo comprobar el gasto: ${gastoErr.message}` };
          }
          if (!gastoRow?.id) {
            return { error: 'No se encontró el gasto o no pertenece a este negocio' };
          }

          type DocItem = { tipo: 'factura' | 'albaran'; id: string };
          const documentos: DocItem[] = [];
          for (let i = 0; i < documentosRaw.length; i++) {
            const item = documentosRaw[i];
            if (!item || typeof item !== 'object') {
              return { error: `documentos[${i}] debe ser un objeto con tipo e id` };
            }
            const o = item as Record<string, unknown>;
            const tipo = String(o.tipo ?? '').toLowerCase();
            const docId = String(o.id ?? '').trim();
            if (tipo !== 'factura' && tipo !== 'albaran') {
              return {
                error: `documentos[${i}].tipo debe ser "factura" o "albaran"`,
              };
            }
            if (!docId || !uuidRe.test(docId)) {
              return { error: `documentos[${i}].id debe ser un UUID válido` };
            }
            documentos.push({ tipo: tipo as 'factura' | 'albaran', id: docId });
          }

          for (let i = 0; i < documentos.length; i++) {
            const d = documentos[i];
            const tabla = d.tipo === 'factura' ? 'facturas' : 'albaranes';
            const { data: docRow, error: docErr } = await supabase
              .from(tabla)
              .select('id')
              .eq('id', d.id)
              .eq('business_id', businessIdVinc)
              .maybeSingle();

            if (docErr) {
              return {
                error: `No se pudo comprobar el documento (${d.tipo}): ${docErr.message}`,
              };
            }
            if (!docRow?.id) {
              return {
                error: `No se encontró la ${d.tipo} indicada o no pertenece a este negocio`,
              };
            }
          }

          const filas = documentos.map((d) => ({
            business_id: businessIdVinc,
            gasto_id: gastoId,
            documento_tipo: d.tipo,
            documento_id: d.id,
          }));

          const { error: insErr } = await supabase.from('gastos_documentos').insert(filas);

          if (insErr) {
            return {
              error: `No se pudo vincular el gasto: ${insErr.message}`,
            };
          }

          const n = documentos.length;
          return {
            mensaje: `Gasto vinculado correctamente a ${n} documento(s).`,
          };
        }
        case 'crear_entrada_diario': {
          const obraNombreDiario = String(toolArgs.obra_nombre ?? '').trim();
          if (!obraNombreDiario) {
            return { error: 'obra_nombre es obligatorio' };
          }
          const businessIdDiario =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdDiario) {
            return { error: 'business_id es requerido' };
          }
          const obraDireccionDiario =
            toolArgs.obra_direccion != null
              ? String(toolArgs.obra_direccion).trim()
              : undefined;
          const textoDiario =
            toolArgs.texto != null ? String(toolArgs.texto).trim() : undefined;
          const fotosDiario = Array.isArray(toolArgs.fotos)
            ? toolArgs.fotos.filter(
                (u): u is string => typeof u === 'string' && u.trim().length > 0
              )
            : undefined;
          const videosDiario = Array.isArray(toolArgs.videos)
            ? toolArgs.videos.filter(
                (u): u is string => typeof u === 'string' && u.trim().length > 0
              )
            : undefined;

          const explicitObraDiario =
            typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
              ? String(toolArgs.obra_id).trim()
              : undefined;
          const textoDetDiario = [obraNombreDiario, textoDiario, mensajeTrim]
            .filter(Boolean)
            .join(' ')
            .trim();
          const obraDiarioRes = await resolverObraDocumentoAgente(
            supabase,
            businessIdDiario,
            explicitObraDiario,
            textoDetDiario,
            'entrada_diario'
          );
          if (!obraDiarioRes.ok) return { mensaje: obraDiarioRes.mensaje };

          const obraIdFinal = obraDiarioRes.obra_id ?? '';
          const nombreObraDiario =
            obraDiarioRes.obra_nombre ?? obraNombreDiario;

          const { data: entradaCreada, error: errDiario } = await insertDiarioObraEntry(
            supabase,
            {
              business_id: businessIdDiario,
              obra_nombre: nombreObraDiario,
              obra_id: obraIdFinal || null,
              obra_direccion: obraDireccionDiario || null,
              texto: textoDiario || null,
              fotos: fotosDiario ?? null,
              videos: videosDiario ?? null,
            }
          );

          if (errDiario || !entradaCreada) {
            return {
              error: errDiario?.message ?? 'No se pudo crear la entrada del diario',
            };
          }

          const fechaLargaDiario = new Date(entradaCreada.fecha).toLocaleDateString('es-ES', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });

          return {
            mensaje: `Entrada registrada en el diario de '${entradaCreada.obra_nombre}' para el ${fechaLargaDiario}. ¿Quieres generar el PDF del diario completo de esta obra?`,
            id: entradaCreada.id,
          };
        }
        case 'mostrar_vista_visual': {
          const tipoRaw = String(toolArgs.tipo ?? '').trim();
          const titulo = String(toolArgs.titulo ?? '').trim();
          const datosRaw = toolArgs.datos;
          const allowed = new Set([
            'presupuestos',
            'facturas',
            'albaranes',
            'clientes',
            'emails',
            'gastos',
            'diario',
          ]);
          if (!allowed.has(tipoRaw)) {
            return {
              error: `tipo inválido; use uno de: ${[...allowed].join(', ')}`,
            };
          }
          if (!titulo) {
            return { error: 'titulo es obligatorio' };
          }
          let datosNorm = normalizarDatosCanvasVista(datosRaw);

          const extraerItems = (r: unknown): unknown[] | null => {
            if (!r || typeof r !== 'object') return null;
            const o = r as Record<string, unknown>;
            if (Array.isArray(o.items)) return o.items;
            return null;
          };

          if (datosNorm.length === 0) {
            switch (tipoRaw) {
              case 'presupuestos': {
                const r = await runTool('listar_presupuestos', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback presupuestos:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'facturas': {
                const r = await runTool('listar_facturas', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback facturas:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'albaranes': {
                const r = await runTool('listar_albaranes', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback albaranes:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'clientes': {
                const bidC =
                  typeof business_id === 'string'
                    ? business_id
                    : String(business_id ?? '');
                if (bidC) {
                  const { data: clist, error: errCl } = await supabase
                    .from('clientes')
                    .select('id, nombre, telefono, email')
                    .eq('business_id', bidC)
                    .order('nombre', { ascending: true })
                    .limit(50);
                  if (errCl) {
                    console.error('[agente] mostrar_vista_visual fallback clientes:', errCl);
                  } else {
                    const rowsC = clist ?? [];
                    const idsC = rowsC.map((row: { id: string }) => row.id);
                    if (idsC.length === 0) {
                      datosNorm = [];
                    } else {
                      const [pC, fC, aC] = await Promise.all([
                        supabase
                          .from('presupuestos')
                          .select('cliente_id')
                          .eq('business_id', bidC)
                          .in('cliente_id', idsC),
                        supabase
                          .from('facturas')
                          .select('cliente_id')
                          .eq('business_id', bidC)
                          .in('cliente_id', idsC),
                        supabase
                          .from('albaranes')
                          .select('cliente_id')
                          .eq('business_id', bidC)
                          .in('cliente_id', idsC),
                      ]);
                      const cnt = (rows: { cliente_id: string | null }[] | null) => {
                        const m = new Map<string, number>();
                        for (const id0 of idsC) m.set(id0, 0);
                        for (const row of rows ?? []) {
                          const cid = row.cliente_id;
                          if (!cid) continue;
                          m.set(cid, (m.get(cid) ?? 0) + 1);
                        }
                        return m;
                      };
                      const mPc = cnt(pC.data as { cliente_id: string | null }[] | null);
                      const mFc = cnt(fC.data as { cliente_id: string | null }[] | null);
                      const mAc = cnt(aC.data as { cliente_id: string | null }[] | null);
                      datosNorm = rowsC.map(
                        (row: {
                          id: string;
                          nombre: string;
                          telefono: string | null;
                          email: string | null;
                        }) => ({
                          id: row.id,
                          nombre: row.nombre,
                          telefono: row.telefono,
                          email: row.email,
                          num_documentos:
                            (mPc.get(row.id) ?? 0) +
                            (mFc.get(row.id) ?? 0) +
                            (mAc.get(row.id) ?? 0),
                        })
                      );
                    }
                  }
                }
                break;
              }
              case 'emails': {
                const r = await runTool('leer_emails_recientes', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback emails:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'gastos': {
                const bid =
                  typeof business_id === 'string'
                    ? business_id
                    : String(business_id ?? '');
                if (!bid) break;
                const { data, error } = await supabase
                  .from('gastos')
                  .select('id, proveedor, importe, iva, importe_total, fecha, descripcion')
                  .eq('business_id', bid)
                  .order('fecha', { ascending: false })
                  .limit(10);
                if (error) {
                  console.error('[agente] mostrar_vista_visual fallback gastos:', error);
                } else {
                  datosNorm = data ?? [];
                }
                break;
              }
              case 'diario': {
                const bid =
                  typeof business_id === 'string'
                    ? business_id
                    : String(business_id ?? '');
                if (!bid) break;
                const { data, error } = await supabase
                  .from('diario_obra')
                  .select(
                    'id, obra_nombre, obra_direccion, texto, fotos, videos, fecha, created_at'
                  )
                  .eq('business_id', bid)
                  .order('fecha', { ascending: false })
                  .limit(10);
                if (error) {
                  console.error('[agente] mostrar_vista_visual fallback diario:', error);
                } else {
                  datosNorm = data ?? [];
                }
                break;
              }
              default:
                break;
            }
          }

          return {
            accion: 'abrir_canvas',
            tipo: tipoRaw,
            titulo,
            datos: datosNorm,
          };
        }
        case 'generar_pdf_diario': {
          const obraNombrePdf = String(toolArgs.obra_nombre ?? '').trim();
          if (!obraNombrePdf) {
            return { error: 'obra_nombre es obligatorio' };
          }
          const businessIdPdfDiario =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdPdfDiario) {
            return { error: 'business_id es requerido' };
          }

          const { data: entradasPdf, error: listPdfErr } = await fetchDiarioObraEntries(
            supabase,
            businessIdPdfDiario,
            obraNombrePdf
          );
          if (listPdfErr || !entradasPdf) {
            return { error: listPdfErr?.message ?? 'No se pudieron leer las entradas' };
          }
          if (entradasPdf.length === 0) {
            return { error: 'No hay entradas en el diario para esa obra' };
          }

          let pdfBytes: Uint8Array;
          try {
            pdfBytes = await buildDiarioObraPdf(entradasPdf);
          } catch (e) {
            console.error('buildDiarioObraPdf', e);
            return { error: 'No se pudo generar el PDF' };
          }

          const dateTagPdf = new Date().toISOString().slice(0, 10);
          const safeObraPdf = sanitizeDiarioFilePart(obraNombrePdf);
          const pdfPath = `${businessIdPdfDiario}/pdfs/diario_${safeObraPdf}_${dateTagPdf}.pdf`;

          const { error: upPdfErr } = await supabase.storage
            .from('diario-obra')
            .upload(pdfPath, pdfBytes, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (upPdfErr) {
            return { error: `No se pudo guardar el PDF: ${upPdfErr.message}` };
          }

          const { data: signedPdf, error: signPdfErr } = await supabase.storage
            .from('diario-obra')
            .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);

          if (signPdfErr || !signedPdf?.signedUrl) {
            return {
              error: signPdfErr?.message ?? 'No se pudo generar enlace de descarga del PDF',
            };
          }

          return {
            mensaje:
              'PDF del diario generado. El usuario puede descargarlo con el enlace (válido varios días).',
            url: signedPdf.signedUrl,
          };
        }
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

    /** Máximo de rondas tool → API; la última usa tool_choice "none" para obligar respuesta en texto. */
    const MAX_TOOL_ROUNDS = 5;

    let emailPendienteParaCliente: { para: string; asunto: string; cuerpo: string } | null = null;

    let canvasParaCliente: { tipo: string; titulo: string; datos: unknown[] } | null = null;

    let obraFichaParaCliente:
      | { obra_id: string; obra_nombre: string }
      | null = null;

    const capturarCanvas = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.accion !== 'abrir_canvas') return;
      const tipo = String(o.tipo ?? '').trim();
      const titulo = String(o.titulo ?? '').trim();
      if (!tipo || !titulo) return;
      const datos = normalizarDatosCanvasVista(o.datos);
      canvasParaCliente = { tipo, titulo, datos };
    };

    const capturarEmailPendiente = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.tipo !== 'email_pendiente_aprobacion') return;
      if (
        typeof o.para !== 'string' ||
        typeof o.asunto !== 'string' ||
        typeof o.cuerpo !== 'string'
      ) {
        return;
      }
      emailPendienteParaCliente = {
        para: o.para,
        asunto: o.asunto,
        cuerpo: o.cuerpo,
      };
    };

    const capturarObraFicha = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.accion !== 'abrir_ficha_obra') return;
      const obra_id = String(o.obra_id ?? '').trim();
      const obra_nombre = String(o.obra_nombre ?? '').trim();
      if (!obra_id) return;
      obraFichaParaCliente = { obra_id, obra_nombre };
    };

    let assistantMessage = firstMessage;
    let respuesta = assistantMessage?.content ?? '';

    for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound++) {
      const toolCalls = assistantMessage?.tool_calls;
      if (!toolCalls?.length) break;

      messages.push({
        role: 'assistant',
        content: assistantMessage!.content ?? null,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch (e) {
          console.error('[agente] JSON.parse tool arguments:', toolCall.function.name, e);
          parsedArgs = {};
        }
        let toolResult: unknown;
        try {
          toolResult = await runTool(toolCall.function.name, parsedArgs);
        } catch (e) {
          console.error('[agente] runTool:', toolCall.function.name, e);
          toolResult = {
            error: e instanceof Error ? e.message : 'Error al ejecutar la herramienta',
          };
        }
        capturarEmailPendiente(toolResult);
        capturarCanvas(toolResult);
        capturarObraFicha(toolResult);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      const isLastToolRound = toolRound >= MAX_TOOL_ROUNDS - 1;
      const nextCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: isLastToolRound ? 'none' : 'auto',
        temperature: 0.7,
        max_tokens: maxTokensAgente,
      });

      assistantMessage = nextCompletion.choices[0]?.message;
      const nextContent = assistantMessage?.content;
      if (typeof nextContent === 'string' && nextContent.trim().length > 0) {
        respuesta = nextContent;
      }
    }

    if (!String(respuesta ?? '').trim()) {
      respuesta =
        'No he podido generar una respuesta en texto. Prueba a reformular la pregunta o inténtalo de nuevo.';
    }

    respuesta = enriquecerTextoConMaps(String(respuesta ?? ''));

    return NextResponse.json({
      respuesta,
      email_pendiente: emailPendienteParaCliente,
      canvas: canvasParaCliente,
      obra_modal: obraFichaParaCliente,
    });
  } catch (error) {
    console.error('Error en /api/agente:', error);
    return NextResponse.json(
      { error: 'Error al generar la respuesta del agente' },
      { status: 500 }
    );
  }
}
