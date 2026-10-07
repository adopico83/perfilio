/**
 * «250 más IVA» = 250 es la BASE (el IVA se suma). «250 con IVA» / «IVA incluido» = 250 es el TOTAL.
 * El modelo se equivocaba (guardó «250 más IVA» como IVA incluido): lo que dijo el usuario lo decide el
 * servidor a partir del mensaje, no el modelo.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ImportesGasto = { importe: number; iva: number; importe_total: number };

export type ModoIva = 'base' | 'total' | 'sin_iva' | null;

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Qué significa el importe que dijo el usuario, según cómo lo dijo. */
export function modoIvaDelMensaje(mensaje: string): ModoIva {
  const t = sinTildes(mensaje);
  if (/\b(?:sin|libre de)\s+iva\b/.test(t)) return 'sin_iva';
  if (/(?:\bmas\s+(?:el\s+)?iva\b|\+\s*(?:el\s+)?iva\b|\bmas\s+(?:un\s+)?\d{1,2}\s*%\s*(?:de\s+)?iva\b|\bi\.?v\.?a\.?\s+aparte\b|\biva\s+no\s+incluido\b)/.test(t)) return 'base';
  if (/(?:\biva\s+incluido\b|\bcon\s+(?:el\s+)?iva\b|\biva\s+incl\b|\btodo\s+incluido\b|\bi\.?v\.?a\.?\s+y\s+todo\b)/.test(t)) return 'total';
  return null;
}

function numerosDelMensaje(mensaje: string): number[] {
  const out: number[] = [];
  const limpio = mensaje.replace(/\d+(?:[.,]\d+)?\s?%/g, ' ');
  for (const m of limpio.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let t = m[0];
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(',', '.');
    const n = Number(t);
    if (Number.isFinite(n)) out.push(r2(n));
  }
  return out;
}

const TIPOS_IVA = [0, 4, 10, 21];

/**
 * Corrige los importes del modelo según el mensaje. Si no hay «más IVA / con IVA / sin IVA» en el mensaje,
 * o la cifra dicha no se puede localizar, se deja tal cual.
 */
export function corregirImportesSegunMensaje(
  mensaje: string,
  datos: ImportesGasto
): { datos: ImportesGasto; modo: ModoIva; corregido: boolean } {
  const modo = modoIvaDelMensaje(mensaje);
  if (!modo) return { datos, modo, corregido: false };
  const dichos = numerosDelMensaje(mensaje);
  const { importe, iva, importe_total: total } = datos;
  if (![importe, iva, total].every(Number.isFinite)) return { datos, modo, corregido: false };

  // Tipo de IVA: el que sugiere lo que mandó el modelo, o el 21 % por defecto.
  const ratioModelo = importe > 0 ? iva / importe : NaN;
  const tipoModelo = TIPOS_IVA.find((t) => Math.abs(ratioModelo - t / 100) < 0.005);
  const mensajeTipo = mensaje.match(/\b(4|10|21)\s*%/);
  const tipo = mensajeTipo ? Number(mensajeTipo[1]) : (tipoModelo ?? 21);

  if (modo === 'sin_iva') {
    const n = [importe, total].find((x) => dichos.includes(r2(x)));
    if (n === undefined) return { datos, modo, corregido: false };
    const nuevo = { importe: r2(n), iva: 0, importe_total: r2(n) };
    return { datos: nuevo, modo, corregido: nuevo.importe !== importe || nuevo.iva !== iva || nuevo.importe_total !== total };
  }

  if (modo === 'base') {
    // La cifra dicha es la base. Puede haberla puesto el modelo como base o (mal) como total.
    const n = dichos.includes(r2(importe)) ? importe : dichos.includes(r2(total)) ? total : undefined;
    if (n === undefined) return { datos, modo, corregido: false };
    const base = r2(n);
    const ivaN = r2((base * tipo) / 100);
    const nuevo = { importe: base, iva: ivaN, importe_total: r2(base + ivaN) };
    return { datos: nuevo, modo, corregido: nuevo.importe !== importe || nuevo.iva !== iva || nuevo.importe_total !== total };
  }

  // modo === 'total': la cifra dicha es el total (IVA incluido).
  const n = dichos.includes(r2(total)) ? total : dichos.includes(r2(importe)) ? importe : undefined;
  if (n === undefined) return { datos, modo, corregido: false };
  const tot = r2(n);
  const base = r2(tot / (1 + tipo / 100));
  const nuevo = { importe: base, iva: r2(tot - base), importe_total: tot };
  return { datos: nuevo, modo, corregido: nuevo.importe !== importe || nuevo.iva !== iva || nuevo.importe_total !== total };
}

/**
 * Descripción del gasto sacada del mensaje del usuario cuando el modelo no la manda: se quitan el importe,
 * el IVA, «apunta un gasto de…» y el proveedor, y queda lo que se compró («plato de ducha y grifería»).
 */
export function descripcionDelMensaje(mensaje: string, proveedor = ''): string {
  let t = String(mensaje ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(/^(?:apunta(?:me)?|anota(?:me)?|mete(?:me)?|registra(?:me)?|pon(?:me)?|a[ñn]ade|guarda(?:me)?)\s+(?:un\s+|el\s+)?(?:gasto|ticket|factura|compra)?\s*(?:de|por)?\s*/i, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:€|euros?|eur)?\s*(?:\+|m[aá]s|con|sin)?\s*(?:el\s+)?i\.?v\.?a\.?(?:\s+incluido|\s+aparte|\s+no incluido)?/gi, ' ')
    .replace(/\b(?:iva\s+incluido|iva\s+aparte)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:€|euros?|eur)\b/gi, ' ');
  if (proveedor.trim()) {
    const esc = proveedor.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\b(?:en|de|a|para)\\s+${esc}\\b`, 'i'), ' ').replace(new RegExp(`\\b${esc}\\b`, 'i'), ' ');
  }
  t = t
    .replace(/\bpara\s+(?:lo\s+de|la\s+obra\s+de|la\s+obra|el\s+cliente)\s+[^,.;]+/gi, ' ')
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '')
    .replace(/^(?:de|en|por|que|:)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3 || /^[\d\s.,€+%-]+$/.test(t)) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 200 ? `${t.slice(0, 197)}…` : t;
}
