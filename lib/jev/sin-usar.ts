import { horasEnTexto, numerosDelMensaje } from '@/lib/jev/fechas';

/** Datos del mensaje (cifras) que ninguna orden ha recogido, con un trocito del mensaje para que se entienda. null si no sobra nada. */
export function datosSinUsar(mensaje: string, ordenes: Array<Record<string, unknown>>): string | null {
  const d = datoSinUsarDetalle(mensaje, ordenes);
  return d ? d.trozo : null;
}

/** Igual, con la posición de la cifra en el mensaje (para sacar la cláusula a la que pertenece). */
export function datoSinUsarDetalle(mensaje: string, ordenes: Array<Record<string, unknown>>): { trozo: string; indice: number } | null {
  const quitaPorcentajes = (t: string) => t.replace(/\d+(?:[.,]\d+)?\s?%/g, ' ');
  const usados = new Set<number>();
  const recoge = (v: unknown): void => {
    if (typeof v === 'string') for (const n of [...numerosDelMensaje(quitaPorcentajes(v)), ...horasEnTexto(v)]) usados.add(Math.round(n * 100) / 100);
    else if (Array.isArray(v)) v.forEach(recoge);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(recoge);
  };
  ordenes.forEach(recoge);
  const texto = quitaPorcentajes(mensaje);
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = numerosDelMensaje(m[0])[0];
    if (n == null || usados.has(Math.round(n * 100) / 100)) continue;
    const ini = Math.max(0, (m.index ?? 0) - 25);
    return { trozo: texto.slice(ini, (m.index ?? 0) + m[0].length + 25).replace(/\s+/g, ' ').trim(), indice: m.index ?? 0 };
  }
  return null;
}

/**
 * La cláusula del mensaje que contiene la posición `indice` («...y de paso ponle 6 horas a Jon en lo de Paqui»). Corta en comas,
 * punto y coma, dos puntos y en «y» que une dos peticiones (no en «7 y media», «y cuarto» ni «y 30»).
 */
export function clausulaEn(mensaje: string, indice: number): string {
  const corte = /\s*(?:[,;:.]|\by\b(?!\s+(?:media|medio|cuarto|tres cuartos|\d)))\s*/g;
  let ini = 0;
  for (const m of mensaje.matchAll(corte)) {
    const fin = m.index ?? 0;
    if (indice < fin) return mensaje.slice(ini, fin).trim();
    ini = fin + m[0].length;
  }
  return mensaje.slice(ini).trim();
}
