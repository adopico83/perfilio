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

/** Timestamp local sin zona (`YYYY-MM-DDTHH:mm:00`) a `offsetDias` de hoy. */
export function demoTimestamp(offsetDias: number, hora = '09:00', now: Date = new Date()): string {
  return `${demoFecha(offsetDias, now)}T${hora}:00`;
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
