import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  capturarEmailPendiente,
  CORREO_AGENT_TOOLS,
  CORREO_HANDLED_TOOLS,
  handleCorreoAgent,
} from '@/lib/agente/modules/correo';
import { enriquecerTextoConMaps, generarLinkMaps } from '@/lib/maps';
import {
  type PrediccionMeteo,
  formatearMensajeConsultaTiempo,
  geocodeDireccion,
  getPrediccionPorCiudad,
  getPrediccionPorCoordenadas,
} from '@/lib/weather';
import {
  buildMemoriaNegocioPromptBlock,
  deleteMemoriaNegocioByClave,
  esCategoriaMemoriaValida,
  MEMORIA_CATEGORIAS,
  upsertMemoriaNegocio,
} from '@/lib/memoria-negocio';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OPERARIOS_AGENT_SYSTEM_PROMPT,
  OPERARIOS_AGENT_TOOLS,
  ejecutarConsultarHorasObra,
  ejecutarConsultarHorasOperario,
  ejecutarEliminarRegistroJornada,
  ejecutarListarOperarios,
  ejecutarRegistrarJornada,
} from '@/lib/agente/modules/operarios';
import {
  DIARIO_AGENT_SYSTEM_PROMPT,
  DIARIO_AGENT_TOOLS,
  DIARIO_HANDLED_TOOLS,
  handleDiario,
} from '@/lib/agente/modules/diario';
import {
  handlePresupuestos,
  PRESUPUESTOS_AGENT_SYSTEM_PROMPT,
  PRESUPUESTOS_AGENT_TOOLS,
  PRESUPUESTOS_HANDLED_TOOLS,
} from '@/lib/agente/modules/presupuestos';
import {
  AGENDA_AGENT_TOOLS,
  AGENDA_AGENT_SYSTEM_PROMPT,
  AGENDA_HANDLED_TOOLS,
  handleAgenda,
} from '@/lib/agente/modules/agenda';
import {
  GASTOS_AGENT_SYSTEM_PROMPT,
  GASTOS_AGENT_TOOLS,
  GASTOS_HANDLED_TOOLS,
  handleGastosAgent,
} from '@/lib/agente/modules/gastos';
import {
  DOCUMENTOS_AGENT_TOOLS,
  DOCUMENTOS_HANDLED_TOOLS,
  editar_factura,
  handleDocumentosAgent,
} from '@/lib/agente/modules/documentos';
import {
  OBRAS_CLIENTES_AGENT_TOOLS,
  OBRAS_CLIENTES_HANDLED_TOOLS,
  capturarObraFicha,
  handleObrasClientesAgent,
} from '@/lib/agente/modules/obras-clientes';
import {
  CANVAS_AGENT_TOOLS,
  handleMostrarVistaVisual,
  normalizarDatosCanvasVista,
} from '@/lib/agente/modules/canvas';
import {
  CALCULO_AGENT_TOOLS,
  handleCalcularMedicion,
} from '@/lib/agente/modules/calculo';
import { applyPerfilioGuardrails, type PlannedTool } from '@/lib/agente/guardrails';
import { extractDiarioObraObjectPath } from '@/lib/diario-obra';

