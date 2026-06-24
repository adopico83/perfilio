import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Normaliza hora dictada o en texto libre a HH:MM cuando es posible. */
function normalizeHora(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  m = s.match(/^(\d{1,2})\s*h$/i);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  const low = s.toLowerCase();
  const mañana = low.includes('mañana') || low.includes('manana');
  const tarde = low.includes('tarde');
  const noche = low.includes('noche');

  m = s.match(/(?:a\s+las|^las)\s+(\d{1,2})(?::(\d{2}))?/i);
  if (!m) {
    m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  }
  if (!m) {
    m = s.match(/(\d{1,2})\s*(?:de\s+la\s+)?(?:mañana|manana)/i);
  }
  if (m) {
    let h = Number(m[1]);
    const min = m[2] != null && m[2] !== '' ? Number(m[2]) : 0;
    if (Number.isNaN(min) || min < 0 || min > 59) return null;
    if (tarde && h >= 1 && h <= 11) {
      h += 12;
    } else if (noche && h >= 1 && h <= 11) {
      h += 12;
    } else if (mañana && h >= 1 && h <= 11) {
      /* mañana: 1–11 se interpretan como horas de la mañana */
    }
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseHmToMinutes(hm: string): number {
  const [a, b] = hm.split(':').map((x) => Number(x));
  return a * 60 + b;
}

function formatMinutesToHm(totalMinutes: number): string {
  const minsInDay = 24 * 60;
  const wrapped = ((totalMinutes % minsInDay) + minsInDay) % minsInDay;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseMinutosAntelacion(raw: unknown): { value: number; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: 0 };
  const parsed =
    typeof raw === 'number' && Number.isInteger(raw) ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return { value: 0, error: 'minutos_antelacion debe ser un entero mayor o igual que 0' };
  }
  return { value: parsed };
}

const TZ_MADRID = 'Europe/Madrid';

/** YYYY-MM-DD del instante dado en Europe/Madrid (misma idea que diario.ts). */
function formatYmdInMadrid(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MADRID,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addGregorianDaysFromYmd(ymd: string, deltaDays: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const u = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  const yy = u.getUTCFullYear();
  const mm = u.getUTCMonth() + 1;
  const dd = u.getUTCDate();
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Un instante (mediodía aprox.) en ese día civil en Madrid; sirve para leer día de la semana con Intl. */
function noonOnMadridYmd(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  const Y = Number(m[1]);
  const M = Number(m[2]);
  const D = Number(m[3]);
  const center = Date.UTC(Y, M - 1, D, 12, 0, 0);
  for (let h = -48; h <= 48; h++) {
    const cand = new Date(center + h * 3600000);
    if (formatYmdInMadrid(cand) === ymd) return cand;
  }
  return new Date(center);
}

/** 0 = domingo … 6 = sábado (como Date.getDay en la zona). */
function madridJsWeekdaySun0(ymd: string): number {
  const t = noonOnMadridYmd(ymd);
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MADRID,
    weekday: 'short',
  }).format(t);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

/** Próxima fecha (desde hoy en Madrid, incluyendo hoy) con el mismo día de la semana que refYmd. */
function nextSameWeekdayFromHoyMadrid(refYmd: string, hoyYmd: string): string {
  const target = madridJsWeekdaySun0(refYmd);
  for (let add = 0; add < 7; add++) {
    const cand = addGregorianDaysFromYmd(hoyYmd, add);
    if (madridJsWeekdaySun0(cand) === target) return cand;
  }
  return hoyYmd;
}

function normFechaRelativaKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^el\s+/, '');
}

function dowFromSpanishDay(n: string): number | null {
  const map: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  return map[n] ?? null;
}

/** Resuelve fecha_relativa a YYYY-MM-DD en calendario Madrid (hoy = hoyYmd). */
function resolveFechaRelativaToYmd(raw: string, hoyYmd: string): string | null {
  const n = normFechaRelativaKey(raw);
  if (n === 'pasado manana') return addGregorianDaysFromYmd(hoyYmd, 2);
  if (n === 'manana') return addGregorianDaysFromYmd(hoyYmd, 1);
  const dow = dowFromSpanishDay(n);
  if (dow === null) return null;
  for (let add = 0; add < 7; add++) {
    const cand = addGregorianDaysFromYmd(hoyYmd, add);
    if (madridJsWeekdaySun0(cand) === dow) return cand;
  }
  return null;
}

const DURACION_DEFECTO_MIN = 60;
const VENTANA_TRABAJO_INICIO_MIN = 8 * 60;
const VENTANA_TRABAJO_FIN_MIN = 20 * 60;

type IntervaloMin = { inicio: number; fin: number; id: string; titulo: string };

function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, '').trim();
}

function horaTextoAMinutos(hora: string | null | undefined): number | null {
  if (hora == null) return null;
  const t = String(hora).trim();
  if (!t) return null;
  const n = normalizeHora(t);
  if (!n) return null;
  return parseHmToMinutes(n);
}

function intervalosSolapan(a: IntervaloMin, b: IntervaloMin): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

function parseDuracionMinutos(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DURACION_DEFECTO_MIN;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 15 || n > 24 * 60) return DURACION_DEFECTO_MIN;
  return Math.round(n);
}

