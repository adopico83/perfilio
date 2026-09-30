/** Fechas del mock demo: siempre relativas a hoy (Europe/Madrid) para que nunca caduquen. */

const TZ = 'Europe/Madrid';

function partesHoy(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function isoDeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Hoy (Europe/Madrid) como YYYY-MM-DD. */
export function demoHoy(now: Date = new Date()): string {
  return demoFecha(0, now);
}

/** YYYY-MM-DD a `offsetDias` de hoy (Europe/Madrid). */
export function demoFecha(offsetDias: number, now: Date = new Date()): string {
  const { y, m, d } = partesHoy(now);
  return isoDeUtc(Date.UTC(y, m - 1, d + offsetDias));
}

/** Hora actual en Madrid como minutos desde medianoche. */
function minutosAhoraMadrid(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get('hour') * 60 + get('minute');
}

function hhmm(minutos: number): string {
  const m = Math.max(0, minutos);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Timestamp local sin zona (`YYYY-MM-DDTHH:mm:00`) a `offsetDias` de hoy.
 * Nunca queda en el futuro: si cae hoy y la hora aún no ha llegado, se recorta a una hora antes de ahora.
 */
export function demoTimestamp(offsetDias: number, hora = '09:00', now: Date = new Date()): string {
  const fecha = demoFecha(offsetDias, now);
  if (fecha === demoHoy(now)) {
    const [h, m] = hora.split(':').map(Number);
    const ahora = minutosAhoraMadrid(now);
    if (h * 60 + m > ahora) return `${fecha}T${hhmm(ahora - 60)}:00`;
  }
  return `${fecha}T${hora}:00`;
}

/**
 * Timestamp reciente para «lo de hoy» (diario, mensajes): ahora menos `horasAtras`.
 * Si eso cae antes de las 07:00 (muy temprano), pasa a ayer a `horaAyer`.
 */
export function demoTimestampReciente(horasAtras: number, horaAyer = '18:30', now: Date = new Date()): string {
  const minutos = minutosAhoraMadrid(now) - horasAtras * 60;
  if (minutos < 7 * 60) return `${demoFecha(-1, now)}T${horaAyer}:00`;
  return `${demoFecha(0, now)}T${hhmm(minutos)}:00`;
}

/** Como demoFecha, pero un sábado o domingo pasa al lunes siguiente. */
export function demoFechaLaborable(offsetDias: number, now: Date = new Date()): string {
  const iso = demoFecha(offsetDias, now);
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (dow === 6) return demoFecha(offsetDias + 2, now);
  if (dow === 0) return demoFecha(offsetDias + 1, now);
  return iso;
}

/** Mes actual (Europe/Madrid) como YYYY-MM. */
export function demoMesActual(now: Date = new Date()): string {
  return demoHoy(now).slice(0, 7);
}

/** Último día del mes `mes` (YYYY-MM) que el mock puede usar: hoy si es el mes actual; 0 si es futuro. */
export function demoUltimoDiaUsable(mes: string, now: Date = new Date()): number {
  const actual = demoMesActual(now);
  const [y, m] = mes.split('-').map(Number);
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (mes > actual) return 0;
  if (mes === actual) return Number(demoHoy(now).slice(8, 10));
  return diasMes;
}

function esLaborable(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function demoEsFinDeSemana(iso: string): boolean {
  return !esLaborable(iso);
}

/** Los `n` últimos días laborables hasta hoy (inclusive), en orden cronológico. */
export function demoUltimosDiasLaborables(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let off = 0; out.length < n; off--) {
    const iso = demoFecha(off, now);
    if (esLaborable(iso)) out.unshift(iso);
  }
  return out;
}

/** Mínimo de días laborables del mes actual para no completar con el mes anterior. */
export const DEMO_MIN_LABORABLES_MES = 10;

/**
 * Días laborables que pinta la demo para `mes`: los del mes hasta hoy; si es el mes actual y lleva menos de
 * 10 días laborables, los últimos 20 (cruzando al mes anterior) para que Operarios no salga vacío.
 */
export function demoDiasLaborablesVentana(mes: string, now: Date = new Date()): string[] {
  const propios = demoDiasLaborables(mes, now);
  if (mes === demoMesActual(now) && propios.length < DEMO_MIN_LABORABLES_MES) {
    return demoUltimosDiasLaborables(20, now);
  }
  return propios;
}

/** Días laborables (lunes a viernes) de `mes` hasta el último día usable. */
export function demoDiasLaborables(mes: string, now: Date = new Date()): string[] {
  const ultimo = demoUltimoDiaUsable(mes, now);
  const out: string[] = [];
  for (let d = 1; d <= ultimo; d++) {
    const iso = `${mes}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(iso);
  }
  return out;
}

/** Suma `n` días a un YYYY-MM-DD (aritmética de calendario, sin zonas). */
export function demoSumarDias(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDeUtc(Date.UTC(y, m - 1, d + n));
}
