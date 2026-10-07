/**
 * Fechas, horas e importes que el usuario dijo con sus palabras (los «slots» de una orden .jev) → valores
 * exactos. Todo determinista y en hora de Madrid (`lib/fechas-madrid.ts`): el modelo nunca decide una fecha.
 */
import { fechaDichaEnMensaje, parseFechaNatural, sumarDiasYmd, ymdHoyMadrid, diaSemanaDeYmd } from '@/lib/fechas-madrid';
import { numerosDelDictado } from '@/lib/dictado-presupuesto';
import { letrasACifras, numerosEnLetras } from '@/lib/numeros-letras';

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const pad = (n: number) => String(n).padStart(2, '0');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export type FechaResuelta = { ok: true; ymd: string } | { ok: false; error: string };

/** Fecha de una cita o recordatorio (hoy o futura). «el lunes» = próximo lunes; «al jueves» = relativo a hoy. */
export function resolverFechaFutura(texto: string | null | undefined, ahora: Date = new Date(), opciones: { permitirPasado?: boolean } = {}): FechaResuelta {
  const raw = String(texto ?? '').trim();
  if (!raw) return { ok: false, error: '¿Para qué día?' };
  const hoy = ymdHoyMadrid(ahora);
  const t = sinTildes(raw);

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1) return { ok: false, error: `La fecha «${raw}» no existe.` };
    return m[0] < hoy && !opciones.permitirPasado ? { ok: false, error: `${raw} ya pasó (hoy es ${hoy}).` } : { ok: true, ymd: m[0] };
  }
  m = t.match(/^(?:el\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/);
  if (m && MESES.includes(m[2]!)) {
    const mes = MESES.indexOf(m[2]!) + 1;
    const [yHoy] = hoy.split('-').map(Number);
    let año = m[3] ? +m[3] : yHoy!;
    let ymd = `${año}-${pad(mes)}-${pad(+m[1]!)}`;
    if (!m[3] && ymd < hoy) {
      año += 1;
      ymd = `${año}-${pad(mes)}-${pad(+m[1]!)}`;
    }
    const d = new Date(Date.UTC(año, mes - 1, +m[1]!));
    if (d.getUTCMonth() !== mes - 1) return { ok: false, error: `La fecha «${raw}» no existe.` };
    return { ok: true, ymd };
  }
  m = t.match(/^(?:el\s+)?(?:dia\s+)?(\d{1,2})$/);
  if (m) {
    const dia = +m[1]!;
    const [y, mo] = hoy.split('-').map(Number);
    for (let k = 0; k < 14; k++) {
      const yy = y! + Math.floor((mo! - 1 + k) / 12);
      const mm = ((mo! - 1 + k) % 12) + 1;
      const d = new Date(Date.UTC(yy, mm - 1, dia));
      if (d.getUTCMonth() !== mm - 1) continue;
      const ymd = `${yy}-${pad(mm)}-${pad(dia)}`;
      if (ymd >= hoy) return { ok: true, ymd };
    }
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (m) {
    const [yHoy] = hoy.split('-').map(Number);
    let año = m[3] ? +m[3] : yHoy!;
    let ymd = `${año}-${pad(+m[2]!)}-${pad(+m[1]!)}`;
    if (!m[3] && ymd < hoy) {
      año += 1;
      ymd = `${año}-${pad(+m[2]!)}-${pad(+m[1]!)}`;
    }
    return { ok: true, ymd };
  }
  // «el lunes», «al jueves», «mañana», «el lunes que viene», «pasado mañana», «hoy».
  const dicha = fechaDichaEnMensaje(t.replace(/^a(l)?\s+/, 'el '), ahora, 'mover');
  if (dicha) return { ok: true, ymd: dicha };
  return { ok: false, error: `No entiendo el día «${raw}». Dímelo como «el lunes», «mañana», «el 15» o 2026-10-15.` };
}

/** Fecha de algo que YA pasó (diario, horas): «ayer», «el lunes» (el último), «el 3». No admite futuro. */
export function resolverFechaPasada(texto: string | null | undefined, ahora: Date = new Date()): FechaResuelta {
  const raw = String(texto ?? '').trim();
  if (!raw) return { ok: true, ymd: ymdHoyMadrid(ahora) };
  const r = parseFechaNatural(raw.replace(/^(?:del|de|el)\s+d[ií]a\s+/i, 'el '), ahora);
  return r.ok ? r : { ok: false, error: r.error };
}

/** Hora dicha («10:30», «10 y media», «las 5 de la tarde», «17h») → HH:MM. */
export function resolverHoraTexto(texto: string | null | undefined): { ok: true; hora: string } | { ok: false; error: string } {
  const raw = String(texto ?? '').trim();
  if (!raw) return { ok: false, error: '¿A qué hora?' };
  const t = sinTildes(raw).replace(/^a\s+las?\s+|^las?\s+/, '');
  let m = t.match(/^(\d{1,2})[:.h](\d{2})$/);
  let h: number;
  let min = 0;
  if (m) {
    h = +m[1]!;
    min = +m[2]!;
  } else {
    m = t.match(/^(\d{1,2})\s*(?:h|horas?)?\s*(?:(y media|y cuarto|menos cuarto|y (\d{1,2})|en punto))?\s*(?:de la (manana|tarde|noche)|am|pm)?$/);
    if (!m) return { ok: false, error: `No entiendo la hora «${raw}».` };
    h = +m[1]!;
    const extra = m[2] ?? '';
    if (extra === 'y media') min = 30;
    else if (extra === 'y cuarto') min = 15;
    else if (extra === 'menos cuarto') {
      h -= 1;
      min = 45;
    } else if (m[3]) min = +m[3];
    const franja = m[4] ?? (/pm$/.test(t) ? 'tarde' : /am$/.test(t) ? 'manana' : '');
    if (franja === 'tarde' || franja === 'noche') {
      if (h < 12) h += 12;
    } else if (!franja && h >= 1 && h <= 7) {
      h += 12; // «a las 5» en obra = las 17:00
    }
  }
  if (h < 0 || h > 23 || min < 0 || min > 59) return { ok: false, error: `La hora «${raw}» no es válida.` };
  return { ok: true, hora: `${pad(h)}:${pad(min)}` };
}

export type RangoFechas = { desde: string; hasta: string; etiqueta: string };

/** «hoy», «mañana», «esta semana», «la que viene», «esta semana y la que viene», «este mes», un día suelto. */
export function resolverRangoTexto(texto: string | null | undefined, ahora: Date = new Date()): { ok: true; rango: RangoFechas } | { ok: false; error: string } {
  const hoy = ymdHoyMadrid(ahora);
  const t = sinTildes(String(texto ?? '')) || 'hoy';
  const lunesDe = (ymd: string) => sumarDiasYmd(ymd, -((diaSemanaDeYmd(ymd) + 6) % 7));
  const lunes = lunesDe(hoy);
  const estaSemana = t.match(/\b(esta semana|semana actual)\b/);
  const proxima = t.match(/\b(la que viene|semana que viene|proxima semana|siguiente semana)\b/);
  if (estaSemana && proxima) return { ok: true, rango: { desde: lunes, hasta: sumarDiasYmd(lunes, 13), etiqueta: 'esta semana y la que viene' } };
  if (proxima) return { ok: true, rango: { desde: sumarDiasYmd(lunes, 7), hasta: sumarDiasYmd(lunes, 13), etiqueta: 'la semana que viene' } };
  if (estaSemana) return { ok: true, rango: { desde: lunes, hasta: sumarDiasYmd(lunes, 6), etiqueta: 'esta semana' } };
  if (/\b(este mes|mes actual)\b/.test(t)) {
    const [y, m] = hoy.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return { ok: true, rango: { desde: `${y}-${pad(m!)}-01`, hasta: `${y}-${pad(m!)}-${pad(ultimo)}`, etiqueta: 'este mes' } };
  }
  const prox = t.match(/\b(?:proximos|siguientes)\s+(\d{1,2})\s+dias\b/);
  if (prox) return { ok: true, rango: { desde: hoy, hasta: sumarDiasYmd(hoy, Math.min(31, +prox[1]!) - 1), etiqueta: `los próximos ${prox[1]} días` } };
  const f = resolverFechaFutura(t, ahora);
  if (f.ok) return { ok: true, rango: { desde: f.ymd, hasta: f.ymd, etiqueta: f.ymd === hoy ? 'hoy' : f.ymd } };
  return { ok: false, error: f.error };
}

// ───────────────────────────── Importes ─────────────────────────────

/** Números que dijo el usuario, con cifras («180») o con letras («dos», «treinta y cinco»). */
export function numerosDelMensaje(texto: string): number[] {
  return [...numerosDelDictado(String(texto ?? '')), ...numerosEnLetras(String(texto ?? ''))];
}

/** «180», «1.250,50», «dos», «180 euros» → número. null si no hay un importe claro. */
export function parseImporteTexto(texto: string | null | undefined): number | null {
  const n = numerosDelMensaje(String(texto ?? ''));
  return n.length === 1 ? n[0]! : null;
}

/** ¿Este número lo dijo el usuario en alguno de sus mensajes? (Un importe que no está en el texto se rechaza.) */
export function importeApareceEnTexto(valor: number, mensajes: string[]): boolean {
  const dichos = new Set(numerosDelMensaje(mensajes.join(' \n ')).map((n) => Math.round(n * 100) / 100));
  return dichos.has(Math.round(valor * 100) / 100);
}

// ───────────────────────────── Horas ─────────────────────────────

const redondea = (n: number) => Math.round(n * 100) / 100;

/** Horas trabajadas dichas de las formas habituales: «7», «7,5», «7 y media», «7 y cuarto», «8 menos cuarto», «7:30», «7h30», «media hora». */
export function horasEnTexto(texto: string): number[] {
  const t = letrasACifras(sinTildes(String(texto ?? ''))).replace(/\s+/g, ' ');
  const out: number[] = [];
  const usados: Array<[number, number]> = [];
  const tomar = (re: RegExp, f: (m: RegExpMatchArray) => number) => {
    for (const m of t.matchAll(re)) {
      const ini = m.index ?? 0;
      if (usados.some(([a, b]) => ini < b && ini + m[0].length > a)) continue;
      out.push(redondea(f(m)));
      usados.push([ini, ini + m[0].length]);
    }
  };
  tomar(/\b(\d{1,2})\s*(?:h|horas?)?\s*y\s*media\b/g, (m) => +m[1]! + 0.5);
  tomar(/\b(\d{1,2})\s*(?:h|horas?)?\s*y\s*cuarto\b/g, (m) => +m[1]! + 0.25);
  tomar(/\b(\d{1,2})\s*(?:h|horas?)?\s*y\s*(?:tres cuartos|3 cuartos)\b/g, (m) => +m[1]! + 0.75);
  tomar(/\b(\d{1,2})\s*(?:h|horas?)?\s*menos\s*cuarto\b/g, (m) => +m[1]! - 0.25);
  tomar(/\b(\d{1,2})\s*(?:[:h]|h\s)\s*(\d{2})\b/g, (m) => +m[1]! + +m[2]! / 60);
  tomar(/\b(?:una|un|1)\s+hora\s+y\s+media\b/g, () => 1.5);
  tomar(/\bmedia\s+hora\b/g, () => 0.5);
  tomar(/\b(?:una|un)\s+hora\b/g, () => 1);
  // El resto de números sueltos («7», «7,5»), si no son parte de una de las formas de arriba.
  let resto = t;
  for (const [a, b] of [...usados].sort((x, y) => y[0] - x[0])) resto = resto.slice(0, a) + ' '.repeat(b - a) + resto.slice(b);
  out.push(...numerosDelDictado(resto).map(redondea));
  return out;
}

/** Horas de un slot («7 y media») → número. null si no hay una cifra de horas clara. */
export function parseHorasTexto(texto: string | null | undefined): number | null {
  const n = horasEnTexto(String(texto ?? ''));
  return n.length === 1 ? n[0]! : null;
}

/** ¿El usuario dijo estas horas en alguno de sus mensajes? */
export function horasApareceEnTexto(valor: number, mensajes: string[]): boolean {
  const dichas = new Set(horasEnTexto(mensajes.join(' \n ')));
  return dichas.has(redondea(valor));
}