async function cargarIntervalosDiaAgenda(
  supabase: SupabaseClient,
  businessId: string,
  fecha: string,
  duracionSlotMin: number,
  excluirId?: string
): Promise<IntervaloMin[]> {
  const { data, error } = await supabase
    .from('agenda')
    .select('id, titulo, hora')
    .eq('business_id', businessId)
    .eq('fecha', fecha);
  if (error || !data) return [];
  const out: IntervaloMin[] = [];
  for (const row of data as Array<{ id: string; titulo?: string | null; hora?: string | null }>) {
    if (excluirId && row.id === excluirId) continue;
    const hm = horaTextoAMinutos(row.hora ?? null);
    if (hm == null) continue;
    out.push({
      id: row.id,
      titulo: String(row.titulo ?? '').trim() || 'Evento',
      inicio: hm,
      fin: hm + duracionSlotMin,
    });
  }
  return out;
}

function sugerirHuecoLibre(
  candidatoInicio: number,
  duracionMin: number,
  ocupados: IntervaloMin[]
): string | null {
  const slotLen = duracionMin;
  const candidato: IntervaloMin = {
    id: '__nuevo__',
    titulo: '',
    inicio: candidatoInicio,
    fin: candidatoInicio + slotLen,
  };
  const choca = ocupados.some((o) => intervalosSolapan(candidato, o));
  if (!choca) return formatMinutesToHm(candidatoInicio);

  let best: { dist: number; inicio: number } | null = null;
  for (let start = VENTANA_TRABAJO_INICIO_MIN; start + slotLen <= VENTANA_TRABAJO_FIN_MIN; start += 15) {
    const probe: IntervaloMin = {
      id: '__probe__',
      titulo: '',
      inicio: start,
      fin: start + slotLen,
    };
    if (ocupados.some((o) => intervalosSolapan(probe, o))) continue;
    const dist = Math.abs(start - candidatoInicio);
    if (!best || dist < best.dist) best = { dist, inicio: start };
  }
  return best ? formatMinutesToHm(best.inicio) : null;
}

type ClienteMatch = {
  id: string;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  nif: string | null;
};

async function buscarClientePorTitulo(
  supabase: SupabaseClient,
  businessId: string,
  titulo: string
): Promise<ClienteMatch | null> {
  const tokens = titulo
    .split(/[\s,;:|/\\-]+/)
    .map((t) => escapeIlike(t))
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, direccion, nif')
      .eq('business_id', businessId)
      .ilike('nombre', `%${token}%`)
      .order('nombre', { ascending: true })
      .limit(1);
    if (error || !data?.[0]) continue;
    const r = data[0] as ClienteMatch;
    if (r?.id) return r;
  }
  return null;
}

type ObraMatch = { id: string; nombre: string; direccion: string | null };

async function buscarObraPorTitulo(
  supabase: SupabaseClient,
  businessId: string,
  titulo: string
): Promise<ObraMatch | null> {
  const tokens = titulo
    .split(/[\s,;:|/\\-]+/)
    .map((t) => escapeIlike(t))
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    const { data, error } = await supabase
      .from('obras')
      .select('id, nombre, direccion')
      .eq('business_id', businessId)
      .in('estado', ['abierta', 'en_curso'])
      .ilike('nombre', `%${token}%`)
      .order('nombre', { ascending: true })
      .limit(1);
    if (error || !data?.[0]) continue;
    const r = data[0] as ObraMatch;
    if (r?.id) return r;
  }
  return null;
}

async function ultimoEstadoPresupuestoObraOCliente(
  supabase: SupabaseClient,
  businessId: string,
  obraId: string | null,
  clienteId: string | null
): Promise<string | null> {
  let q = supabase
    .from('presupuestos')
    .select('estado')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (obraId) q = q.eq('obra_id', obraId);
  else if (clienteId) q = q.eq('cliente_id', clienteId);
  else return null;
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return String((data as { estado?: string | null }).estado ?? '').trim() || null;
}

async function hayPresupuestoAceptadoSinFacturaObra(
  supabase: SupabaseClient,
  businessId: string,
  obraId: string | null
): Promise<boolean> {
  if (!obraId) return false;
  const { data: pres, error: pErr } = await supabase
    .from('presupuestos')
    .select('id')
    .eq('business_id', businessId)
    .eq('obra_id', obraId)
    .eq('estado', 'aceptado')
    .limit(1);
  if (pErr || !pres?.length) return false;
  const { data: fac, error: fErr } = await supabase
    .from('facturas')
    .select('id')
    .eq('business_id', businessId)
    .eq('obra_id', obraId)
    .limit(1);
  if (fErr) return false;
  return !(fac?.length);
}

async function hayPresupuestoAceptadoSinFacturaCliente(
  supabase: SupabaseClient,
  businessId: string,
  clienteId: string | null
): Promise<boolean> {
  if (!clienteId) return false;
  const { data: pres, error: pErr } = await supabase
    .from('presupuestos')
    .select('id, obra_id')
    .eq('business_id', businessId)
    .eq('cliente_id', clienteId)
    .eq('estado', 'aceptado')
    .limit(10);
  if (pErr || !pres?.length) return false;
  let anyObra = false;
  for (const row of pres as Array<{ obra_id: string | null }>) {
    if (row.obra_id) {
      anyObra = true;
      const sinFac = await hayPresupuestoAceptadoSinFacturaObra(supabase, businessId, row.obra_id);
      if (sinFac) return true;
    }
  }
  return !anyObra;
}

