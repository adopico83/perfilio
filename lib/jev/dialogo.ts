/**
 * Marcas del diálogo. QUÉ quiere decir el usuario (confirmar, cancelar, corregir…) lo decide el clasificador de intención
 * (lib/jev/intencion.ts), no listas de frases. Aquí solo queda lo mecánico:
 *  - Una confirmación solo vale si el último mensaje del asistente fue la pregunta de ESA orden (lleva su marca `<!--orden:ID-->`).
 *  - Contar palabras de un mensaje.
 */

const RE_MARCA_ORDEN = /<!--orden:([\w-]+)-->/g;

export const marcaOrden = (id: string) => `\n<!--orden:${id}-->`;

/** Id de la orden cuya confirmación mostró el asistente en su ÚLTIMO mensaje (o null). */
export function ordenIdDelUltimoAsistente(ultimoAsistente: string | undefined | null): string | null {
  const todas = [...String(ultimoAsistente ?? '').matchAll(RE_MARCA_ORDEN)];
  return todas.length ? todas[todas.length - 1]![1]! : null;
}

/** Mensaje corto que parece una RESPUESTA a una pregunta (no una orden nueva con toda su frase). */
export function esRespuestaCorta(mensaje: string, maxPalabras = 8): boolean {
  return String(mensaje ?? '').split(/\s+/).filter(Boolean).length <= maxPalabras;
}