async function assertUserCanAccessBusiness(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  const businessUsersQuery = supabase.from('business_users');
  if ('select' in businessUsersQuery && typeof businessUsersQuery.select === 'function') {
    const { data } = await businessUsersQuery
      .select('business_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.business_id) return true;
  }

  const { data } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

const IMAGEN_VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGEN_DECODED_BYTES = 4 * 1024 * 1024;

/** URL http(s) para visión (p. ej. firmada de Storage); el sidebar envía imagenesUrls, no base64. */
function normalizarImagenUrlVision(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  return u;
}

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
    // Tras `data:` el tipo MIME va hasta el primer `;` o `,` (RFC 2397). Si usamos el índice de
    // `;base64,` como fin, un `;charset=utf-8` intermedio deja `image/jpeg;charset=utf-8` y falla la validación.
    const rest = s.slice('data:'.length);
    const idxSemi = rest.indexOf(';');
    const idxComma = rest.indexOf(',');
    let endMime = -1;
    if (idxSemi !== -1 && idxComma !== -1) endMime = Math.min(idxSemi, idxComma);
    else if (idxSemi !== -1) endMime = idxSemi;
    else if (idxComma !== -1) endMime = idxComma;
    else return null;
    mime = rest.slice(0, endMime).toLowerCase();
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

type AgentIntentCategory =
  | 'documentos'
  | 'emails'
  | 'agenda'
  | 'gastos'
  | 'diario'
  | 'clientes'
  | 'calculo'
  | 'operarios'
  | 'presupuesto'
  | 'general';

const ROUTER_SYSTEM_PROMPT = `Eres un clasificador de intención (una sola categoría de salida).

PRIORIDAD DE SEÑALES EXPLÍCITAS (aplica la primera categoría coherente; no mezcles con otras salvo ambigüedad real):
- operarios: registrar o consultar horas de trabajo en obra, control de horas, horas de obra, horas de operarios, parte de horas, fichar jornada, convenio vs horas reales, "cuántas horas llevamos", etc. Incluye frases típicas: "registrar horas", "horas de obra", "control de horas", "jornada" (en sentido laboral en obra).
- diario: diario de obra, anotar en obra, incidencias o apuntes del día en obra, entrada del diario, "foto de obra" como registro de obra (no ticket de compra), PDF del diario, texto del diario. Incluye: "diario de obra", "anotar en obra", "foto de obra" (contexto obra).
- presupuesto: presupuesto, partidas, líneas del presupuesto, "añadir al presupuesto", importes por partida, listar o editar presupuestos, pendientes de presupuesto, cambiar estado de presupuesto, convertir presupuesto a albarán, confirmar o cancelar borrador de presupuesto, obtener borrador activo, presupuesto por voz cuando el foco es el importe/partidas (no confundir con horas ni diario).

Borrador de presupuesto en construcción (si el sistema te avisa de que existe):
- Solo debe sesgar hacia presupuesto cuando el mensaje sea ambiguo, muy corto sin tema claro, o siga claramente el hilo del presupuesto (partidas, importes, confirmaciones del borrador).
- NUNCA fuerces presupuesto por tener borrador activo si el usuario habla de horas/jornada/operarios o de diario de obra/fotos/anotaciones en obra: en esos casos la salida es operarios o diario.
- "cancelar presupuesto" o "salir del presupuesto" → presupuesto (gestión del flujo de presupuesto).

Mensajes muy cortos (sí, no, vale, ok, adelante, genial, perfecto, etc.):
- Debes basarte en el ÚLTIMO mensaje del asistente que recibes en el historial inmediato antes del mensaje del usuario. Si el asistente preguntaba por horas u operarios → operarios; si por diario/fotos/anotación en obra → diario; si por presupuesto, partidas o confirmación del borrador → presupuesto. Si no hay pista clara, entonces aplica la regla del borrador activo solo si aplica como mensaje ambiguo.

Responde SOLO con una palabra en minúsculas, sin comillas ni puntuación:
documentos | emails | agenda | gastos | diario | clientes | calculo | operarios | presupuesto | general

documentos: crear obra con cliente nuevo o existente (crear_obra + crear_cliente + actualizar_obra), facturas, albaranes, vincular documentos a una obra (asociar_documentos_a_obra), crear o actualizar obra (crear_obra, actualizar_obra), extras/modificados/imprevistos en obra, dictado de visita y presupuesto estructurado (generar_presupuesto_por_dictado, gestionar_tarifas), crear presupuesto ya redactado (crear_presupuesto), estados de facturas/albaranes, edición de facturas/albaranes, conversiones albarán↔factura, tiempo en obra.
presupuesto: ya detallado arriba cuando el foco es presupuesto/partidas/borrador de presupuesto (no operarios ni diario).
emails: Gmail, leer bandeja, enviar correo.
agenda: recordatorios, citas, eventos en calendario, tiempo meteorológico para obras o citas.
gastos: ticket, OCR, foto de compra, registrar gasto, vincular gasto.
diario: ya detallado arriba (diario de obra y registro en obra).
clientes: consultar ficha de cliente, buscar cliente, historial de cliente. NO usar para crear obras ni clientes nuevos.
calculo: metros cuadrados, m³, perímetro, dimensiones de obra.
operarios: ya detallado arriba (horas y jornada en obra).
general: saludos, varias áreas a la vez, mensajes pendientes del negocio, meteorología o tiempo, extras o imprevistos en obra (registrar_extra), vincular documentos a una obra, actualizar datos de obra (cliente, dirección, estado, actualizar_obra), memoria del negocio (guardar_memoria, eliminar_memoria), o petición ambigua sin encaje claro.`;

const INTENT_TOOL_NAMES_DOCUMENTOS = new Set([
  'obtener_facturas_pendientes',
  'obtener_albaranes_pendientes',
  'listar_facturas',
  'listar_albaranes',
  'cambiar_estado_factura',
  'cambiar_estado_albaran',
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
  'convertir_albaran_a_factura',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
  'albaranes_sin_facturar',
  'consultar_tiempo',
  'registrar_extra',
  'listar_extras',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_EMAILS = new Set([
  'leer_emails_recientes',
  'enviar_email',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_AGENDA = new Set([
  'obtener_agenda',
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
  'buscar_cliente',
  'buscar_obra',
  'crear_cliente',
  'ver_cliente',
  'ver_ficha_obra',
  'get_directions',
  'consultar_tiempo',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_GASTOS = new Set([
  'registrar_gasto_ticket',
  'vincular_gasto',
  'eliminar_gasto',
  'modificar_gasto',
  'listar_facturas',
  'listar_albaranes',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_DIARIO = new Set([
  ...DIARIO_HANDLED_TOOLS,
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_CLIENTES = new Set([
  'crear_cliente',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_CALCULO = new Set([
  'calcular_medicion',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_OPERARIOS = new Set([
  'registrar_jornada',
  'listar_operarios',
  'consultar_horas_obra',
  'consultar_horas_operario',
  'eliminar_registro_jornada',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

const INTENT_TOOL_NAMES_PRESUPUESTO = new Set([
  ...PRESUPUESTOS_HANDLED_TOOLS,
  'generar_presupuesto_por_dictado',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

/** Prefijo del system prompt de presupuesto (route); el cuerpo viene de presupuestos.ts */
const PRESUPUESTOS_AGENT_SYSTEM_PROMPT_PREFIX = `REGLA CRÍTICA — DICTADO COMPLETO:
Si el mensaje del usuario contiene múltiples partidas o trabajos descritos de golpe (con o sin precios), DEBES usar generar_presupuesto_por_dictado con TODO el texto como dictado. NO uses iniciar_borrador_presupuesto ni agregar_partida_borrador en ese caso.
Solo usa el flujo borrador conversacional (iniciar_borrador + agregar_partida) cuando el usuario añade partidas de una en una interactivamente Y ya hay un borrador activo con partidas guardadas.

`;

const INTENT_TOOL_NAMES: Record<AgentIntentCategory, Set<string> | null> = {
  documentos: INTENT_TOOL_NAMES_DOCUMENTOS,
  emails: INTENT_TOOL_NAMES_EMAILS,
  agenda: INTENT_TOOL_NAMES_AGENDA,
  gastos: INTENT_TOOL_NAMES_GASTOS,
  diario: INTENT_TOOL_NAMES_DIARIO,
  clientes: INTENT_TOOL_NAMES_CLIENTES,
  calculo: INTENT_TOOL_NAMES_CALCULO,
  operarios: INTENT_TOOL_NAMES_OPERARIOS,
  presupuesto: INTENT_TOOL_NAMES_PRESUPUESTO,
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
    'operarios',
    'presupuesto',
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
    const { mensaje, business_id, historial, imagen, imagen_mime, imagenesUrls } = body;
    const directToolName =
      typeof body?.tool_name === 'string'
        ? body.tool_name.trim()
        : typeof body?.tool === 'string'
          ? body.tool.trim()
          : '';
    const directToolArgs =
      body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const mensajeTrim = typeof mensaje === 'string' ? mensaje.trim() : '';
    const imagenesVisionUrls: string[] = [];
    if (Array.isArray(imagenesUrls)) {
      for (const raw of imagenesUrls) {
        const u = normalizarImagenUrlVision(raw);
        if (u) imagenesVisionUrls.push(u);
      }
    }
    const imagenesNormalizadas: string[] = [...imagenesVisionUrls];
    if (imagenesNormalizadas.length === 0) {
      const single = normalizarImagenVision(imagen, imagen_mime);
      if (single) imagenesNormalizadas.push(single);
    }

    const pathsAdjuntosStorage = imagenesVisionUrls
      .map((u) => extractDiarioObraObjectPath(u))
      .filter((p): p is string => Boolean(p));
    let mensajeTrimParaTools = mensajeTrim;
    if (pathsAdjuntosStorage.length > 0) {
      mensajeTrimParaTools = [
        mensajeTrim,
        `[Fotos adjuntas ya en almacenamiento. Al llamar a crear_entrada_diario, pasa el campo fotos con exactamente estas rutas: ${JSON.stringify(pathsAdjuntosStorage)}]`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    const imagenesParaDiarioCtx =
      imagenesVisionUrls.length > 0
        ? []
        : imagenesNormalizadas.filter((u) => u.startsWith('data:image/'));

    if (!mensajeTrim && imagenesNormalizadas.length === 0 && !directToolName) {
      return NextResponse.json(
        {
          error:
            'Envía un mensaje de texto o al menos una imagen (imagenesUrls con URL https)',
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
      .select(
        'nombre, sector, descripcion, servicios, tarifas, contexto_adicional, ciudad, direccion'
      )
      .eq('id', business_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'No se encontró el perfil del negocio' },
        { status: 404 }
      );
    }

    if (directToolName) {
      if (directToolName !== 'editar_factura') {
        return NextResponse.json({ error: 'tool no permitida' }, { status: 400 });
      }
      if (!authUser?.id) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      const businessIdStr = String(business_id ?? '').trim();
      const canAccess = await assertUserCanAccessBusiness(supabase, authUser.id, businessIdStr);
      if (!canAccess) {
        return NextResponse.json(
          { error: 'No tienes acceso a este negocio' },
          { status: 403 }
        );
      }
      const result = await editar_factura(supabase, businessIdStr, directToolArgs);
      if ('error' in result) {
        return NextResponse.json(result, { status: 400 });
      }
      return NextResponse.json(result);
    }

    const nombre = profile.nombre ?? 'el negocio';
    const nombreUsuario = (() => {
      const md = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
      const candidatos = [md.nombre, md.name, md.full_name, md.first_name, authUser?.email];
      for (const c of candidatos) {
        const s = String(c ?? '').trim();
        if (s) return s;
      }
      return 'compa';
    })();
    const sector = profile.sector ?? 'no especificado';
    const descripcion = profile.descripcion ?? '';
    const servicios = profile.servicios ?? '';
    const tarifas = profile.tarifas ?? '';
    const contexto_adicional = profile.contexto_adicional ?? '';
    const ciudadNegocio = String(
      (profile as { ciudad?: string | null }).ciudad ?? ''
    ).trim();
    const ubicacionMeteoPrompt = ciudadNegocio
      ? `\n\nUbicación del negocio: ${ciudadNegocio}. Usa esta ciudad por defecto para consultas meteorológicas cuando el usuario no especifique otra ubicación.`
      : '';

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
    const tzAgenda = 'Europe/Madrid';
    const hoyYmd = formatYmdInTimeZone(new Date(), tzAgenda);
    const mananaYmd = addDaysToYmd(hoyYmd, 1);

    if (esPrimerMensajeConversacion) {
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

Al inicio de tu respuesta, antes de atender lo que pide el usuario, empieza con este formato: "Aupa ${nombreUsuario}, soy Bicho. [resumen breve y natural de lo relevante de hoy/mañana]". No hagas una lista numerada ni viñetas en ese saludo; después continúa con la petición del usuario.`;
      }
    }

    let memoriaRows: Array<{ categoria: string; clave: string; valor_texto: string }> = [];
    const { data: memoriaData, error: memoriaErr } = await supabase
      .from('memoria_negocio')
      .select('categoria, clave, valor_texto')
      .eq('business_id', business_id)
      .order('categoria', { ascending: true })
      .order('clave', { ascending: true });
    if (!memoriaErr && memoriaData) {
      memoriaRows = memoriaData as typeof memoriaRows;
    }
    const memoriaNegocioBlock = buildMemoriaNegocioPromptBlock(memoriaRows);

    const { data: obrasAbiertas } = await supabase
      .from('obras')
      .select('id, nombre, cliente_id, direccion')
      .eq('business_id', business_id)
      .in('estado', ['abierta', 'en_curso'])
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: clientesActivos } = await supabase
      .from('clientes')
      .select('id, nombre, email, telefono')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: operariosActivosRows } = await supabase
      .from('operarios')
      .select('nombre')
      .eq('business_id', business_id)
      .eq('activo', true)
      .order('nombre', { ascending: true });
    const nombresOperariosNegocio = (operariosActivosRows ?? [])
      .map((r: { nombre?: string | null }) => String(r.nombre ?? '').trim())
      .filter((n) => n.length > 0);
    const bloqueOperariosPrompt =
      nombresOperariosNegocio.length > 0
        ? `Tienes acceso a la gestión de operarios. Puedes registrar horas de trabajo por obra, listar operarios y consultar resúmenes de horas. Los operarios de este negocio son: ${nombresOperariosNegocio.join(', ')}. Cuando registres horas, si el usuario no distingue entre reales y convenio, guarda el mismo valor en ambos.`
        : `Tienes acceso a la gestión de operarios. Puedes registrar horas de trabajo por obra, listar operarios y consultar resúmenes de horas. Aún no hay operarios activos listados en el sistema para este negocio. Cuando registres horas, si el usuario no distingue entre reales y convenio, guarda el mismo valor en ambos.`;

    const obrasCtx =
      (obrasAbiertas ?? []).length > 0
        ? `\nOBRAS ABIERTAS ACTUALES:\n${(obrasAbiertas ?? [])
            .map(
              (o) =>
                `- ${o.nombre} (id: ${o.id})${o.direccion ? ', dir: ' + o.direccion : ''}`
            )
            .join('\n')}`
        : '\nNo hay obras abiertas actualmente.';

    const clientesCtx =
      (clientesActivos ?? []).length > 0
        ? `\nCLIENTES REGISTRADOS:\n${(clientesActivos ?? [])
            .map(
              (c) =>
                `- ${c.nombre} (id: ${c.id})${c.email ? ', email: ' + c.email : ''}${c.telefono ? ', tel: ' + c.telefono : ''}`
            )
            .join('\n')}`
        : '\nNo hay clientes registrados.';

    const systemPrompt = `Tu nombre es Bicho. Si el usuario te llama por tu nombre al inicio de una petición ('Oye Bicho...', 'Bicho escucha...', 'Bicho añade...', 'Eh Bicho...' o similar), ignora el nombre y ejecuta directamente lo que pide a continuación. No respondas al nombre, no lo confirmes, simplemente actúa.

Para cualquier acción que cree, edite o consulte datos en el sistema: DEBES invocar la herramienta (tool) correspondiente en este mismo turno.
PROHIBIDO decir "voy a hacerlo", "procederé a...", "un momento" u otras promesas sin haber llamado ya a la tool.
Responder solo en texto cuando debías llamar a una tool = error crítico.
Si faltan datos: pregunta al usuario o usa listar_* / buscar_* según corresponda.
Nunca inventes ni simules resultados de base de datos, estados ni IDs.
Las consultas a datos del negocio requieren invocar tools de listado o búsqueda, no narrar como si ya hubieras consultado.

Español, profesional, conciso.

Obra ≠ cliente (inconfundibles); no intercambiar nombres. Antes de crear cliente u obra, busca duplicados por nombre.
Orden típico: cliente → obra → documentos; usa actualizar_obra para asociar cliente_id cuando corresponda. Si hay ambigüedad entre obras, pregunta.
Si el usuario pide crear una obra con un cliente que no existe en el sistema: (1) llama a crear_cliente con los datos disponibles, (2) llama a crear_obra pasando el cliente_id devuelto por crear_cliente. NUNCA crees la obra sin cliente si el usuario ha proporcionado nombre de cliente. NUNCA entres en bucle repitiendo buscar_cliente — si no existe, créalo.
SDD (crear presupuesto, factura, albarán o generar_presupuesto_por_dictado): solo tras resumen al usuario + confirmación explícita ("sí", "adelante", "genéralo"); nunca partidas a 0€. Usa memoria/tarifas del perfil para precios cuando falten.
CREACIÓN DE PRESUPUESTOS: Al usar generar_presupuesto_por_dictado: primera llamada siempre con solo_vista_previa: true para mostrar borrador. Solo llamar de nuevo con solo_vista_previa: false tras confirmación explícita del usuario.
Solo consultas: listar_* u obtener_*_pendientes; no crees documentos nuevos si no los piden. Estados: pendiente, aceptado, rechazado, facturado, pagado.
Extras: registrar_extra (confirmar antes de notificar al cliente). Gastos con imagen: registrar_gasto_ticket tras confirmación en un mensaje siguiente; si mencionan obra, obra_nombre u obra_id. En registrar_gasto_ticket incluye categoria cuando puedas inferirla del texto (material, herramienta, vertido, subcontrata, transporte, otros); si no está claro, omite el campo o usa material. Si el OCR o el texto sugiere devolución/descuento/abono/nota de crédito/negativo, registra base, IVA y total en negativo; si ya viene negativo, respétalo. vincular_gasto si indica documento. gestionar_tarifas. Emails: criterios de urgencia habituales; usa tools de lectura.
Ofrece convertir_presupuesto_a_albaran / convertir_albaran_a_factura cuando aplique. Diario: crear_entrada_diario y generar_pdf_diario según petición. Menciona mensajes de clientes pendientes de aprobar al inicio si encaja. Aplica el bloque "## Lo que sé de este negocio" al final sin pedir repetición.

Fecha y hora: ${ahora}. Negocio: ${nombre} (${sector}).
${descripcion}
Servicios: ${servicios}
Tarifas: ${tarifas}
Contexto extra: ${contexto_adicional}${ubicacionMeteoPrompt}
Fecha presupuestos: ${fechaActual}.${obrasCtx}${clientesCtx}

${bloqueOperariosPrompt}${agendaContextoPrimerMensaje}${memoriaNegocioBlock}`;

    const ALL_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      ...DOCUMENTOS_AGENT_TOOLS,
      ...OBRAS_CLIENTES_AGENT_TOOLS,
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
      ...CORREO_AGENT_TOOLS,
      ...AGENDA_AGENT_TOOLS,
      ...CALCULO_AGENT_TOOLS,
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
      ...GASTOS_AGENT_TOOLS,
      ...DIARIO_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'guardar_memoria',
          description: `Guarda o actualiza un dato persistente del negocio (preferencia, corrección, proveedor habitual, formato, precio, etc.). Upsert por clave única por negocio. Llama sin pedir confirmación si el usuario corrige con claridad o declara preferencias duraderas. Categorías válidas: ${MEMORIA_CATEGORIAS.join(', ')}. Usa clave en snake_case corta (ej. cemento_exterior). Responde muy breve ("Anotado…").`,
          parameters: {
            type: 'object',
            properties: {
              categoria: {
                type: 'string',
                enum: [...MEMORIA_CATEGORIAS],
                description: 'Tipo de memoria',
              },
              clave: {
                type: 'string',
                description: 'Identificador único en snake_case por negocio (ej. cemento_exterior)',
              },
              valor_texto: {
                type: 'string',
                description: 'Texto completo del dato o preferencia a recordar',
              },
            },
            required: ['categoria', 'clave', 'valor_texto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_memoria',
          description:
            'Elimina una entrada de memoria del negocio por su clave (misma convención snake_case que al guardar). Usa cuando pida olvidar o quitar una clave concreta.',
          parameters: {
            type: 'object',
            properties: {
              clave: {
                type: 'string',
                description: 'Clave de la entrada a eliminar',
              },
            },
            required: ['clave'],
            additionalProperties: false,
          },
        },
      },
      ...OPERARIOS_AGENT_TOOLS,
      ...PRESUPUESTOS_AGENT_TOOLS,
      ...CANVAS_AGENT_TOOLS,
    ];

    const textoUsuario =
      mensajeTrim ||
      '(El usuario adjuntó una imagen, posiblemente un ticket o factura. Analízala e indica qué datos ves.)';

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: textoUsuario },
    ];
    for (const u of imagenesNormalizadas) {
      userContent.push({
        type: 'image_url',
        image_url: { url: u, detail: 'auto' },
      });
    }

    let hasBorradorActivo = false;
    let routerSystemContent = ROUTER_SYSTEM_PROMPT;
    if (authUser?.id) {
      const borradorRes = await supabase
        .from('presupuesto_borrador')
        .select('id')
        .eq('business_id', business_id)
        .eq('user_id', authUser.id)
        .eq('estado', 'en_construccion')
        .limit(1);
      const rows = borradorRes.data;
      hasBorradorActivo = Array.isArray(rows)
        ? rows.length > 0 && Boolean((rows[0] as { id?: string } | undefined)?.id)
        : Boolean(
            rows &&
              typeof rows === 'object' &&
              'id' in (rows as object) &&
              String((rows as { id?: unknown }).id ?? '').trim().length > 0
          );
      if (hasBorradorActivo) {
        routerSystemContent = `CONTEXTO: Hay un borrador de presupuesto en construcción (estado en_construccion). Úsalo solo como sesgo hacia intención presupuesto cuando el mensaje del usuario sea ambiguo o siga claramente el hilo del presupuesto/partidas/confirmación del borrador. NO fuerces presupuesto si el mensaje trata de horas de operarios, jornada, control de horas ni de diario de obra, anotaciones en obra o fotos de obra en sentido de registro de obra: en esos casos clasifica operarios o diario.\n\n${ROUTER_SYSTEM_PROMPT}`;
      }
    }

    let intentCategory: AgentIntentCategory;
    if (hasBorradorActivo) {
      intentCategory = 'presupuesto';
    } else {
      const ultimoAsistenteRouter = [...historialValido]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content.trim().length > 0);

      const routerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: routerSystemContent },
      ];
      if (ultimoAsistenteRouter) {
        routerMessages.push({
          role: 'assistant',
          content: ultimoAsistenteRouter.content,
        });
      }
      routerMessages.push({ role: 'user', content: userContent });

      const routerCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: routerMessages,
        max_tokens: 30,
        temperature: 0,
      });

      const intentRaw = routerCompletion.choices[0]?.message?.content ?? '';
      intentCategory = parseAgentIntentCategory(intentRaw);
    }
    const memoriaNegocioBlockNoPresupuestos =
      intentCategory === 'presupuesto' ? '' : memoriaNegocioBlock;

    let tools = toolsForAgentIntent(intentCategory, ALL_AGENT_TOOLS);
    if (tools.length === 0) {
      tools = ALL_AGENT_TOOLS;
    }

    const fechaHoyMadrid = new Date().toLocaleDateString('es-ES', {
      timeZone: 'Europe/Madrid',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const systemPromptEfectivo =
      intentCategory === 'presupuesto'
        ? `${PRESUPUESTOS_AGENT_SYSTEM_PROMPT_PREFIX}${PRESUPUESTOS_AGENT_SYSTEM_PROMPT}\n\n---\nContexto del negocio (solo referencia; mantén tus reglas de brevedad).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
        : intentCategory === 'diario'
          ? `${DIARIO_AGENT_SYSTEM_PROMPT}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
          : intentCategory === 'agenda'
            ? `Hoy es ${fechaHoyMadrid} en Irún, España.\n\n${AGENDA_AGENT_SYSTEM_PROMPT}\n\nFecha actual: ${fechaActual}. Fecha hoy en formato ISO: ${hoyYmd}. Mañana en formato ISO: ${mananaYmd}.\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : intentCategory === 'operarios'
              ? `${OPERARIOS_AGENT_SYSTEM_PROMPT}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : intentCategory === 'gastos'
              ? `${GASTOS_AGENT_SYSTEM_PROMPT}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : systemPrompt;

    const historialLimitado = historialValido.slice(-10);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptEfectivo },
      ...historialLimitado.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const maxTokensAgente = imagenesNormalizadas.length > 0 ? 1600 : 800;

    const mensajeLower = mensajeTrim.toLowerCase();
    const esConfirmacion = hasBorradorActivo && (
      mensajeLower.includes('confirma') ||
      mensajeLower.includes('finaliza') ||
      mensajeLower.includes('guarda') ||
      mensajeLower.includes('listo') ||
      mensajeLower.includes('ya está') ||
      mensajeLower.includes('cierra')
    );

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: esConfirmacion
        ? { type: 'function', function: { name: 'confirmar_borrador' } }
        : 'auto',
      ...(intentCategory === 'presupuesto' || intentCategory === 'diario' || intentCategory === 'agenda' || intentCategory === 'gastos'
        ? { parallel_tool_calls: false }
        : {}),
      temperature: 0.7,
      max_tokens: maxTokensAgente,
    });

    const firstMessage = completion.choices[0]?.message;

    const runTool = async (toolName: string, toolArgs: Record<string, unknown>) => {
      const bidRun =
        typeof business_id === 'string' ? business_id : String(business_id ?? '');

      if (PRESUPUESTOS_HANDLED_TOOLS.has(toolName)) {
        return handlePresupuestos(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          openai,
          { mensajeTrim }
        );
      }

      if (DIARIO_HANDLED_TOOLS.has(toolName)) {
        return handleDiario(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          openai,
          {
            mensajeTrim: mensajeTrimParaTools,
            imagenesNormalizadas: imagenesParaDiarioCtx,
            fotosAdjuntasStorage: pathsAdjuntosStorage,
          }
        );
      }

      if (AGENDA_HANDLED_TOOLS.has(toolName)) {
        return handleAgenda(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          openai,
          { mensajeTrim }
        );
      }

      if (GASTOS_HANDLED_TOOLS.has(toolName)) {
        return handleGastosAgent(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          openai,
          { mensajeTrim }
        );
      }

      if (OBRAS_CLIENTES_HANDLED_TOOLS.has(toolName)) {
        return handleObrasClientesAgent(
          toolName,
          toolArgs,
          bidRun,
          authUser?.id ?? null,
          supabase
        );
      }

      if (DOCUMENTOS_HANDLED_TOOLS.has(toolName)) {
        return handleDocumentosAgent(
          toolName,
          toolArgs,
          bidRun,
          authUser?.id ?? null,
          supabase,
          openai,
          {
            mensajeTrim,
            mensaje: typeof mensaje === 'string' ? mensaje : mensajeTrim,
          }
        );
      }

      if (CORREO_HANDLED_TOOLS.has(toolName)) {
        return handleCorreoAgent(toolName, toolArgs, authUser?.id);
      }

      if (toolName === 'calcular_medicion') {
        return handleCalcularMedicion(toolArgs);
      }

      if (toolName === 'mostrar_vista_visual') {
        return handleMostrarVistaVisual(toolArgs, bidRun, supabase, runTool);
      }

      switch (toolName) {
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
        case 'guardar_memoria': {
          const categoria = String(toolArgs.categoria ?? '').trim();
          const clave = String(toolArgs.clave ?? '').trim();
          const valor_texto = String(toolArgs.valor_texto ?? '').trim();
          if (!clave) return { error: 'clave es obligatoria' };
          if (!valor_texto) return { error: 'valor_texto es obligatorio' };
          if (!esCategoriaMemoriaValida(categoria)) {
            return {
              error: `categoria inválida. Usa: ${MEMORIA_CATEGORIAS.join(', ')}`,
            };
          }
          const r = await upsertMemoriaNegocio(
            supabase,
            business_id,
            categoria,
            clave,
            valor_texto
          );
          if (!r.ok) return { error: r.error };
          return { ok: true, mensaje: 'Memoria guardada.' };
        }
        case 'eliminar_memoria': {
          const claveDel = String(toolArgs.clave ?? '').trim();
          if (!claveDel) return { error: 'clave es obligatoria' };
          const r = await deleteMemoriaNegocioByClave(supabase, business_id, claveDel);
          if (!r.ok) return { error: r.error };
          return {
            ok: true,
            mensaje: r.deleted ? 'Entrada eliminada.' : 'No había entrada con esa clave.',
          };
        }
        case 'registrar_jornada': {
          return ejecutarRegistrarJornada(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        case 'listar_operarios': {
          return ejecutarListarOperarios(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? '')
          );
        }
        case 'consultar_horas_obra': {
          return ejecutarConsultarHorasObra(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        case 'consultar_horas_operario': {
          return ejecutarConsultarHorasOperario(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs
          );
        }
        case 'eliminar_registro_jornada': {
          return ejecutarEliminarRegistroJornada(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

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

    let respuesta = firstMessage?.content ?? '';

    const parsePlanningPlan = (raw: string): PlannedTool[] | null => {
      let s = raw.trim();
      if (!s) return null;
      if (s.startsWith('```')) {
        s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      }
      try {
        const parsed = JSON.parse(s) as unknown;
        if (!Array.isArray(parsed)) return null;
        const out: PlannedTool[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const rec = item as Record<string, unknown>;
          const tool = typeof rec.tool === 'string' ? rec.tool.trim() : '';
          if (!tool) continue;
          const argsRaw = rec.args;
          const args: Record<string, unknown> =
            argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
              ? (argsRaw as Record<string, unknown>)
              : {};
          out.push({ tool, args });
        }
        return out;
      } catch (e) {
        console.error('[agente] parse planning JSON:', e);
        return null;
      }
    };

    const plannedToolsFromAssistantToolCalls = (
      toolCalls: NonNullable<NonNullable<typeof firstMessage>['tool_calls']>
    ): PlannedTool[] => {
      const out: PlannedTool[] = [];
      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        out.push({ tool: tc.function.name, args: parsedArgs });
      }
      return out;
    };

    const firstToolCalls = firstMessage?.tool_calls;
    if (firstToolCalls?.length) {
      const planningToolNamesList = tools
        .filter((t): t is OpenAI.Chat.Completions.ChatCompletionTool & { type: 'function' } => t.type === 'function')
        .map((t) => t.function.name);

      const planningSystem = `Eres un planificador de herramientas para el agente de construcción Perfilio.
Responde ÚNICAMENTE con un array JSON válido (sin markdown fenced blocks, sin texto antes ni después).
Formato obligatorio: [{"tool":"nombre_exacto","args":{...}}, ...]
Usa solo nombres de herramientas de esta lista: ${planningToolNamesList.join(', ')}
Si no necesitas ninguna herramienta, responde exactamente: []
El campo args debe ser un objeto con los parámetros de cada herramienta.`;

      const toolCallsPreview = firstToolCalls
        .filter((tc) => tc.type === 'function')
        .map((tc) => `${tc.function.name}(${tc.function.arguments ?? '{}'})`)
        .join('\n');

      const planningUser = `Petición del usuario:\n${mensajeTrim}\n\nBorrador de llamadas que el asistente consideró:\n${toolCallsPreview}\n\nDevuelve el plan COMPLETO como JSON array.`;

      let planningText = '';
      try {
        const planningCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: planningSystem },
            { role: 'user', content: planningUser },
          ],
          temperature: 0.2,
          max_tokens: 2000,
        });
        planningText = planningCompletion.choices[0]?.message?.content ?? '';
      } catch (e) {
        console.error('[agente] planning completion:', e);
        planningText = '';
      }

      let plan = parsePlanningPlan(planningText);
      if (plan === null && firstToolCalls?.length) {
        plan = plannedToolsFromAssistantToolCalls(firstToolCalls);
      }
      const hasSteps = plan !== null && plan.length > 0;
      const draftAssistant =
        typeof firstMessage?.content === 'string' ? firstMessage.content.trim() : '';

      if (!hasSteps) {
        if (plan !== null && plan.length === 0) {
          respuesta = draftAssistant || 'No hay acciones de herramientas para ejecutar.';
        } else {
          respuesta =
            planningText.trim() ||
            draftAssistant ||
            'No he podido interpretar el plan. Reformula la petición.';
        }
      } else {
        const guard = applyPerfilioGuardrails(plan as PlannedTool[], mensajeTrim);
        if (!guard.ok) {
          respuesta = guard.error;
        } else {
          const validated = guard.plan;
          const toolSummaries: string[] = [];
          for (const step of validated) {
            console.log('[TOOL CALL]', step.tool, JSON.stringify(step.args));
            let toolResult: unknown;
            try {
              toolResult = await runTool(step.tool, step.args);
            } catch (e) {
              console.error('[agente] runTool:', step.tool, e);
              toolResult = {
                error: e instanceof Error ? e.message : 'Error al ejecutar la herramienta',
              };
            }
            console.log('[TOOL RESULT]', step.tool, JSON.stringify(toolResult));
            const emailCapturado = capturarEmailPendiente(toolResult);
            if (emailCapturado) emailPendienteParaCliente = emailCapturado;
            capturarCanvas(toolResult);
            const obraCapturada = capturarObraFicha(toolResult);
            if (obraCapturada) obraFichaParaCliente = obraCapturada;
            toolSummaries.push(`${step.tool}: ${JSON.stringify(toolResult)}`);
          }

          const finalUserContent = `Se ejecutó el plan de herramientas (en orden). Genera la respuesta final al usuario en español, breve y útil.\n\n${toolSummaries.join('\n')}`;
          const finalMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...messages,
            { role: 'user', content: finalUserContent },
          ];
          try {
            const finalCompletion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: finalMessages,
              temperature: 0.7,
              max_tokens: maxTokensAgente,
            });
            const finalText = finalCompletion.choices[0]?.message?.content;
            if (typeof finalText === 'string' && finalText.trim()) {
              respuesta = finalText;
            } else {
              respuesta = toolSummaries.join('\n') || respuesta;
            }
          } catch (e) {
            console.error('[agente] final completion:', e);
            respuesta = toolSummaries.join('\n');
          }
        }
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
