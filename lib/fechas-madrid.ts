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

const NOMBRE_DIA: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/** Día de la semana (0 = domingo) de una fecha civil YYYY-MM-DD. */
export function diaSemanaDeYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Fecha que el USUARIO dijo en su mensaje («hoy», «mañana», «pasado mañana», «el lunes», «el jueves que viene»),
 * calculada en hora de Madrid. El servidor la usa para mandar sobre la que escriba el modelo (que fallaba con
 * los días de la semana: «el lunes» acababa siendo un sábado).
 *
 * - «el lunes»: el próximo lunes contando hoy. «el lunes que viene» / «próximo lunes»: estrictamente después de hoy.
 * - Si el mensaje menciona varias fechas distintas: `crear` no decide (null); `mover` coge la ÚLTIMA («pasa lo del
 *   lunes al viernes» → viernes).
 */
export function fechaDichaEnMensaje(
  mensaje: string,
  ahora: Date = new Date(),
  modo: 'crear' | 'mover' = 'crear'
): string | null {
  const t = sinTildes(String(mensaje ?? '')).replace(/[¿?¡!.,;:]/g, ' ');
  if (!t.trim()) return null;
  const hoy = ymdHoyMadrid(ahora);
  const hoyDow = diaSemanaDeYmd(hoy);
  const encontradas: Array<{ pos: number; ymd: string }> = [];

  for (const m of t.matchAll(/\bpasado manana\b/g)) encontradas.push({ pos: m.index ?? 0, ymd: sumarDiasYmd(hoy, 2) });
  for (const m of t.matchAll(/\bmanana\b/g)) {
    const antes = t.slice(Math.max(0, (m.index ?? 0) - 7), m.index ?? 0);
    if (/pasado\s$/.test(antes)) continue; // ya contado como «pasado mañana»
    // «por la mañana» / «de la mañana» es la franja horaria, no el día siguiente.
    if (/\b(?:por|de|en|a)\s+la\s*$/.test(t.slice(0, m.index ?? 0))) continue;
    encontradas.push({ pos: m.index ?? 0, ymd: sumarDiasYmd(hoy, 1) });
  }
  for (const m of t.matchAll(/\bhoy\b/g)) encontradas.push({ pos: m.index ?? 0, ymd: hoy });
  for (const m of t.matchAll(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(\s+que viene|\s+de la semana que viene|\s+proximo)?/g)) {
    const dow = NOMBRE_DIA[m[1]]!;
    const previo = t.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    const estrictamenteDespues = Boolean(m[2]) || /\b(proximo|siguiente)\s+$/.test(previo);
    let add = (dow - hoyDow + 7) % 7; // 0 = hoy
    if (estrictamenteDespues && add === 0) add = 7;
    if (m[2] && /semana que viene/.test(m[2])) {
      // «el jueves de la semana que viene»: el jueves de la semana siguiente (de lunes a domingo).
      const hastaLunes = (8 - hoyDow) % 7 || 7;
      add = hastaLunes + ((dow + 6) % 7);
    }
    encontradas.push({ pos: m.index ?? 0, ymd: sumarDiasYmd(hoy, add) });
  }
  if (encontradas.length === 0) return null;
  encontradas.sort((a, b) => a.pos - b.pos);
  const distintas = new Set(encontradas.map((e) => e.ymd));
  if (distintas.size > 1 && modo === 'crear') return null;
  return encontradas[encontradas.length - 1]!.ymd;
}
