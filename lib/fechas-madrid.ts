/**
 * Fechas «de calendario» del negocio: siempre hora de Madrid, nunca UTC.
 * Entre las 00:00 y las 02:00 (hora de Madrid) `new Date().toISOString()` todavía dice «ayer»; por eso
 * todo lo que guarda o enseña una fecha «de hoy» pasa por aquí.
 */
import { formatYmdInTimeZone } from '@/lib/albaranes-sin-facturar';

export { formatYmdInTimeZone };

export const ZONA_NEGOCIO = 'Europe/Madrid';

/** YYYY-MM-DD de hoy en Madrid (`ahora` se puede inyectar en los tests). */
export function ymdHoyMadrid(ahora: Date = new Date()): string {
  return formatYmdInTimeZone(ahora, ZONA_NEGOCIO);
}

/** Suma días a una fecha civil YYYY-MM-DD. */
export function sumarDiasYmd(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Fecha en Madrid de un timestamp guardado (p. ej. `created_at` en UTC). */
export function ymdMadridDeTimestamp(ts: string | Date | null | undefined): string | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return formatYmdInTimeZone(d, ZONA_NEGOCIO);
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Entiende fechas dichas «de obra» y devuelve YYYY-MM-DD en hora de Madrid, siempre en el PASADO o HOY
 * (un diario no se escribe por adelantado): «ayer», «anteayer», «hoy», «el lunes» (el último lunes, o hoy
 * si hoy es lunes), «el 3» (el día 3 del mes en curso; si aún no ha llegado, el del mes pasado),
 * «3 de octubre», «2026-10-03» y «03/10».
 * Devuelve `{ ok:false }` si no se entiende o si es futura.
 */
export function parseFechaNatural(
  raw: unknown,
  ahora: Date = new Date()
): { ok: true; ymd: string } | { ok: false; error: string } {
  const hoy = ymdHoyMadrid(ahora);
  const s = sinTildes(String(raw ?? ''));
  if (!s) return { ok: false, error: 'Falta la fecha.' };

  const devolver = (ymd: string) =>
    ymd > hoy
      ? ({ ok: false, error: `No puedo apuntar en el diario una fecha futura (${ymd}). Hoy es ${hoy}.` } as const)
      : ({ ok: true, ymd } as const);
  const valida = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  };
  const pad = (n: number) => String(n).padStart(2, '0');

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valida(+m[1], +m[2], +m[3]) ? devolver(s) : { ok: false, error: `La fecha ${s} no existe.` };

  if (/^(hoy)$/.test(s)) return { ok: true, ymd: hoy };
  if (/^(ayer)$/.test(s)) return { ok: true, ymd: sumarDiasYmd(hoy, -1) };
  if (/^(anteayer|antes de ayer|antier)$/.test(s)) return { ok: true, ymd: sumarDiasYmd(hoy, -2) };

  m = s.match(/^(?:el\s+)?(?:pasado\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/);
  if (m) {
    const objetivo = DIAS_SEMANA.indexOf(m[1]);
    const [y, mo, d] = hoy.split('-').map(Number);
    const hoyDow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const atras = (hoyDow - objetivo + 7) % 7; // 0 = hoy
    return { ok: true, ymd: sumarDiasYmd(hoy, -atras) };
  }

  m = s.match(/^(?:el\s+(?:dia\s+)?|dia\s+)?(\d{1,2})$/);
  if (m) {
    const dia = +m[1];
    const [y, mo] = hoy.split('-').map(Number);
    const cand = (yy: number, mm: number) => (valida(yy, mm, dia) ? `${yy}-${pad(mm)}-${pad(dia)}` : null);
    const esteMes = cand(y, mo);
    if (esteMes && esteMes <= hoy) return { ok: true, ymd: esteMes };
    const mesAnt = mo === 1 ? cand(y - 1, 12) : cand(y, mo - 1);
    return mesAnt ? { ok: true, ymd: mesAnt } : { ok: false, error: `No entiendo la fecha «${raw}».` };
  }

  m = s.match(/^(?:el\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/);
  if (m && MESES.includes(m[2])) {
    const mes = MESES.indexOf(m[2]) + 1;
    const [yHoy] = hoy.split('-').map(Number);
    let año = m[3] ? +m[3] : yHoy;
    if (!valida(año, mes, +m[1])) return { ok: false, error: `La fecha «${raw}» no existe.` };
    let ymd = `${año}-${pad(mes)}-${pad(+m[1])}`;
    if (!m[3] && ymd > hoy) {
      año -= 1;
      ymd = `${año}-${pad(mes)}-${pad(+m[1])}`;
    }
    return devolver(ymd);
  }

  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (m) {
    const [yHoy] = hoy.split('-').map(Number);
    let año = m[3] ? +m[3] : yHoy;
    if (!valida(año, +m[2], +m[1])) return { ok: false, error: `La fecha «${raw}» no existe.` };
    let ymd = `${año}-${pad(+m[2])}-${pad(+m[1])}`;
    if (!m[3] && ymd > hoy) {
      año -= 1;
      ymd = `${año}-${pad(+m[2])}-${pad(+m[1])}`;
    }
    return devolver(ymd);
  }

  return { ok: false, error: `No entiendo la fecha «${raw}». Dímela como «ayer», «el lunes», «el 3» o 2026-10-03.` };
}
