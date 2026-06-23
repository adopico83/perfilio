import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  capturarEmailPendiente,
  handleEnviarEmail,
  handleLeerEmailsRecientes,
} from '@/lib/agente/modules/correo';
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
import {
  mensajeObrasAmbiguas,
  resolverObraDocumentoAgente,
  type Obra,
} from '@/lib/obras-context';
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

async function editar_factura(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>
): Promise<{ ok: true; id: string } | { error: string }> {
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

  const descripcionRaw =
    toolArgs.descripcion !== undefined ? toolArgs.descripcion : toolArgs.descripcion_trabajos;
  if (descripcionRaw !== undefined) {
    const d = String(descripcionRaw ?? '').trim();
    if (!d) return { error: 'descripcion_trabajos no puede estar vacía' };
    updates.descripcion_trabajos = d;
  }
  if (Object.keys(updates).length === 0) {
    return {
      error:
        'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion_trabajos)',
    };
  }
  const { data: row, error } = await supabase
    .from('facturas')
    .update(updates)
    .eq('id', id)
    .eq('business_id', businessId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row?.id) {
    return { error: 'No se encontró la factura o no pertenece a este negocio' };
  }
  return { ok: true, id: row.id as string };
}

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

/** Normaliza nombre para comparar (trim, minúsculas, espacios, sin acentos). */
function normalizarNombreComparable(s: string): string {
  return s
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** Mismo nombre o muy parecido (typo leve); evita duplicar clientes. */
function nombresClienteSimilares(nuevo: string, existente: string): boolean {
  const a = normalizarNombreComparable(nuevo);
  const b = normalizarNombreComparable(existente);
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return false;
  const dist = levenshtein(a, b);
  if (maxLen <= 12 && dist <= 2) return true;
  if (dist / maxLen <= 0.12) return true;
  return false;
}

type ClienteFilaNombre = { id: string; nombre: string | null };

function buscarClienteSimilarExistente(
  nombreBuscado: string,
  filas: ClienteFilaNombre[] | null | undefined
): { id: string; nombre: string } | null {
  if (!filas?.length) return null;
  for (const row of filas) {
    const nom = String(row.nombre ?? '').trim();
    if (!nom) continue;
    if (nombresClienteSimilares(nombreBuscado, nom)) return { id: row.id, nombre: nom };
  }
  return null;
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

  const huecos: Array<{ cantidad: number; largo: number; ancho: number }> = [];
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
          name: 'cambiar_estado_factura',
          description:
            'Cambia estado de la factura por UUID. Mismos estados que presupuestos. Si no tienes el UUID, primero listar_facturas y usa el id correcto.',
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
            'Cambia estado del albarán por UUID. Mismos estados. Si no tienes el UUID, primero listar_albaranes y usa el id correcto.',
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
          name: 'editar_factura',
          description:
            'Actualiza factura por id: cliente_nombre, total con IVA, descripcion_trabajos. Solo campos que cambien. Si no tienes UUID, listar_facturas antes.',
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
            'Actualiza albarán por id: cliente_nombre, importe_total, descripcion_trabajos. Solo campos que cambien. Si no tienes UUID, listar_albaranes antes.',
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
            "Usar SIEMPRE que el usuario pida crear un presupuesto describiendo trabajos, aunque la descripción sea breve. Ejemplos: 'presupuesto para enfoscado exterior 2500€', 'presupuesto para reforma de baño', 'presupuesto para pintar el salón de García'. También para dictado de visita: 'genera un presupuesto', 'haz un presupuesto de lo que he visto', 'acabo de visitar una obra'. Estructura el presupuesto en partidas automáticamente. SDD obligatorio: no ejecutar sin datos críticos completos; muestra resumen en lenguaje natural y espera confirmación explícita del usuario ('sí', 'adelante', 'genéralo'). Cliente identificado; al menos una partida con descripción y precio; nunca partidas a 0€; si dice 'precios estándar' usa tarifas del perfil o memoria del negocio; si falta precio, pregunta antes. Si faltan datos, no ejecutes ni crees borradores vacíos. Incluye SIEMPRE obra_nombre si la obra es conocida en la conversación (no infieras la obra solo del texto del dictado).",
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
              obra_nombre: {
                type: 'string',
                description:
                  'Nombre exacto de la obra a la que se asocia el presupuesto. Usar siempre que la obra sea conocida.',
              },
              obra_id: {
                type: 'string',
                description:
                  'UUID de la obra (opcional). Si no se envía, usa obra_nombre y contexto del cliente; no uses el dictado de partidas para resolver obra.',
              },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'Si true, solo muestra el borrador sin guardarlo en BD. Usar true en la primera llamada para mostrar al usuario. Usar false (o omitir) solo cuando el usuario haya confirmado explícitamente.',
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
            'Añade, edita, elimina o lista las tarifas del negocio para generar presupuestos automáticos.',
          parameters: {
            type: 'object',
            properties: {
              accion: {
                type: 'string',
                enum: ['listar', 'añadir', 'editar', 'eliminar'],
                description: 'Operación a realizar',
              },
              nombre: { type: 'string' },
              unidad: { type: 'string' },
              precio: { type: 'number' },
              categoria: { type: 'string' },
              tarifa_id: { type: 'string', description: 'UUID de la tarifa (editar/eliminar)' },
              nombre_tarifa: {
                type: 'string',
                description: 'Nombre o fragmento para buscar la tarifa a eliminar si no se tiene tarifa_id',
              },
              confirmar_eliminacion: {
                type: 'boolean',
                description:
                  'Confirmación explícita para ejecutar el borrado. Si no es true, solo devuelve vista previa.',
              },
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
            'Solo cuando el presupuesto ya viene estructurado con partidas y totales definidos; si describe trabajos en natural, usar generar_presupuesto_por_dictado. Guarda presupuesto nuevo (texto completo). SDD obligatorio: datos críticos completos; resumen al usuario + confirmación explícita antes de llamar; cliente identificado; partidas con precio; nunca 0€; sin borradores vacíos.',
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
          description:
            'Registra factura nueva. Solo si pidió crear/generar factura. SDD obligatorio: cliente, importe/concepto completos; resumen + confirmación explícita del usuario antes de ejecutar; sin borradores vacíos.',
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
          description:
            'Registra albarán nuevo. Solo si pidió crear/generar albarán. SDD obligatorio: cliente y descripción del trabajo; resumen + confirmación explícita antes de ejecutar; sin borradores vacíos.',
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
            'Crea una nueva obra o proyecto. Usar cuando el usuario mencione una nueva obra, reforma o trabajo nuevo. Si ya existe una obra con el mismo nombre (sin distinguir mayúsculas) en el negocio, no crea duplicado: devuelve id de la existente y mensaje.',
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
              cliente_telefono: {
                type: 'string',
                description: 'Teléfono del cliente (opcional; si no existe el cliente por nombre, se usa al crearlo automáticamente)',
              },
              cliente_email: {
                type: 'string',
                description: 'Email del cliente (opcional; si no existe el cliente por nombre, se usa al crearlo automáticamente)',
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
            'Actualiza campos de una obra existente en la base de datos. DEBES llamar a esta tool cuando el usuario pida vincular un cliente a una obra, cambiar la dirección, el estado o cualquier dato de la obra. NO uses guardar_memoria para vincular clientes a obras — eso solo guarda texto, no modifica la base de datos. Para vincular un cliente: pasa obra_id (o busca la obra por nombre primero con listar_obras) y cliente_id del cliente.',
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
            'Crea borrador de email (para, asunto, cuerpo); el usuario aprueba y envía desde el panel, no se envía solo. No aplica el flujo SDD de presupuestos/facturas.',
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
          name: 'obtener_agenda',
          description:
            'Eventos del día (fecha YYYY-MM-DD): hora, título, descripción, ubicación. Llamar siempre antes de crear_recordatorio para evitar solapes (1 h de duración por defecto).',
          parameters: {
            type: 'object',
            properties: {
              fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
            },
            required: ['fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_recordatorio',
          description:
            'Crear evento en agenda. Usa fecha_relativa (mañana, lunes, etc.) o fecha YYYY-MM-DD. Si no envías titulo, pasa fecha/fecha_relativa y además tipo+cliente (ej. tipo "Cita", cliente "Mendi") para construir el título. Opcional: telefono/direccion del cliente en la tool para enriquecer aunque el título no coincida con la BD. Tras obtener_agenda del mismo día.',
          parameters: {
            type: 'object',
            properties: {
              titulo: {
                type: 'string',
                description:
                  'Título del evento. Si no viene, el servidor puede armarlo con tipo + " con " + cliente cuando ambos existan.',
              },
              tipo: {
                type: 'string',
                description: 'Tipo de evento (ej. Cita, Visita, Reunión) si titulo va implícito',
              },
              cliente: {
                type: 'string',
                description: 'Nombre del cliente o contacto (alternativa: cliente_nombre)',
              },
              cliente_nombre: { type: 'string', description: 'Sinónimo de cliente' },
              telefono: {
                type: 'string',
                description: 'Teléfono del cliente (alternativa: cliente_telefono)',
              },
              cliente_telefono: { type: 'string', description: 'Sinónimo de telefono' },
              direccion: {
                type: 'string',
                description: 'Dirección del cliente o cita (alternativa: cliente_direccion)',
              },
              cliente_direccion: { type: 'string', description: 'Sinónimo de direccion' },
              fecha: {
                type: 'string',
                description:
                  'Formato YYYY-MM-DD. Obligatorio si no envías fecha_relativa. Si envías ambos, fecha_relativa tiene prioridad.',
              },
              fecha_relativa: {
                type: 'string',
                description:
                  "Usa este campo en lugar de fecha cuando el usuario dice 'mañana', 'pasado mañana', 'el lunes', 'el martes', etc. El backend calculará la fecha exacta. Valores válidos: 'mañana', 'pasado mañana', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'",
              },
              hora: { type: 'string', description: 'Formato HH:MM (opcional)' },
              notas: {
                type: 'string',
                description: 'Texto libre del usuario para el campo Notas de la descripción',
              },
              duracion_minutos: {
                type: 'integer',
                description: 'Duración del evento en minutos (15–1440). Por defecto 60.',
              },
              minutos_antelacion: {
                type: 'integer',
                description:
                  'Minutos de antelación con los que avisar antes de la hora del evento. Usa 0 si es un recordatorio simple (llevar algo, hacer una llamada). Usa 30 si es una cita, reunión o visita con otra persona. Usa 60 si el usuario lo pide explícitamente o si implica desplazamiento largo.',
                default: 0,
              },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'Si true, solo devuelve vista previa (sin insertar). Tras confirmación del usuario, llama de nuevo con false u omítelo.',
              },
              description: {
                type: 'string',
                description:
                  'Texto completo del campo description si quieres fijarlo tú (si lo envías no vacío, sustituye la plantilla autogenerada del servidor).',
              },
              location: {
                type: 'string',
                description:
                  'Dirección o texto de ubicación para GPS; si lo envías no vacío, sustituye la inferida por obra/cliente.',
              },
            },
            required: [],
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
          description:
            'Elimina un recordatorio de la agenda por id. SDD: primero solo_vista_previa true (muestra qué se va a borrar, pendiente_confirmacion); tras confirmación explícita del usuario, misma llamada con el mismo id y solo_vista_previa false u omitido para borrar. Si el usuario ya confirmó con sí/vale/ok, no repitas la vista previa.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'True: solo muestra vista previa del evento (no borra). False u omitido: ejecuta el borrado con id.',
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
          name: 'calcular_medicion',
          description:
            'Cálculo de obra (m², m³, ml, perímetro). Pasa dimensiones y tipo. PROHIBIDO calcular superficies, volúmenes o totales a mano en texto; usa siempre esta tool.',
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
      ...GASTOS_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'crear_entrada_diario',
          description:
            'Entrada en diario de obra: texto y opcionalmente fotos/vídeos. Obligatorio obra_nombre; el servidor resuelve obra_id. Si el usuario adjuntó imágenes en este mensaje, el servidor las gestiona automáticamente: NO pongas nada en el campo fotos, déjalo sin definir. Para URLs o rutas que el usuario pegue manualmente, usa el array fotos. NO inventes URLs. Ejecuta la tool con el obra_nombre que dio el usuario; no pidas aclarar ambigüedad antes — solo si la tool devuelve mensaje de ambigüedad.',
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
                description:
                  'Solo rutas/URLs reales del bucket diario-obra si el usuario las pegó manualmente. NUNCA pongas URLs inventadas ni de ejemplo. Si no tienes rutas reales del bucket, omite este campo completamente (no lo incluyas en el JSON). Si el usuario adjuntó imágenes en este mensaje, el servidor las gestiona automáticamente: NO pongas nada en el campo fotos.',
              },
              videos: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Solo rutas/URLs reales del bucket para vídeos ya subidos; no inventes enlaces.',
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
          description:
            'Nueva ficha de cliente (nombre obligatorio; contacto y notas opcionales). Tras crear, devuelve id del nuevo cliente. Si ya existe un cliente con el mismo nombre o muy parecido en el negocio, no crea duplicado: devuelve id del existente y mensaje.',
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
      {
        type: 'function',
        function: {
          name: 'eliminar_entrada_diario',
          description:
            'Elimina una entrada del diario de obra (diario_obra). Busca por nombre de obra y opcionalmente fecha o texto en la descripción. SDD: solo_vista_previa true primero (resumen o candidatos); tras confirmación, solo_vista_previa false con entrada_id. Elimina también fotos/vídeos del bucket Storage.',
          parameters: {
            type: 'object',
            properties: {
              obra_nombre: {
                type: 'string',
                description: 'Nombre o texto para identificar la obra (p. ej. Reforma Paqui)',
              },
              obra_id: { type: 'string', description: 'UUID de la obra si se conoce' },
              fecha: { type: 'string', description: 'Fecha de la entrada YYYY-MM-DD (opcional)' },
              texto_fragmento: {
                type: 'string',
                description: 'Fragmento del texto de la entrada (opcional, búsqueda aproximada)',
              },
              entrada_id: { type: 'string', description: 'UUID de la fila diario_obra a eliminar' },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'True: solo muestra vista previa o lista de candidatos. False u omitido: ejecuta el borrado con entrada_id.',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_evento_agenda',
          description:
            'Elimina un evento de agenda buscando por título aproximado y/o fecha. SDD: solo_vista_previa true primero; luego solo_vista_previa false con evento_id. No confundir con eliminar_recordatorio por id si solo se conoce el UUID.',
          parameters: {
            type: 'object',
            properties: {
              titulo_fragmento: { type: 'string', description: 'Texto del título del recordatorio (búsqueda aproximada)' },
              fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional)' },
              evento_id: { type: 'string', description: 'UUID del evento en agenda' },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'True: solo muestra vista previa o candidatos. False u omitido: borra con evento_id.',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'modificar_evento_agenda',
          description:
            'Modifica un evento de agenda (título, fecha, hora). Busca por ID o por título/fecha. SDD: solo_vista_previa true primero (resumen del cambio); luego solo_vista_previa false con evento_id.',
          parameters: {
            type: 'object',
            properties: {
              evento_id: { type: 'string', description: 'UUID del evento' },
              titulo_fragmento: { type: 'string', description: 'Para buscar si no hay evento_id' },
              fecha: { type: 'string', description: 'Fecha YYYY-MM-DD para buscar' },
              nuevo_titulo: { type: 'string', description: 'Nuevo título' },
              nueva_fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
              nueva_hora: { type: 'string', description: 'Nueva hora (texto libre) o vacío para quitar' },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'True: solo muestra vista previa o candidatos. False u omitido: aplica cambios con evento_id.',
              },
            },
            additionalProperties: false,
          },
        },
      },
      ...OPERARIOS_AGENT_TOOLS,
      ...PRESUPUESTOS_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'mostrar_vista_visual',
          description:
            'Panel modal (tabla/canvas). Orden obligatorio: primero ejecuta la tool de listado que corresponda (listar_* o leer_emails_recientes); luego llama a esta con el array completo en datos (p. ej. items). No abras canvas sin datos ni sin petición explícita de vista/tabla/panel. Tras abrir, mensaje breve.',
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

      switch (toolName) {
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
            items: ((data ?? []) as Array<{ cliente_nombre: string | null; total: number | null; fecha: string | null }>).map((r) => ({
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
            items: ((data ?? []) as Array<{ cliente_nombre: string | null; fecha: string | null }>).map((r) => ({
              cliente: r.cliente_nombre ?? null,
              fecha: r.fecha ?? null,
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
        case 'editar_factura': {
          return editar_factura(supabase, String(business_id ?? ''), toolArgs);
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

          type ObraClienteSelect = {
            id: string;
            cliente_id?: string | null;
            clientes?: { nombre?: string | null } | null;
          };
          let obraIdFinal = '';
          let obraClienteDesdeExplicita: ObraClienteSelect | null = null;

          if (explicitObra) {
            const { data: obraRow, error: obraErr } = await supabase
              .from('obras')
              .select('id, cliente_id, clientes ( nombre )')
              .eq('business_id', business_id)
              .eq('id', explicitObra)
              .in('estado', ['abierta', 'en_curso'])
              .maybeSingle();
            if (obraErr || !obraRow?.id) {
              return { error: 'La obra indicada no existe o no está abierta.' };
            }
            obraIdFinal = (obraRow as ObraClienteSelect).id;
            obraClienteDesdeExplicita = obraRow as ObraClienteSelect;
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

          if (
            obraClienteDesdeExplicita &&
            clienteIdFinal == null &&
            obraClienteDesdeExplicita.cliente_id
          ) {
            const cidHint = String(obraClienteDesdeExplicita.cliente_id).trim();
            if (cidHint) {
              clienteIdFinal = cidHint;
              const cliJoin = obraClienteDesdeExplicita.clientes;
              const cnHint =
                cliJoin && typeof cliJoin === 'object'
                  ? String((cliJoin as { nombre?: string | null }).nombre ?? '').trim()
                  : '';
              if (cnHint) clienteNombreFinal = cnHint;
            }
          }

          if (obraIdFinal && clienteIdFinal == null) {
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

          const tieneClientePresupuesto =
            clienteIdFinal != null ||
            (typeof clienteNombreFinal === 'string' && clienteNombreFinal.trim().length > 0);
          if (!tieneClientePresupuesto) {
            return {
              error:
                'Falta el cliente. Créalo primero antes de generar el presupuesto.',
            };
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

          const nombreObraNorm = normalizarNombreComparable(nombre);
          const { data: obrasExistentes, error: errObrasDup } = await supabase
            .from('obras')
            .select('id, nombre')
            .eq('business_id', business_id);
          if (errObrasDup) return { error: errObrasDup.message };
          for (const oRow of obrasExistentes ?? []) {
            const nomO = String((oRow as { nombre?: string | null }).nombre ?? '').trim();
            if (!nomO) continue;
            if (normalizarNombreComparable(nomO) === nombreObraNorm) {
              return {
                id: String((oRow as { id: string }).id),
                mensaje: `La obra '${nomO}' ya existe, usando la existente.`,
                existente: true,
              };
            }
          }

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

          if (avisoSinCliente) {
            const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim();
            // Si hay datos de cliente disponibles en toolArgs, crearlo automáticamente
            const telefonoCli =
              typeof toolArgs.cliente_telefono === 'string'
                ? toolArgs.cliente_telefono.trim() || null
                : null;
            const emailCli =
              typeof toolArgs.cliente_email === 'string'
                ? toolArgs.cliente_email.trim() || null
                : null;
            const sinDatosCliente =
              telefonoCli === null && emailCli === null && clienteNombre === '';
            if (!sinDatosCliente) {
              const { data: newCli, error: newCliErr } = await supabase
                .from('clientes')
                .insert({
                  business_id,
                  nombre: clienteNombre,
                  telefono: telefonoCli,
                  email: emailCli,
                })
                .select('id')
                .maybeSingle();
              if (!newCliErr && newCli?.id) {
                clienteId = String((newCli as { id: string }).id);
                clienteNombreResuelto = clienteNombre;
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
              items: (obras as Array<{ id: string; nombre: string; direccion: string | null; estado: string | null; fecha_inicio: string | null }>).map((o) => ({
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
            items: (obras as Array<{ id: string; nombre: string; cliente_id: string | null; direccion: string | null; estado: string | null; fecha_inicio: string | null }>).map((o) => ({
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
          type TipoPermitido = typeof tiposPermitidos[number];
          const esTipoPermitido = (t: string): t is TipoPermitido =>
            (tiposPermitidos as readonly string[]).includes(t);
          const tiposFinal =
            Array.isArray(toolArgs.tipos) && toolArgs.tipos.length > 0
              ? (toolArgs.tipos as unknown[])
                  .map((t) => String(t).trim().toLowerCase())
                  .filter(esTipoPermitido)
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
            tiposFinal.some((t) => (['presupuestos', 'facturas', 'albaranes', 'gastos'] as readonly TipoPermitido[]).includes(t));
          if (necesitaCliente && !clienteId) {
            return { error: 'cliente_id o cliente_nombre es obligatorio para asociar presupuestos/facturas/albaranes/gastos' };
          }

          if (tiposFinal.includes('diario') && !clienteId && !(obraNombre || obraNombreRaw)) {
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

          const [nPres, nFac, nAlb] = await Promise.all([
            tiposFinal.includes('presupuestos') ? updateNoDiario('presupuestos') : Promise.resolve(0),
            tiposFinal.includes('facturas') ? updateNoDiario('facturas') : Promise.resolve(0),
            tiposFinal.includes('albaranes') ? updateNoDiario('albaranes') : Promise.resolve(0),
            tiposFinal.includes('gastos') ? updateNoDiario('gastos') : Promise.resolve(0),
            tiposFinal.includes('diario') ? updateDiario() : Promise.resolve(0),
          ]);

          const mensaje = `Asociados ${nPres} presupuestos, ${nFac} facturas, ${nAlb} albaranes a la obra '${obraNombre}'.`;

          return { mensaje, ok: true };
        }
        case 'crear_cliente': {
          const nombreCli = String(toolArgs.nombre ?? '').trim();
          if (!nombreCli) {
            return { error: 'nombre es obligatorio' };
          }
          const { data: clientesRows, error: errCliList } = await supabase
            .from('clientes')
            .select('id, nombre')
            .eq('business_id', business_id);
          if (errCliList) return { error: errCliList.message };
          const similar = buscarClienteSimilarExistente(nombreCli, clientesRows ?? []);
          if (similar) {
            return {
              id: similar.id,
              mensaje: `El cliente ${similar.nombre} ya existe, usando el existente.`,
              existente: true,
            };
          }
          const telefono =
            toolArgs.telefono != null ? String(toolArgs.telefono).trim() || null : null;
          const email = toolArgs.email != null ? String(toolArgs.email).trim() || null : null;
          const direccion =
            toolArgs.direccion != null ? String(toolArgs.direccion).trim() || null : null;
          const nif = toolArgs.nif != null ? String(toolArgs.nif).trim() || null : null;
          const notas = toolArgs.notas != null ? String(toolArgs.notas).trim() || null : null;

          const { data: insertedCli, error } = await supabase
            .from('clientes')
            .insert({
              business_id,
              nombre: nombreCli,
              telefono,
              email,
              direccion,
              nif,
              notas,
            })
            .select('id')
            .maybeSingle();

          if (error) {
            console.error('[crear_cliente] insert failed:', error.message, error);
            return { error: error.message };
          }
          const nuevoId =
            insertedCli && typeof (insertedCli as { id?: string }).id === 'string'
              ? (insertedCli as { id: string }).id.trim()
              : '';
          if (!nuevoId) {
            console.error(
              '[crear_cliente] insert sin error pero sin id devuelto (revisa RLS o select)'
            );
            return {
              error: 'No se pudo confirmar el cliente creado. Revisa permisos o inténtalo de nuevo.',
            };
          }
          return {
            id: nuevoId,
            mensaje: `Cliente ${nombreCli} creado correctamente.`,
          };
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
        case 'leer_emails_recientes':
          return handleLeerEmailsRecientes(toolArgs, authUser?.id);
        case 'enviar_email':
          return handleEnviarEmail(toolArgs);
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

          const baseMsg =
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
            const obraNombreExplicito =
              typeof toolArgs.obra_nombre === 'string' && toolArgs.obra_nombre.trim()
                ? toolArgs.obra_nombre.trim()
                : '';
            const textoObra = [obraNombreExplicito, clienteNombre, direccionObra]
              .filter(Boolean)
              .join(' ')
              .trim() || mensajeTrim;
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

          const soloVista = toolArgs.solo_vista_previa === true;
          if (soloVista) {
            return {
              mensaje: `Borrador (sin guardar aún):\n\n${texto}`,
              partidas,
              importe_total: totalConIva,
              pendiente_confirmacion: true,
            };
          }

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
          if (!['listar', 'añadir', 'editar', 'eliminar'].includes(accion)) {
            return { error: 'accion debe ser listar, añadir, editar o eliminar' };
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

          if (accion === 'eliminar') {
            const tarifaId = String(toolArgs.tarifa_id ?? '').trim();
            const nombreTarifa = String(toolArgs.nombre_tarifa ?? '').trim();
            const confirmarEliminacion = toolArgs.confirmar_eliminacion === true;

            type TarifaDeleteRow = {
              id: string;
              nombre: string;
              unidad: string;
              precio: number | string;
            };

            let candidatas: TarifaDeleteRow[] = [];

            if (tarifaId) {
              const { data, error } = await supabase
                .from('tarifas')
                .select('id, nombre, unidad, precio')
                .eq('id', tarifaId)
                .eq('business_id', business_id)
                .limit(1);
              if (error) return { error: error.message };
              candidatas = (data ?? []) as TarifaDeleteRow[];
            } else {
              if (!nombreTarifa) {
                return { error: 'Para eliminar, indica tarifa_id o nombre_tarifa.' };
              }
              const safeNombre = nombreTarifa.replace(/[%_]/g, '').trim();
              if (!safeNombre) return { error: 'nombre_tarifa no válido.' };
              const { data, error } = await supabase
                .from('tarifas')
                .select('id, nombre, unidad, precio')
                .eq('business_id', business_id)
                .ilike('nombre', `%${safeNombre}%`)
                .order('nombre', { ascending: true })
                .limit(10);
              if (error) return { error: error.message };
              candidatas = (data ?? []) as TarifaDeleteRow[];
            }

            if (candidatas.length === 0) {
              return { error: 'No se encontró ninguna tarifa que coincida para eliminar.' };
            }

            if (candidatas.length > 1) {
              return {
                requiere_confirmacion: true,
                multiple_candidatas: true,
                mensaje:
                  'He encontrado varias tarifas. Indica tarifa_id (o un nombre más específico) y confirma explícitamente para eliminar.',
                candidatas: candidatas.map((r) => ({
                  id: r.id,
                  nombre: r.nombre,
                  unidad: r.unidad,
                  precio: r.precio != null ? Number(r.precio) : null,
                })),
              };
            }

            const candidata = candidatas[0]!;
            if (!confirmarEliminacion) {
              return {
                requiere_confirmacion: true,
                mensaje:
                  'Vista previa de eliminación. Si quieres borrarla, vuelve a llamar con confirmar_eliminacion=true.',
                tarifa: {
                  id: candidata.id,
                  nombre: candidata.nombre,
                  unidad: candidata.unidad,
                  precio: candidata.precio != null ? Number(candidata.precio) : null,
                },
              };
            }

            const { data: deletedRows, error: delErr } = await supabase
              .from('tarifas')
              .delete()
              .eq('id', candidata.id)
              .eq('business_id', business_id)
              .select('id, nombre, precio')
              .limit(1);
            if (delErr) return { error: delErr.message };
            const deleted = (deletedRows ?? [])[0] as { id: string; nombre: string; precio: number | string } | undefined;
            if (!deleted?.id) return { error: 'Tarifa no encontrada o sin permisos para eliminar.' };
            return {
              ok: true,
              id: deleted.id,
              mensaje: `Tarifa eliminada: "${deleted.nombre}" (${Number(deleted.precio)} €).`,
            };
          }

          return { error: 'accion no reconocida' };
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

    const capturarObraFicha = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.accion !== 'abrir_ficha_obra') return;
      const obra_id = String(o.obra_id ?? '').trim();
      const obra_nombre = String(o.obra_nombre ?? '').trim();
      if (!obra_id) return;
      obraFichaParaCliente = { obra_id, obra_nombre };
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
            capturarObraFicha(toolResult);
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
