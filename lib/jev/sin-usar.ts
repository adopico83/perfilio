import { horasEnTexto, numerosDelMensaje } from '@/lib/jev/fechas';
import { letrasACifras } from '@/lib/numeros-letras';

/** Datos del mensaje (cifras) que ninguna orden ha recogido, con un trocito del mensaje para que se entienda. null si no sobra nada. */
export function datosSinUsar(mensaje: string, ordenes: Array<Record<string, unknown>>): string | null {
  const d = datoSinUsarDetalle(mensaje, ordenes);
  return d ? d.trozo : null;
}

/** Campos donde el modelo suele «tirar» lo que no sabe colocar: una cifra dentro de ellos NO cuenta como recogida. */
const CAMPOS_BASURERO = new Set(['descripcion_texto', 'notas_texto', 'titulo_texto']);

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Palabras con mayúscula que NO son nombres (siglas, saludos, días, meses). */
const NO_NOMBRES = new Set(['iva', 'nif', 'cif', 'dni', 'pdf', 'si', 'no', 'vale', 'hola', 'buenas', 'gracias', 'ok', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'perfilio', 'whatsapp', 'prueba']);

/** Texto con TODO lo que llevan las órdenes (menos los campos «basurero»), sin tildes ni mayúsculas. */
function textoDeOrdenes(ordenes: Array<Record<string, unknown>>): string {
  const partes: string[] = [];
  const recoge = (v: unknown, clave = ''): void => {
    if (typeof v === 'string') {
      if (!CAMPOS_BASURERO.has(clave)) partes.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => recoge(x, clave));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) recoge(x, k);
  };
  ordenes.forEach((o) => recoge(o));
  return sinTildes(partes.join(' | '));
}

/**
 * Lo que dijo el usuario y ninguna orden recoge: una CIFRA («6 horas») o un NOMBRE con mayúscula («Jon»). Devuelve un trocito del mensaje
 * para que se entienda y su posición, o null si todo está recogido. Una cifra metida en descripción/notas/título no cuenta como recogida.
 */
export function datoSinUsarDetalle(mensaje: string, ordenes: Array<Record<string, unknown>>): { trozo: string; indice: number } | null {
  const quitaPorcentajes = (t: string) => t.replace(/\d+(?:[.,]\d+)?\s?%/g, ' ');
  const usados = new Set<number>();
  const recoge = (v: unknown, clave = ''): void => {
    if (typeof v === 'string') {
      if (CAMPOS_BASURERO.has(clave)) return;
      for (const n of [...numerosDelMensaje(quitaPorcentajes(v)), ...horasEnTexto(v)]) usados.add(Math.round(n * 100) / 100);
    } else if (Array.isArray(v)) v.forEach((x) => recoge(x, clave));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) recoge(x, k);
  };
  ordenes.forEach((o) => recoge(o));
  const texto = quitaPorcentajes(mensaje);
  const trozoAlrededor = (indice: number, largo: number) => {
    const ini = Math.max(0, indice - 25);
    return texto.slice(ini, indice + largo + 25).replace(/\s+/g, ' ').trim();
  };
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = numerosDelMensaje(m[0])[0];
    if (n == null || usados.has(Math.round(n * 100) / 100)) continue;
    return { trozo: trozoAlrededor(m.index ?? 0, m[0].length), indice: m.index ?? 0 };
  }
  // Una cifra con UNIDAD tiene que estar en el hueco de esa unidad: «6 horas» en un campo de horas (no como importe de un gasto),
  // «87 euros» en un campo de importe o precio. Es lectura de datos, no de frases.
  const enClave = (clave: RegExp): Set<number> => {
    const out = new Set<number>();
    const rec = (v: unknown, k = ''): void => {
      if (typeof v === 'string') {
        if (clave.test(k)) for (const n of [...numerosDelMensaje(v), ...horasEnTexto(v)]) out.add(Math.round(n * 100) / 100);
      } else if (Array.isArray(v)) v.forEach((x) => rec(x, k));
      else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v as Record<string, unknown>)) rec(x, kk);
    };
    ordenes.forEach((o) => rec(o));
    return out;
  };
  const conUnidad = letrasACifras(texto);
  const reglas: Array<[RegExp, RegExp]> = [
    [/(\d+(?:[.,]\d+)?)\s*(?:horas?|h)\b/gi, /hora|duraci/],
    [/(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/gi, /importe|precio|total|anticipo|adelanto|sena|cobro|pago|coste/],
  ];
  for (const [re, clave] of reglas) {
    const validos = enClave(clave);
    for (const m of conUnidad.matchAll(re)) {
      const n = numerosDelMensaje(m[1]!)[0];
      if (n == null || validos.has(Math.round(n * 100) / 100)) continue;
      const pos = texto.search(new RegExp(`\\b${m[1]!.replace('.', '\\.')}\\b`));
      const indice = pos >= 0 ? pos : 0;
      return { trozo: trozoAlrededor(indice, m[1]!.length), indice };
    }
  }
  const todo = textoDeOrdenes(ordenes);
  for (const m of texto.matchAll(/(?<![.!?¿¡]\s)(?<=\S\s)\b[A-ZÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]{2,}/g)) {
    const w = sinTildes(m[0]);
    if (NO_NOMBRES.has(w) || todo.includes(w)) continue;
    return { trozo: trozoAlrededor(m.index ?? 0, m[0].length), indice: m.index ?? 0 };
  }
  return null;
}

/**
 * La cláusula del mensaje que contiene la posición `indice` («...y de paso ponle 6 horas a Jon en lo de Paqui»). Corta en comas,
 * punto y coma, dos puntos y en «y» que une dos peticiones (no en «7 y media», «y cuarto» ni «y 30»).
 */
export function clausulaEn(mensaje: string, indice: number): string {
  // La coma o el punto entre cifras («87,40», «1.250») es un decimal, no un corte.
  const corte = /\s*(?:(?<!\d)[,.]|[,.](?!\d)|[;:]|\by\b(?!\s+(?:media|medio|cuarto|tres cuartos|\d)))\s*/g;
  let ini = 0;
  for (const m of mensaje.matchAll(corte)) {
    const fin = m.index ?? 0;
    if (indice < fin) return mensaje.slice(ini, fin).trim();
    ini = fin + m[0].length;
  }
  return mensaje.slice(ini).trim();
}

/** Los datos «duros» de un texto: sus cifras y sus nombres propios (palabras con mayúscula, también la primera). Para comparar trozos. */
export function datosDurosDe(texto: string): Set<string> {
  const out = new Set<string>();
  for (const n of numerosDelMensaje(texto)) out.add(`#${Math.round(n * 100) / 100}`);
  for (const m of texto.matchAll(/\b[A-ZÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]{2,}/g)) {
    const w = sinTildes(m[0]);
    if (!NO_NOMBRES.has(w)) out.add(w);
  }
  return out;
}
