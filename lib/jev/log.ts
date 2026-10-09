/**
 * Registro de lo que RECHAZA o no entiende el traductor .jev (sale en los logs de Vercel con `console.warn`).
 * Se guarda la forma de la orden del modelo, nunca datos sensibles: emails, teléfonos, NIF e importes largos
 * se enmascaran y los textos se recortan.
 */

const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_NIF = /\b[XYZ]?\d{7,8}[A-Z]\b/gi;
const RE_DIGITOS = /\d(?:[\s.-]?\d){6,}/g;

export function enmascarar(s: string): string {
  return s.replace(RE_EMAIL, '<email>').replace(RE_NIF, '<nif>').replace(RE_DIGITOS, '<num>').slice(0, 80);
}

/** Copia segura de un valor del modelo para el log (claves intactas, valores recortados y enmascarados). */
export function seguro(v: unknown, prof = 0): unknown {
  if (typeof v === 'string') return enmascarar(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return v;
  if (prof > 3) return '…';
  if (Array.isArray(v)) return v.slice(0, 6).map((x) => seguro(x, prof + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, seguro(x, prof + 1)]));
  return String(typeof v);
}

export type EventoJev = 'incoherencia' | 'datos_sin_usar' | 'traduccion_incompleta' | 'troceo_invalido' | 'si_sin_confirmacion' | 'orden_incompleta' | 'campo_descartado' | 'aclarar' | 'accion_desconocida' | 'salida_ilegible' | 'api_esquema_rechazado' | 'api_error';

export function logJev(evento: EventoJev, datos: Record<string, unknown>): void {
  try {
    console.warn(`[jev] ${evento} ${JSON.stringify(seguro(datos))}`);
  } catch {
    /* un log nunca rompe el chat */
  }
}