function normTituloAgenda(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Extrae el valor tras 📞 o 📍 en la plantilla guardada en description (hasta | o salto de línea). */
function extraerCampoPlantillaDescripcion(desc: string, prefijo: '📞' | '📍'): string | null {
  const idx = desc.indexOf(prefijo);
  if (idx === -1) return null;
  let start = idx + prefijo.length;
  while (start < desc.length && /\s/.test(desc[start]!)) start++;
  const pipe = desc.indexOf('|', start);
  const nl = desc.indexOf('\n', start);
  let end = desc.length;
  if (pipe !== -1) end = Math.min(end, pipe);
  if (nl !== -1) end = Math.min(end, nl);
  const v = desc.slice(start, end).trim();
  if (!v || v === '—') return null;
  return v;
}

/** Mensajes cortos de confirmación (p. ej. tras vista previa SDD). Evita bucles si el modelo repite solo_vista_previa true. */
function esConfirmacionUsuario(raw: string): boolean {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!s) return false;
  const t = s.replace(/\s+/g, ' ').replace(/[¡!?¿.]/g, '').trim();
  if (/^(no|nop|no gracias|mejor no|cancela|cancelar|dejalo|déjalo|olvida|olvídalo)\b/.test(t)) {
    return false;
  }
  if (t.length <= 40) {
    if (
      /^(sí|si|vale|ok|okay|adelante|confirmo|correcto|exacto|hazlo|claro|genial|perfecto|listo)$/.test(t)
    ) {
      return true;
    }
    if (/^(si|sí)(\s+(por favor|vale|ok|adelante|elimina|borra))?$/.test(t)) {
      return true;
    }
    if (/^(elimina|eliminar|borra|borrar|elimínalo|borralo)$/.test(t)) {
      return true;
    }
  }
  return false;
}

export const AGENDA_HANDLED_TOOLS = new Set([
  'obtener_agenda',
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
]);

