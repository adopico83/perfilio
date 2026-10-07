/**
 * Cómo se lee lo que el usuario dice MIENTRAS hay algo pendiente de confirmar. Reglas generales (no por frase):
 *  - Una afirmación clara («sí», «vale», «hazlo») solo confirma si el último mensaje del asistente fue la pregunta de
 *    confirmación de ESA orden (lleva su marca `<!--orden:ID-->`).
 *  - Un rechazo («no», «mejor no», «no, ese ya lo apunté yo», «déjalo», «olvídalo», «cancela») cancela la pendiente y cierra
 *    la tarea en curso; nunca confirma ni va al modelo como orden nueva.
 *  - Cualquier otra cosa («espera, la encimera ponla a 230») o es una corrección de la pendiente (se fusiona) o es una
 *    orden distinta (la pendiente se cancela): nunca se deja viva una propuesta que el usuario no ha vuelto a mirar.
 */

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:"«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const RE_RECHAZO_SOLO =
  /^(?:no|nop|nope|no gracias|no hace falta|mejor no|no mejor|dejalo|dejalo estar|dejalo asi|olvidalo|olvida|olvidalo todo|olvida eso|cancela|cancelalo|cancelala|cancelar|cancela eso|anula|anulalo|anulala|anular|anula eso|para|para ya|ya no|no lo hagas|no lo apuntes|no lo guardes|no lo registres|no quiero|no ahora|no por ahora|da igual|d(?:e|ejalo) momento no)$/;
/** «no, ese ya lo apunté yo», «ya lo hice»: el usuario dice que no hace falta. */
const RE_YA_HECHO = /\bya (?:lo|la|los|las|le) (?:apunte|apunto|anote|hice|hizo|hecho|puse|meti|registre|tengo|tenia|guarde|cree|creo|pase|pague|cobre|mande|envie)\b|\bya esta (?:hecho|hecha|apuntado|apuntada|anotado|anotada|registrado|registrada)\b|\bese ya\b|\besa ya\b/;
const RE_EMPIEZA_NEGACION = /^(?:no|nop|nope)\b/;
const RE_ABANDONO = /^(?:mejor no|no mejor|dejalo|olvidalo|olvida|cancela(?:lo|la)?|anula(?:lo|la)?)\b/;

/** ¿El usuario está diciendo «no lo hagas» (y nada más que corregir)? */
export function esRechazo(mensaje: string): boolean {
  const t = norm(String(mensaje ?? ''));
  if (!t) return false;
  if (RE_RECHAZO_SOLO.test(t)) return true;
  const conCifras = /\d/.test(t);
  if (RE_YA_HECHO.test(t) && !conCifras) return true;
  if (RE_ABANDONO.test(t) && !conCifras && t.split(' ').length <= 4) return true;
  // «no, mejor no lo apuntes»: empieza por «no» y solo hay relleno de rechazo, sin datos nuevos.
  if (RE_EMPIEZA_NEGACION.test(t) && !conCifras) {
    const resto = t.replace(/^(?:no|nop|nope)\b\s*/, '');
    if (!resto || RE_RECHAZO_SOLO.test(resto) || RE_ABANDONO.test(resto)) return true;
    if (/^(?:lo|la|los|las)?\s*(?:hagas|apuntes|guardes|registres|crees|mandes|envies|quiero|hace falta)\b/.test(resto)) return true;
  }
  return false;
}

const RE_MARCA_ORDEN = /<!--orden:([\w-]+)-->/g;

export const marcaOrden = (id: string) => `\n<!--orden:${id}-->`;

/** Id de la orden cuya confirmación mostró el asistente en su ÚLTIMO mensaje (o null). */
export function ordenIdDelUltimoAsistente(ultimoAsistente: string | undefined | null): string | null {
  const todas = [...String(ultimoAsistente ?? '').matchAll(RE_MARCA_ORDEN)];
  return todas.length ? todas[todas.length - 1]![1]! : null;
}

/** Mensaje corto que parece una RESPUESTA a una pregunta (no una orden nueva con toda su frase). */
export function esRespuestaCorta(mensaje: string, maxPalabras = 8): boolean {
  return norm(String(mensaje ?? '')).split(' ').filter(Boolean).length <= maxPalabras;
}
