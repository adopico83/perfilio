import { horasEnTexto, numerosDelMensaje } from '@/lib/jev/fechas';

/** Datos del mensaje (cifras) que ninguna orden ha recogido, con un trocito del mensaje para que se entienda. null si no sobra nada. */
export function datosSinUsar(mensaje: string, ordenes: Array<Record<string, unknown>>): string | null {
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
    return texto.slice(ini, (m.index ?? 0) + m[0].length + 25).replace(/\s+/g, ' ').trim();
  }
  return null;
}
