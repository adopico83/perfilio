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

/** Una pregunta de confirmación inventada por el modelo de charla («¿Lo hago?», «¿Lo guardo?», «¿Confirmas?»). */
const RE_FALSA_CONFIRMACION = /¿\s*(?:lo|la|los|las|le)\s+(?:hago|guardo|registro|apunto|creo|anoto|dejo|confirmo|preparo|emito|borro|elimino|cambio|muevo|paso|marco|mando|env[ií]o|pongo)\s*\?|¿\s*(?:confirmas|confirmo|sigo|procedo|adelante)\s*\?|\b(?:s[ií]\s*,?\s*hazlo|pulsa\s+s[ií])\b/iu;

/**
 * La charla (el modelo sin herramientas) NO puede simular una confirmación: si su texto pide un «¿Lo hago?» y no hay una orden
 * pendiente real, se reconduce a algo que sí es verdad (nada pendiente). Solo se llama sin orden pendiente.
 */
export function sanearCharla(texto: string): string {
  const limpio = String(texto ?? '');
  if (!RE_FALSA_CONFIRMACION.test(limpio.replace(/<!--[\s\S]*?-->/g, ''))) return limpio;
  return 'No tengo ninguna acción preparada para confirmar. Dime qué quieres hacer (con todos los datos) y la preparo; solo se guarda algo cuando tú lo confirmas.';
}
