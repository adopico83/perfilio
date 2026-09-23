import type { McpContext } from '@/lib/mcp/context';

const TZ_MADRID = 'Europe/Madrid';
const DURACION_DEFECTO_MIN = 60;
const VENTANA_INICIO_MIN = 8 * 60;
const VENTANA_FIN_MIN = 20 * 60;

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const RECORDATORIO_GOOGLE_MIN = 15;

type AgendaOcupada = {
  id: string;
  titulo: string | null;
  hora: string | null;
  description: string | null;
  location: string | null;
};

/** Pista para que el agente copie la cita al Google Calendar del usuario. Este servidor no llama a Google. */
export type GoogleCalendarHint = {
  summary: string;
  start: string;
  end: string;
  location: string;
  description: string;
  reminder_minutes: 15;
};

export type CitaGuardada = {
  ok: true;
  id: string;
  titulo: string;
  asunto: string;
  cuando: string;
  fecha: string;
  hora: string;
  hora_fin: string | null;
  starts_at: string;
  ends_at: string;
  duracion_minutos: number;
  time_zone: typeof TZ_MADRID;
  lugar: string | null;
  notas: string;
  obra_id: null;
  google_calendar_hint: GoogleCalendarHint;
  duplicado?: true;
  mensaje?: string;
};

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function texto(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, max);
}