export const AGENDA_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'obtener_agenda',
      description:
        'Lista eventos de agenda para una fecha YYYY-MM-DD (hora, título, descripción, ubicación). Úsala SIEMPRE antes de crear_recordatorio para comprobar solapes.',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
        },
        required: ['fecha'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
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
          telefono: { type: 'string', description: 'Teléfono del cliente (alternativa: cliente_telefono)' },
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
          notas: { type: 'string', description: 'Texto libre del usuario para el campo Notas de la descripción' },
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
    type: 'function' as const,
    function: {
      name: 'editar_recordatorio',
      description: 'Editar un recordatorio existente',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          titulo: { type: 'string' },
          fecha: { type: 'string', description: 'Formato YYYY-MM-DD' },
          hora: { type: 'string', description: 'Formato HH:MM (o vacío para quitarla)' },
          minutos_antelacion: {
            type: 'integer',
            description: 'Minutos de antelación para el aviso (entero mayor o igual que 0).',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
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
    type: 'function' as const,
    function: {
      name: 'eliminar_evento_agenda',
      description:
        'Elimina un evento de agenda buscando por título aproximado y/o fecha. SDD: solo_vista_previa true primero; luego solo_vista_previa false con evento_id. No confundir con eliminar_recordatorio por id si solo se conoce el UUID.',
      parameters: {
        type: 'object',
        properties: {
          titulo_fragmento: {
            type: 'string',
            description: 'Texto del título del recordatorio (búsqueda aproximada)',
          },
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
    type: 'function' as const,
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
];

export const AGENDA_AGENT_SYSTEM_PROMPT = `Tu nombre es Bicho. Si el usuario te llama por tu nombre al inicio de una petición ('Oye Bicho...', 'Bicho escucha...', 'Bicho añade...', 'Eh Bicho...' o similar), ignora el nombre y ejecuta directamente lo que pide a continuación. No respondas al nombre, no lo confirmes, simplemente actúa.

Eres el especialista en agenda y recordatorios de Perfilio.

[MÁXIMA PRIORIDAD — ANTES QUE CUALQUIER OTRA REGLA]
REGLA ABSOLUTA: Cuando el usuario mencione cualquier nombre de persona, empresa u obra al crear una cita, DEBES buscar sus datos ANTES de crear el evento, sin esperar a que te lo pidan. No es opcional. Es tu responsabilidad como secretario proactivo. Si el nombre no existe en el sistema, créalo con los datos que tengas.

SECRETARIO INVISIBLE — FRASES COTIDIANAS (ej.: «Cita con Mendi mañana a las 10»):
Actúa sin pedir permiso para «empezar el flujo». En orden:
1. Búsqueda de cliente u obra por nombre (buscar_cliente y/o buscar_obra con el fragmento que corresponda a persona, empresa u obra) antes de dar el evento por hecho.
2. obtener_agenda para el día ya resuelto en YYYY-MM-DD y comprobación de conflictos (1 h por defecto, salvo duracion_minutos).
3. crear_recordatorio con solo_vista_previa true: propuesta con datos enriquecidos (teléfono, dirección, estado presupuesto, notas, alertas que devuelva el servidor). Puedes usar fecha_relativa (mañana, lunes, etc.) o fecha YYYY-MM-DD. Solo tras confirmación explícita del usuario, segunda llamada con solo_vista_previa false u omitido para guardar.

AGENDA INTELIGENTE — OBLIGATORIO ANTES DE CREAR:
1. Antes de llamar a crear_recordatorio, llama SIEMPRE a obtener_agenda con la misma fecha (YYYY-MM-DD) que va a usar el evento. Revisa el TOOL RESULT: si hay solape horario con el nuevo evento, NO llames a crear_recordatorio. Asume duración de 1 hora (60 min) para comprobar solapes salvo que Pino indique otra duración (duracion_minutos). Si hay solape, explica el conflicto y sugiere el hueco libre más cercano que devuelva el servidor (campo hueco_sugerido si viene en el error).
2. Si el usuario menciona un nombre de cliente u obra, antes de crear consulta sus datos en el sistema (buscar_cliente, buscar_obra, ver_cliente o ver_ficha_obra si hace falta): necesitas teléfono y dirección para la descripción. No inventes teléfonos ni direcciones.
3. El campo descripción del evento debe seguir EXACTAMENTE esta plantilla (rellena con datos reales o "—" si no hay dato), salvo que envíes el parámetro description completo en crear_recordatorio para sustituirla:
   📞 [Teléfono] | 📍 [Dirección] | 📄 [Estado presupuesto] | Notas: [texto del usuario]
   El servidor puede completar teléfono, dirección y estado al guardar; tú debes pasar "notas" en crear_recordatorio cuando el usuario dé detalles. Si pasas description o location en la tool, se guardan tal cual en Supabase (tienen prioridad sobre lo inferido).

REGLAS ABSOLUTAS:
4. NUNCA confirmes un recordatorio sin haber recibido TOOL RESULT de crear_recordatorio con ok:true. Llama a la tool primero, espera el resultado, solo entonces confirma.
5. Formato de confirmación obligatorio: 'Recordatorio [operación]: [título] para [fecha] a las [hora]. ¿Algo más?'
6. NUNCA uses body.business_id — usa siempre el business_id recibido por parámetro.
7. Si el usuario dicta una hora en lenguaje natural ('a las 9 de la mañana', 'a las 3 de la tarde'), conviértela siempre a formato HH:MM antes de guardar.
SINÓNIMOS: Las palabras 'alarma', 'aviso', 'alerta', 'recordatorio' y 'que me salte algo' son siempre peticiones de crear_recordatorio. Nunca las trates como ajenas al dominio de agenda.
8. Si el usuario dice algo ajeno a la agenda, responde: 'Para eso tendrás que preguntarme fuera del contexto de agenda. ¿Algo más con los recordatorios?'

CREACIÓN (SDD):
9. Si la tool crear_recordatorio admite solo_vista_previa: primera llamada con solo_vista_previa true (tras obtener_agenda y búsquedas); tras confirmación explícita, misma llamada con solo_vista_previa false u omitido para insertar.

ELIMINACIÓN (SDD — obligatorio):
10. Si el TOOL RESULT trae pendiente_confirmacion: true (vista previa de borrado), el siguiente mensaje del usuario que sea afirmación corta (sí, vale, ok, adelante, elimina, etc.) DEBE ejecutar el borrado: misma tool (eliminar_recordatorio o eliminar_evento_agenda) con el mismo id/evento_id y solo_vista_previa false u omitido. NO vuelvas a llamar con solo_vista_previa true tras una vista previa de borrado.
11. Si ya mostraste la vista previa y el usuario confirma, nunca repitas la pregunta de confirmación sin llamar antes a la tool en modo ejecución (solo_vista_previa false).`;

export type HandleAgendaCtx = {
  mensajeTrim?: string;
};

export async function handleAgenda(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient,
  _openai: OpenAI,
  ctx: HandleAgendaCtx = {}
): Promise<Record<string, unknown>> {
  void userId;
  void _openai;
  const mensajeTrim = ctx.mensajeTrim ?? '';

  const bid =
    typeof businessId === 'string' ? businessId : String(businessId ?? '');
  if (!bid) {
    return { error: 'business_id es requerido' };
  }

  switch (toolName) {
    case 'obtener_agenda': {
      const fechaAg = String(toolArgs.fecha ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaAg)) {
        return { error: 'La fecha debe tener formato YYYY-MM-DD' };
      }
      const { data, error } = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora, description, location, minutos_antelacion')
        .eq('business_id', bid)
        .eq('fecha', fechaAg)
        .order('hora', { ascending: true, nullsFirst: false });
      if (error) return { error: error.message };
      const items = (data ?? []).map((row: Record<string, unknown>) => {
        const horaStr = row.hora != null ? String(row.hora).trim() : '';
        const ini = horaTextoAMinutos(horaStr);
        return {
          id: String(row.id ?? ''),
          titulo: String(row.titulo ?? ''),
          fecha: String(row.fecha ?? fechaAg),
          hora: horaStr || null,
          inicio_minutos: ini,
          fin_minutos: ini != null ? ini + DURACION_DEFECTO_MIN : null,
          description: row.description != null ? String(row.description) : null,
          location: row.location != null ? String(row.location) : null,
          minutos_antelacion:
            row.minutos_antelacion != null && Number.isFinite(Number(row.minutos_antelacion))
              ? Number(row.minutos_antelacion)
              : 0,
        };
      });
      return { fecha: fechaAg, items };
    }
    case 'crear_recordatorio': {
      const hoyYmdAgenda = formatYmdInMadrid(new Date());
      const relRaw = String(toolArgs.fecha_relativa ?? '').trim();
      let fechaRaw = '';
      if (relRaw) {
        const resRel = resolveFechaRelativaToYmd(relRaw, hoyYmdAgenda);
        if (!resRel) {
          return {
            error:
              'fecha_relativa no reconocida. Valores válidos: mañana, pasado mañana, lunes, martes, miércoles, jueves, viernes, sábado, domingo.',
          };
        }
        fechaRaw = resRel;
      } else {
        fechaRaw = String(toolArgs.fecha ?? '').trim().split('T')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
          const yNum = parseInt(fechaRaw.slice(0, 4), 10);
          if (Number.isFinite(yNum) && yNum < 2026) {
            fechaRaw = nextSameWeekdayFromHoyMadrid(fechaRaw, hoyYmdAgenda);
          }
        }
      }

      if (!fechaRaw) {
        return { error: 'Indica fecha o fecha_relativa.' };
      }

      const tipoEv = String(toolArgs.tipo ?? '').trim();
      const clienteNombreArg = String(
        toolArgs.cliente ?? toolArgs.cliente_nombre ?? ''
      ).trim();
      const telefonoArg = String(
        toolArgs.telefono ?? toolArgs.cliente_telefono ?? ''
      ).trim();
      const direccionArg = String(
        toolArgs.direccion ?? toolArgs.cliente_direccion ?? ''
      ).trim();

      let titulo = String(toolArgs.titulo ?? '').trim();
      if (!titulo) {
        if (tipoEv && clienteNombreArg) {
          titulo = `${tipoEv} con ${clienteNombreArg}`;
        } else if (tipoEv) {
          titulo = tipoEv;
        } else if (clienteNombreArg) {
          titulo = `Cita con ${clienteNombreArg}`;
        }
      }

      const horaOpt = toolArgs.hora != null ? String(toolArgs.hora).trim() : '';
      const notasUsuario = toolArgs.notas != null ? String(toolArgs.notas).trim() : '';
      const duracionMin = parseDuracionMinutos(toolArgs.duracion_minutos);
      const soloVistaCrear =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const userConfirmaCrear = esConfirmacionUsuario(mensajeTrim);

      const { value: minutosAntelacion, error: errMinAnt } = parseMinutosAntelacion(
        toolArgs.minutos_antelacion
      );

      if (!titulo) {
        return {
          error:
            'Indica titulo, o bien fecha o fecha_relativa y (tipo + cliente) para construir el título (ej. tipo "Cita", cliente "Mendi").',
        };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
        return { error: 'La fecha debe tener formato YYYY-MM-DD' };
      }
      if (errMinAnt) {
        return { error: errMinAnt };
      }

      console.log('[agenda] crear_recordatorio toolArgs', JSON.stringify(toolArgs));
      console.log(
        '[agenda] crear_recordatorio toolArgs.description',
        toolArgs.description,
        'toolArgs.location',
        toolArgs.location
      );

      const tituloNorm = normTituloAgenda(titulo);
      const { data: mismoDia, error: errMismoDia } = await supabase
        .from('agenda')
        .select('id, titulo')
        .eq('business_id', bid)
        .eq('fecha', fechaRaw);

      if (errMismoDia) {
        return { error: errMismoDia.message };
      }

      const minLenSimilar = 12;
      const safeIlike = titulo.replace(/[%_]/g, '').trim().toLowerCase();
      for (const r of mismoDia ?? []) {
        const ex = String((r as { titulo?: string | null }).titulo ?? '');
        const nEx = normTituloAgenda(ex);
        if (nEx === tituloNorm) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
        if (
          tituloNorm.length >= minLenSimilar &&
          nEx.length >= minLenSimilar &&
          (tituloNorm.includes(nEx) || nEx.includes(tituloNorm))
        ) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
        const exLow = ex.toLowerCase();
        const tituloLow = titulo.toLowerCase();
        if (
          safeIlike.length >= 4 &&
          (exLow.includes(safeIlike) ||
            (ex.trim().length >= 4 && tituloLow.includes(ex.trim().toLowerCase())))
        ) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
      }

      const needleClienteObra = [titulo, clienteNombreArg].filter(Boolean).join(' ').trim() || titulo;
      const clienteMatch = await buscarClientePorTitulo(supabase, bid, needleClienteObra);
      console.log('[agenda] buscarClientePorTitulo', {
        encontrado: Boolean(clienteMatch),
        cliente: clienteMatch,
        needle: needleClienteObra,
      });
      const obraMatch = await buscarObraPorTitulo(supabase, bid, needleClienteObra);

      const telefonoDesc =
        (telefonoArg ? telefonoArg : (clienteMatch?.telefono ?? '').trim()) || '—';
      const dirClienteResuelta = (direccionArg || (clienteMatch?.direccion ?? '').trim()).trim();
      const dirObra = (obraMatch?.direccion ?? '').trim();
      const dirMapa = dirClienteResuelta || dirObra || '—';
      const locationGps = dirObra || (dirClienteResuelta || null) || null;

      const estadoPres =
        (await ultimoEstadoPresupuestoObraOCliente(
          supabase,
          bid,
          obraMatch?.id ?? null,
          clienteMatch?.id ?? null
        )) ?? '—';

      let anticipoPendiente = false;
      if (obraMatch?.id) {
        anticipoPendiente = await hayPresupuestoAceptadoSinFacturaObra(supabase, bid, obraMatch.id);
      } else if (clienteMatch?.id) {
        anticipoPendiente = await hayPresupuestoAceptadoSinFacturaCliente(supabase, bid, clienteMatch.id);
      }

      let descripcion =
        `📞 ${telefonoDesc} | 📍 ${dirMapa} | 📄 ${estadoPres} | Notas: ${notasUsuario || '—'}`;
      if (anticipoPendiente) {
        descripcion += '\n⚠️ Anticipo pendiente de cobrar';
      }

      const descriptionArg =
        toolArgs.description != null && String(toolArgs.description).trim()
          ? String(toolArgs.description).trim()
          : '';
      const locationArg =
        toolArgs.location != null && String(toolArgs.location).trim()
          ? String(toolArgs.location).trim()
          : '';
      const descriptionFinal = descriptionArg.length > 0 ? descriptionArg : descripcion;
      const locationFinal =
        locationArg.length > 0 ? locationArg : locationGps != null && locationGps.length > 0 ? locationGps : null;

      let horaFinal: string | undefined;
      if (horaOpt) {
        const normalized = normalizeHora(horaOpt);
        horaFinal = normalized ?? horaOpt;
      }

      const ocupados = await cargarIntervalosDiaAgenda(
        supabase,
        bid,
        fechaRaw,
        DURACION_DEFECTO_MIN
      );
      if (horaFinal) {
        const iniNuevo = horaTextoAMinutos(horaFinal);
        if (iniNuevo != null) {
          const nuevoSlot: IntervaloMin = {
            id: '__nuevo__',
            titulo,
            inicio: iniNuevo,
            fin: iniNuevo + duracionMin,
          };
          const solapa = ocupados.some((o) => intervalosSolapan(nuevoSlot, o));
          if (solapa) {
            const hueco = sugerirHuecoLibre(iniNuevo, duracionMin, ocupados);
            return {
              error: 'Solape en agenda: ya hay un evento en esa franja horaria.',
              solapamiento: true,
              hueco_sugerido: hueco,
            };
          }
        }
      }

      const insertPayload: {
        business_id: string;
        titulo: string;
        fecha: string;
        hora?: string;
        minutos_antelacion: number;
        description: string;
        location: string | null;
      } = {
        business_id: bid,
        titulo,
        fecha: fechaRaw,
        minutos_antelacion: minutosAntelacion,
        description: descriptionFinal,
        location: locationFinal,
      };
      if (horaFinal) insertPayload.hora = horaFinal;

      if (soloVistaCrear && !userConfirmaCrear) {
        return {
          mensaje:
            `Vista previa del evento (no guardado):\n• ${titulo}\n• ${fechaRaw} ${
              horaFinal ? `a las ${horaFinal}` : '(sin hora)'
            }\n• Ubicación GPS: ${locationFinal ?? '—'}\n• Descripción:\n${descriptionFinal}\n\n` +
            'Si el usuario confirma, vuelve a llamar a crear_recordatorio con los mismos datos y solo_vista_previa false (u omítelo).',
          pendiente_confirmacion: true,
          vista: insertPayload,
        };
      }

      console.log('[agenda] crear_recordatorio descriptionFinal antes de insertar', descriptionFinal);

      const { data: row, error } = await supabase
        .from('agenda')
        .insert(insertPayload)
        .select('id')
        .single();

      if (error || !row?.id) {
        return { error: error?.message ?? 'No se pudo crear el recordatorio' };
      }
      const horaConfirmacion = insertPayload.hora ?? (horaOpt || '—');
      const avisoNatural =
        minutosAntelacion > 0
          ? insertPayload.hora
            ? ` Perfecto, te aviso a las ${formatMinutesToHm(parseHmToMinutes(insertPayload.hora!) - minutosAntelacion)} para que llegues a tiempo a las ${insertPayload.hora}.`
            : ` Perfecto, te aviso con ${minutosAntelacion} minutos de antelación.`
          : '';

      const telMsg =
        extraerCampoPlantillaDescripcion(descriptionFinal, '📞') ??
        (telefonoDesc !== '—' ? telefonoDesc : '');
      const dirMsg =
        extraerCampoPlantillaDescripcion(descriptionFinal, '📍') ??
        (() => {
          const loc = locationFinal?.trim();
          if (loc) return loc;
          if (dirMapa !== '—') return dirMapa;
          return '';
        })();

      const alertas: string[] = [];
      if (anticipoPendiente) {
        alertas.push('Anticipo pendiente de cobrar');
      }

      const bloqueContacto: string[] = [];
      if (telMsg) bloqueContacto.push(`📞 ${telMsg}`);
      if (dirMsg) bloqueContacto.push(`📍 ${dirMsg}`);
      let postHora = '';
      if (bloqueContacto.length) postHora += ` ${bloqueContacto.join(' | ')}`;
      if (alertas.length) {
        postHora += (bloqueContacto.length ? '. ' : ' ') + `⚠️ ${alertas.join(', ')}`;
      }

      const mensajeCreado = `Recordatorio creado: ${titulo} para ${fechaRaw} a las ${horaConfirmacion}.${postHora}${avisoNatural} ¿Algo más?`;

      return {
        ok: true,
        id: row.id as string,
        mensaje: mensajeCreado,
      };
    }
    case 'editar_recordatorio': {
      const id = String(toolArgs.id ?? '').trim();
      if (!id) {
        return { error: 'id es obligatorio' };
      }

      const updates: {
        titulo?: string;
        fecha?: string;
        hora?: string | null;
        minutos_antelacion?: number;
      } = {};
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
        if (!h.length) {
          updates.hora = null;
        } else {
          const norm = normalizeHora(h);
          updates.hora = norm ?? h;
        }
      }
      if (toolArgs.minutos_antelacion !== undefined) {
        const { value, error: err } = parseMinutosAntelacion(toolArgs.minutos_antelacion);
        if (err) {
          return { error: err };
        }
        updates.minutos_antelacion = value;
      }

      if (Object.keys(updates).length === 0) {
        return {
          error:
            'Indica al menos un campo a actualizar (titulo, fecha, hora o minutos_antelacion)',
        };
      }

      const { data: row, error } = await supabase
        .from('agenda')
        .update(updates)
        .eq('id', id)
        .eq('business_id', bid)
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

      const soloVR =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const userConfirms = esConfirmacionUsuario(mensajeTrim);

      const previewElimRec = async () => {
        const { data: ev, error: evErr } = await supabase
          .from('agenda')
          .select('id, titulo, fecha, hora')
          .eq('id', id)
          .eq('business_id', bid)
          .maybeSingle();
        if (evErr) return { error: evErr.message } as const;
        if (!ev?.id) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' } as const;
        }
        return {
          mensaje:
            `¿Eliminar este recordatorio?\n` +
            `• ${String(ev.titulo ?? '').trim() || '—'}\n` +
            `• Fecha: ${String(ev.fecha ?? '').trim() || '—'}\n` +
            `• Hora: ${String(ev.hora ?? '').trim() || '—'}\n\n` +
            `Si el usuario confirma, vuelve a llamar a eliminar_recordatorio con el mismo id y solo_vista_previa false (u omítelo).`,
          pendiente_confirmacion: true,
          id: ev.id as string,
        } as const;
      };

      if (soloVR && !userConfirms) {
        const prev = await previewElimRec();
        if ('error' in prev && prev.error) return { error: prev.error };
        return prev;
      }

      const { data: deleted, error } = await supabase
        .from('agenda')
        .delete()
        .eq('id', id)
        .eq('business_id', bid)
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
    case 'eliminar_evento_agenda': {
      const soloVAg =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const userConfirms = esConfirmacionUsuario(mensajeTrim);
      const eventoIdAg =
        typeof toolArgs.evento_id === 'string' && toolArgs.evento_id.trim()
          ? toolArgs.evento_id.trim()
          : '';
      const tituloFragAg = String(toolArgs.titulo_fragmento ?? '').trim();
      const fechaAg = String(toolArgs.fecha ?? '').trim();

      if (eventoIdAg) {
        if (soloVAg && !userConfirms) {
          const { data: ev, error: evErr } = await supabase
            .from('agenda')
            .select('id, titulo, fecha, hora')
            .eq('id', eventoIdAg)
            .eq('business_id', bid)
            .maybeSingle();
          if (evErr) return { error: evErr.message };
          if (!ev?.id) {
            return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
          }
          return {
            mensaje:
              `¿Eliminar este recordatorio?\n` +
              `• ${String(ev.titulo ?? '').trim() || '—'}\n` +
              `• Fecha: ${String(ev.fecha ?? '').trim() || '—'}\n` +
              `• Hora: ${String(ev.hora ?? '').trim() || '—'}\n\n` +
              `Si el usuario confirma, vuelve a llamar a eliminar_evento_agenda con el mismo evento_id y solo_vista_previa false (u omítelo).`,
            pendiente_confirmacion: true,
            evento_id: ev.id,
          };
        }
        const { data: delEv, error: delEvErr } = await supabase
          .from('agenda')
          .delete()
          .eq('id', eventoIdAg)
          .eq('business_id', bid)
          .select('id')
          .maybeSingle();
        if (delEvErr) return { error: delEvErr.message };
        if (!delEv?.id) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
        }
        return { mensaje: 'Evento de agenda eliminado.', ok: true };
      }

      if (!tituloFragAg && !/^\d{4}-\d{2}-\d{2}$/.test(fechaAg)) {
        return {
          error: 'Indica titulo_fragmento y/o fecha (YYYY-MM-DD) para buscar el evento, o evento_id.',
        };
      }

      let qEv = supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('business_id', bid)
        .order('fecha', { ascending: false })
        .limit(80);

      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaAg)) {
        qEv = qEv.eq('fecha', fechaAg);
      }
      if (tituloFragAg) {
        const safeT = tituloFragAg.replace(/[%_*]/g, '').slice(0, 200);
        if (safeT) qEv = qEv.ilike('titulo', `%${safeT}%`);
      }

      const { data: evRows, error: evQErr } = await qEv;
      if (evQErr) return { error: evQErr.message };

      const evList = (evRows ?? []) as Array<{
        id: string;
        titulo: string | null;
        fecha: string | null;
        hora: string | null;
      }>;

      if (evList.length === 0) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      if (evList.length > 1) {
        const lines = evList.slice(0, 15).map((e, i) => {
          return `${i + 1}. ${e.fecha ?? '—'} — ${String(e.titulo ?? '').trim() || '—'} — id ${e.id}`;
        });
        return {
          mensaje: `Hay varios eventos que encajan:\n${lines.join('\n')}\nIndica cuál eliminar con evento_id.`,
          candidatos: evList.map((e) => e.id),
        };
      }

      const unoEv = evList[0]!;
      if (soloVAg && !userConfirms) {
        return {
          mensaje:
            `¿Eliminar este recordatorio?\n` +
            `• ${String(unoEv.titulo ?? '').trim() || '—'}\n` +
            `• Fecha: ${String(unoEv.fecha ?? '').trim() || '—'}\n` +
            `• Hora: ${String(unoEv.hora ?? '').trim() || '—'}\n\n` +
            `Si el usuario confirma, vuelve a llamar a eliminar_evento_agenda con evento_id "${unoEv.id}" y solo_vista_previa false (u omítelo).`,
          pendiente_confirmacion: true,
          evento_id: unoEv.id,
        };
      }
      if (!soloVAg && !userConfirms) {
        return {
          error:
            'Para borrar con seguridad, primero muestra la vista prevía con solo_vista_previa true.',
        };
      }

      const { data: delUno, error: delUnoErr } = await supabase
        .from('agenda')
        .delete()
        .eq('id', unoEv.id)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();
      if (delUnoErr) return { error: delUnoErr.message };
      if (!delUno?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      return { mensaje: 'Evento de agenda eliminado.', ok: true };
    }
    case 'modificar_evento_agenda': {
      const soloVEv =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const eventoIdM =
        typeof toolArgs.evento_id === 'string' && toolArgs.evento_id.trim()
          ? toolArgs.evento_id.trim()
          : '';

      const nuevoTit = toolArgs.nuevo_titulo != null ? String(toolArgs.nuevo_titulo).trim() : '';
      const nuevaFechaM = String(toolArgs.nueva_fecha ?? '').trim();
      const nuevaHoraM = toolArgs.nueva_hora !== undefined ? String(toolArgs.nueva_hora) : undefined;

      const tieneAlguno =
        nuevoTit.length > 0 ||
        /^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM) ||
        nuevaHoraM !== undefined;
      if (!tieneAlguno) {
        return { error: 'Indica nuevo_titulo, nueva_fecha y/o nueva_hora para modificar el evento.' };
      }

      let idEv = eventoIdM;
      if (!idEv) {
        const titFr = String(toolArgs.titulo_fragmento ?? '').trim();
        const fechaBus = String(toolArgs.fecha ?? '').trim();
        if (!titFr && !/^\d{4}-\d{2}-\d{2}$/.test(fechaBus)) {
          return { error: 'Indica evento_id o titulo_fragmento y/o fecha para buscar el evento.' };
        }
        let qM = supabase
          .from('agenda')
          .select('id, titulo, fecha, hora')
          .eq('business_id', bid)
          .order('fecha', { ascending: false })
          .limit(80);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaBus)) qM = qM.eq('fecha', fechaBus);
        if (titFr) {
          const st = titFr.replace(/[%_*]/g, '').slice(0, 200);
          if (st) qM = qM.ilike('titulo', `%${st}%`);
        }
        const { data: rowsM, error: errM } = await qM;
        if (errM) return { error: errM.message };
        const listM = (rowsM ?? []) as Array<{ id: string }>;
        if (listM.length === 0) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
        }
        if (listM.length > 1) {
          return {
            mensaje: `Hay varios eventos que encajan. Indica evento_id.\n${listM
              .slice(0, 15)
              .map((e, i) => `${i + 1}. ${e.id}`)
              .join('\n')}`,
            candidatos: listM.map((e) => e.id),
          };
        }
        idEv = listM[0]!.id;
      }

      const { data: evRow, error: evFE } = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('id', idEv)
        .eq('business_id', bid)
        .maybeSingle();
      if (evFE) return { error: evFE.message };
      if (!evRow?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }

      const titAct = String(evRow.titulo ?? '');
      const fechaActE = String(evRow.fecha ?? '');
      const horaAct = String(evRow.hora ?? '');

      const titN = nuevoTit || titAct;
      const fechaN = /^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM) ? nuevaFechaM : fechaActE;
      let horaN: string | null = horaAct;
      if (nuevaHoraM !== undefined) {
        const h = nuevaHoraM.trim();
        if (h.length === 0) {
          horaN = null;
        } else {
          const norm = normalizeHora(h);
          horaN = norm ?? h;
        }
      }

      const prevLines = [
        'Cambios propuestos en el evento (no guardados aún):',
        `• Título: ${titAct} → ${titN}`,
        `• Fecha: ${fechaActE} → ${fechaN}`,
        `• Hora: ${horaAct || '—'} → ${horaN ?? '—'}`,
        '',
        'Si el usuario confirma, vuelve a llamar a modificar_evento_agenda con el mismo evento_id y solo_vista_previa false.',
      ];

      if (soloVEv) {
        return {
          mensaje: prevLines.join('\n'),
          pendiente_confirmacion: true,
          evento_id: idEv,
        };
      }

      const updatesEv: { titulo?: string; fecha?: string; hora?: string | null } = {};
      if (nuevoTit.length > 0) updatesEv.titulo = titN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM)) updatesEv.fecha = fechaN;
      if (nuevaHoraM !== undefined) updatesEv.hora = horaN;

      if (Object.keys(updatesEv).length === 0) {
        return { error: 'No hay cambios que aplicar.' };
      }

      const { data: upEv, error: upEvErr } = await supabase
        .from('agenda')
        .update(updatesEv)
        .eq('id', idEv)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();
      if (upEvErr) return { error: upEvErr.message };
      if (!upEv?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      return { mensaje: 'Evento de agenda actualizado.', ok: true, id: upEv.id as string };
    }
    default:
      return { error: `Tool de agenda no soportada: ${toolName}` };
  }
}