export function ymdEnMadrid(date: Date): string {
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

function ymdValido(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function sumarDias(ymd: string, delta: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const u = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  return ymdValido(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()) ?? ymd;
}

function diaSemanaMadrid(ymd: string): number {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const center = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  let instante = new Date(center);
  for (let h = -48; h <= 48; h++) {
    const cand = new Date(center + h * 3600000);
    if (ymdEnMadrid(cand) === ymd) {
      instante = cand;
      break;
    }
  }
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MADRID,
    weekday: 'short',
  }).format(instante);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

function claveFecha(raw: string): string {
  return sinAcentos(raw.trim().toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/^(?:el|este|proximo)\s+/, '');
}

/** Día civil en Europe/Madrid. Acepta AAAA-MM-DD, DD/MM/AAAA y dictado («mañana», «viernes», «24 de septiembre»). */
export function parseFechaCita(raw: string, now: Date): string | null {
  const original = raw.trim();
  if (!original) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(original)) {
    const [y, m, d] = original.split('-').map(Number);
    return ymdValido(y, m, d);
  }

  const dmy = original.match(/^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{4})$/);
  if (dmy) return ymdValido(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const hoy = ymdEnMadrid(now);
  const key = claveFecha(original);
  if (key === 'hoy') return hoy;
  if (key === 'manana') return sumarDias(hoy, 1);
  if (key === 'pasado manana') return sumarDias(hoy, 2);

  const dow = DIAS_SEMANA[key];
  if (dow != null) {
    for (let add = 0; add < 7; add++) {
      const cand = sumarDias(hoy, add);
      if (diaSemanaMadrid(cand) === dow) return cand;
    }
  }

  const corto = original.match(/^(\d{1,2})[/.\\-](\d{1,2})$/);
  if (corto) {
    return fechaSinAnio(Number(corto[1]), Number(corto[2]), hoy);
  }

  const larga = key.match(/^(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/);
  if (larga) {
    const mes = MESES[larga[2]];
    if (!mes) return null;
    const dia = Number(larga[1]);
    if (larga[3]) return ymdValido(Number(larga[3]), mes, dia);
    const anio = Number(hoy.slice(0, 4));
    return fechaSinAnio(dia, mes, hoy, anio);
  }

  return null;
}

function fechaSinAnio(dia: number, mes: number, hoy: string, anioBase?: number): string | null {
  const anio = anioBase ?? Number(hoy.slice(0, 4));
  const este = ymdValido(anio, mes, dia);
  if (!este) return null;
  if (este >= hoy) return este;
  return ymdValido(anio + 1, mes, dia);
}

function hm(h: number, min: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function aplicarFranja(h: number, min: number, textoHora: string): string | null {
  const tarde = /\btarde\b/.test(textoHora);
  const noche = /\bnoche\b/.test(textoHora);
  let hora = h;
  if (noche && hora === 12) hora = 0;
  else if ((tarde || noche) && hora >= 1 && hora <= 11) hora += 12;
  return hm(hora, min);
}

/** Hora local de Europe/Madrid, en HH:MM. No se convierte a UTC: la agenda guarda el texto. */
export function parseHoraCita(raw: string): string | null {
  const s = sinAcentos(raw.trim().toLowerCase()).replace(/\s+/g, ' ');
  if (!s) return null;
  if (s === 'mediodia' || s === 'medio dia') return '12:00';
  if (s === 'medianoche' || s === 'media noche') return '00:00';

  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return hm(Number(m[1]), Number(m[2]));

  m = s.match(/^(\d{1,2})\s*h(?:\s*(\d{2}))?$/);
  if (m) return hm(Number(m[1]), m[2] != null ? Number(m[2]) : 0);

  m = s.match(/^(?:a las )?(\d{1,2})(?:(?::|h)(\d{2}))? y (media|cuarto)$/);
  if (m) {
    const extra = m[3] === 'media' ? 30 : 15;
    const base = m[2] != null ? Number(m[2]) : 0;
    return aplicarFranja(Number(m[1]), base + extra, s);
  }

  m = s.match(/^(?:a las )?(\d{1,2})(?:(?::|h)(\d{2}))?(?: de la (?:manana|tarde|noche))?$/);
  if (m) return aplicarFranja(Number(m[1]), m[2] != null ? Number(m[2]) : 0, s);

  return null;
}

export function horaAMinutos(hmTexto: string): number | null {
  const parsed = parseHoraCita(hmTexto);
  if (!parsed) return null;
  const [h, m] = parsed.split(':').map(Number);
  return h * 60 + m;
}

function minutosAHora(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatearCuando(fecha: string, hora: string | null, horaFin: string | null): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toLocaleDateString('es-ES', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (hora && horaFin) return `${dia}, de ${hora} a ${horaFin}`;
  if (hora) return `${dia} a las ${hora}`;
  return dia;
}

function offsetMadridMinutos(instante: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MADRID,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const n = (tipo: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === tipo)?.value);
  let hora = n('hour');
  let dia = n('day');
  if (hora === 24) {
    hora = 0;
    dia += 1;
  }
  const comoUtc = Date.UTC(n('year'), n('month') - 1, dia, hora, n('minute'), n('second'));
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/** Instante local de Madrid en ISO 8601 con desfase, p. ej. 2026-09-24T10:00:00+02:00. */
export function isoMadrid(fecha: string, hora: string): string {
  const [y, mo, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const paredComoUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let offset = offsetMadridMinutos(new Date(paredComoUtc));
  const offsetReal = offsetMadridMinutos(new Date(paredComoUtc - offset * 60_000));
  if (offsetReal !== offset) offset = offsetReal;
  const signo = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${fecha}T${hora}:00${signo}${oh}:${om}`;
}

function finCalculado(
  fecha: string,
  hora: string,
  horaFin: string | null
): { fecha: string; hora: string; minutos: number } {
  const inicio = horaAMinutos(hora)!;
  if (horaFin) {
    return { fecha, hora: horaFin, minutos: horaAMinutos(horaFin)! - inicio };
  }
  const total = inicio + DURACION_DEFECTO_MIN;
  const dias = Math.floor(total / (24 * 60));
  return {
    fecha: sumarDias(fecha, dias),
    hora: minutosAHora(total % (24 * 60)),
    minutos: DURACION_DEFECTO_MIN,
  };
}

function notasLimpias(description: string | null | undefined): string {
  if (!description) return '';
  return description
    .split('\n')
    .filter((linea) => !/^Hora de fin:\s*\d{2}:\d{2}\s*$/.test(linea.trim()))
    .join('\n')
    .trim();
}

function citaGuardada(input: {
  id: string;
  titulo: string;
  fecha: string;
  hora: string;
  horaFin: string | null;
  lugar: string | null;
  notas: string;
  duplicado?: true;
  mensaje?: string;
}): CitaGuardada {
  const fin = finCalculado(input.fecha, input.hora, input.horaFin);
  const startsAt = isoMadrid(input.fecha, input.hora);
  const endsAt = isoMadrid(fin.fecha, fin.hora);
  const hint: GoogleCalendarHint = {
    summary: input.titulo,
    start: startsAt,
    end: endsAt,
    location: input.lugar ?? '',
    description: input.notas,
    reminder_minutes: RECORDATORIO_GOOGLE_MIN,
  };
  return {
    ok: true,
    id: input.id,
    titulo: input.titulo,
    asunto: input.titulo,
    cuando: formatearCuando(input.fecha, input.hora, input.horaFin),
    fecha: input.fecha,
    hora: input.hora,
    hora_fin: input.horaFin,
    starts_at: startsAt,
    ends_at: endsAt,
    duracion_minutos: fin.minutos,
    time_zone: TZ_MADRID,
    lugar: input.lugar,
    notas: input.notas,
    obra_id: null,
    google_calendar_hint: hint,
    ...(input.duplicado ? { duplicado: true as const, mensaje: input.mensaje } : {}),
  };
}

function horaFinEnDescripcion(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/Hora de fin:\s*(\d{2}:\d{2})/);
  return m?.[1] ?? null;
}

function descripcionCita(notas: string, horaFin: string | null): string {
  const partes: string[] = [];
  if (notas) partes.push(notas);
  if (horaFin) partes.push(`Hora de fin: ${horaFin}`);
  return partes.join('\n');
}

function normTitulo(s: string): string {
  return sinAcentos(s.trim().toLowerCase()).replace(/\s+/g, ' ');
}

function intervalosSolapan(
  a: { inicio: number; fin: number },
  b: { inicio: number; fin: number }
): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

function huecoLibre(
  inicio: number,
  duracion: number,
  ocupados: Array<{ inicio: number; fin: number }>
): string | null {
  let mejor: { dist: number; hora: string } | null = null;
  for (let start = VENTANA_INICIO_MIN; start + duracion <= VENTANA_FIN_MIN; start += 15) {
    const probe = { inicio: start, fin: start + duracion };
    if (ocupados.some((o) => intervalosSolapan(probe, o))) continue;
    const dist = Math.abs(start - inicio);
    if (!mejor || dist < mejor.dist) mejor = { dist, hora: minutosAHora(start) };
  }
  return mejor?.hora ?? null;
}

function limiteLista(raw: unknown): number {
  if (raw == null || raw === '') return 10;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 10;
  return Math.min(20, Math.max(1, Math.round(n)));
}

export async function crearCitaAgenda(
  ctx: McpContext,
  toolArgs: Record<string, unknown>,
  now: Date = new Date()
): Promise<CitaGuardada | { error: string; solapamiento?: true; hueco_sugerido?: string | null }> {
  const titulo = texto(toolArgs.asunto ?? toolArgs.titulo, 300);
  if (!titulo) return { error: 'El asunto es obligatorio.' };

  const fechaRaw = texto(toolArgs.fecha, 80);
  if (!fechaRaw) return { error: 'La fecha es obligatoria.' };
  const fecha = parseFechaCita(fechaRaw, now);
  if (!fecha) {
    return {
      error:
        'La fecha no es válida. Usa AAAA-MM-DD, o un día como hoy, mañana, viernes o 24 de septiembre.',
    };
  }

  const horaRaw = texto(toolArgs.hora_inicio ?? toolArgs.hora, 80);
  if (!horaRaw) return { error: 'La hora de inicio es obligatoria.' };
  const hora = parseHoraCita(horaRaw);
  if (!hora) {
    return { error: 'La hora de inicio no es válida. Usa HH:MM, por ejemplo 10:00.' };
  }

  const finRaw = texto(toolArgs.hora_fin, 80);
  let horaFin: string | null = null;
  if (finRaw) {
    horaFin = parseHoraCita(finRaw);
    if (!horaFin) {
      return { error: 'La hora de fin no es válida. Usa HH:MM, por ejemplo 11:30.' };
    }
    if (horaAMinutos(horaFin)! <= horaAMinutos(hora)!) {
      return { error: 'La hora de fin tiene que ser posterior a la de inicio.' };
    }
  }

  const lugar = texto(toolArgs.lugar ?? toolArgs.ubicacion, 500);
  const notas = texto(toolArgs.notas, 2000);
  const inicioMin = horaAMinutos(hora)!;
  const duracion = horaFin ? horaAMinutos(horaFin)! - inicioMin : DURACION_DEFECTO_MIN;

  const { data: mismoDia, error: errDia } = await ctx.supabase
    .from('agenda')
    .select('id, titulo, hora, description, location')
    .eq('business_id', ctx.businessId)
    .eq('fecha', fecha);

  if (errDia) return { error: errDia.message };

  const filas = (mismoDia ?? []) as AgendaOcupada[];
  const tituloNorm = normTitulo(titulo);
  const ya = filas.find((row) => {
    const horaRow = row.hora ? parseHoraCita(String(row.hora)) : null;
    return normTitulo(String(row.titulo ?? '')) === tituloNorm && horaRow === hora;
  });
  if (ya?.id) {
    const finYa = horaFinEnDescripcion(ya.description) ?? horaFin;
    const lugarYa = String(ya.location ?? '').trim() || lugar || null;
    const notasYa = notasLimpias(ya.description) || notas;
    const tituloYa = String(ya.titulo ?? '').trim() || titulo;
    return citaGuardada({
      id: ya.id,
      titulo: tituloYa,
      fecha,
      hora,
      horaFin: finYa,
      lugar: lugarYa,
      notas: notasYa,
      duplicado: true,
      mensaje: 'Esa cita ya estaba en la agenda.',
    });
  }

  const ocupados: Array<{ inicio: number; fin: number }> = [];
  for (const row of filas) {
    const ini = row.hora ? horaAMinutos(String(row.hora)) : null;
    if (ini == null) continue;
    const finGuardada = horaFinEnDescripcion(row.description);
    const finMin = finGuardada ? horaAMinutos(finGuardada) : null;
    const fin = finMin != null && finMin > ini ? finMin : ini + DURACION_DEFECTO_MIN;
    ocupados.push({ inicio: ini, fin });
  }

  const nuevo = { inicio: inicioMin, fin: inicioMin + duracion };
  if (ocupados.some((o) => intervalosSolapan(nuevo, o))) {
    const hueco = huecoLibre(inicioMin, duracion, ocupados);
    return {
      error: hueco
        ? `Esa franja ya está ocupada. El hueco libre más cercano es a las ${hueco}.`
        : 'Esa franja ya está ocupada y no queda hueco libre entre las 8:00 y las 20:00.',
      solapamiento: true,
      hueco_sugerido: hueco,
    };
  }

  const { data: row, error } = await ctx.supabase
    .from('agenda')
    .insert({
      business_id: ctx.businessId,
      titulo,
      fecha,
      hora,
      completado: false,
      description: descripcionCita(notas, horaFin),
      location: lugar || null,
      minutos_antelacion: 0,
    })
    .select('id, titulo, fecha, hora')
    .single();

  if (error || !row?.id) {
    return { error: error?.message ?? 'No se pudo crear la cita.' };
  }

  return citaGuardada({
    id: row.id as string,
    titulo: String(row.titulo ?? titulo),
    fecha: String(row.fecha ?? fecha).slice(0, 10),
    hora: parseHoraCita(String(row.hora ?? hora)) ?? hora,
    horaFin,
    lugar: lugar || null,
    notas,
  });
}

export async function listarCitasAgenda(
  ctx: McpContext,
  toolArgs: Record<string, unknown>,
  now: Date = new Date()
): Promise<
  | {
      items: Array<{
        id: string;
        titulo: string;
        cuando: string;
        fecha: string;
        hora: string | null;
        hora_fin: string | null;
        lugar: string | null;
      }>;
      desde: string;
      hasta: string | null;
    }
  | { error: string }
> {
  const hoy = ymdEnMadrid(now);
  const desdeRaw = texto(toolArgs.desde, 80);
  const hastaRaw = texto(toolArgs.hasta, 80);
  const desde = desdeRaw ? parseFechaCita(desdeRaw, now) : hoy;
  if (!desde) {
    return { error: 'La fecha «desde» no es válida. Usa AAAA-MM-DD o un día como hoy o mañana.' };
  }
  const hasta = hastaRaw ? parseFechaCita(hastaRaw, now) : null;
  if (hastaRaw && !hasta) {
    return { error: 'La fecha «hasta» no es válida. Usa AAAA-MM-DD o un día como hoy o mañana.' };
  }
  if (hasta && hasta < desde) {
    return { error: 'La fecha final es anterior a la inicial.' };
  }

  const limite = limiteLista(toolArgs.limite);
  let query = ctx.supabase
    .from('agenda')
    .select('id, titulo, fecha, hora, location, description')
    .eq('business_id', ctx.businessId)
    .eq('completado', false)
    .gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true, nullsFirst: false })
    .limit(limite);
  if (error) return { error: error.message };

  const items = ((data ?? []) as Array<{
    id: string;
    titulo: string | null;
    fecha: string | null;
    hora: string | null;
    location: string | null;
    description: string | null;
  }>).map((row) => {
    const fecha = String(row.fecha ?? '').slice(0, 10);
    const hora = row.hora ? parseHoraCita(String(row.hora)) ?? String(row.hora).trim() : null;
    const horaFin = horaFinEnDescripcion(row.description);
    const lugar = String(row.location ?? '').trim() || null;
    return {
      id: row.id,
      titulo: String(row.titulo ?? '').trim() || 'Cita',
      fecha,
      hora,
      hora_fin: horaFin,
      lugar,
      cuando: formatearCuando(fecha, hora, horaFin),
    };
  });

  return { items, desde, hasta };
}
