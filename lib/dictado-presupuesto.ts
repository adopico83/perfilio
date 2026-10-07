import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';

let openaiCliente: OpenAI | null = null;

/** Cliente de OpenAI creado la primera vez que se usa (no al importar el módulo): así `next build` no exige OPENAI_API_KEY. */
function getOpenAI(): OpenAI {
  openaiCliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiCliente;
}

export type TarifaReferencia = {
  nombre: string;
  unidad: string;
  precio: number;
  categoria: string;
};

export type PartidaPresupuesto = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  total: number;
  categoria: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseJsonArrayFromContent(content: string): unknown {
  const trimmed = content.trim();
  const tryParse = (s: string) => JSON.parse(s) as unknown;
  try {
    return tryParse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      return tryParse(fence[1].trim());
    }
    const arr = trimmed.match(/\[[\s\S]*\]/);
    if (arr) {
      return tryParse(arr[0]);
    }
    throw new Error('No se pudo interpretar el JSON de partidas');
  }
}

/** El usuario no dijo la cantidad de alguna partida: se pregunta, no se inventa. */
export class DictadoIncompletoError extends Error {
  constructor(public readonly partidasSinCantidad: string[]) {
    super(
      `Me falta la cantidad de ${partidasSinCantidad.map((p) => `«${p}»`).join(', ')}. ¿Cuántos metros (o unidades) son? No he guardado nada.`
    );
    this.name = 'DictadoIncompletoError';
  }
}

const cantidadFaltante = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && !v.trim()) || String(v).toLowerCase() === 'null';

function normalizePartida(raw: Record<string, unknown>, index: number): PartidaPresupuesto {
  const descripcion = String(raw.descripcion ?? raw.descripción ?? `Partida ${index + 1}`).trim();
  const cantidad = Number(raw.cantidad);
  const unidad = String(raw.unidad ?? 'ud').trim() || 'ud';
  const precio_unitario = Number(raw.precio_unitario ?? raw.precioUnitario);
  const categoria = String(raw.categoria ?? 'general').trim() || 'general';
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new Error(`Partida ${index + 1}: cantidad inválida`);
  }
  if (!Number.isFinite(precio_unitario) || precio_unitario < 0) {
    throw new Error(`Partida ${index + 1}: precio_unitario inválido`);
  }
  const precioRedondeado = round2(precio_unitario);
  return {
    descripcion: descripcion || `Partida ${index + 1}`,
    cantidad,
    unidad,
    precio_unitario: precioRedondeado,
    total: round2(cantidad * precioRedondeado),
    categoria,
  };
}

/**
 * Llama a OpenAI para convertir el dictado en partidas usando las tarifas dadas (propias o base).
 */
export async function estructurarDictadoEnPartidas(
  dictado: string,
  tarifas: TarifaReferencia[]
): Promise<PartidaPresupuesto[]> {
  const d = dictado.trim();
  if (!d) {
    throw new Error('El dictado está vacío');
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY no configurada');
  }

  const tarifasJson = JSON.stringify(tarifas);

  const systemPrompt = `Eres un experto en presupuestos de albañilería y reformas. 
Analiza el siguiente dictado de visita de obra y extrae las partidas de trabajo en formato JSON. Para cada partida indica:
- descripcion: descripción clara del trabajo
- cantidad: número estimado (m2, ml, ud, horas)
- unidad: m2, ml, ud, hora, m3
- precio_unitario: precio por unidad según las tarifas proporcionadas
- total: cantidad * precio_unitario
- categoria: tipo de trabajo

Tarifas disponibles: ${tarifasJson}

IMPORTANTE — Reglas de extracción por prioridad:
1. Si el dictado indica un importe total cerrado para una partida (ej: "colocar material, 942 euros" o "rejuntear material 104 euros"), usa: cantidad=1, unidad="ud", precio_unitario=ese importe exacto, total=ese importe exacto. No uses las tarifas en este caso.
2. Si el dictado indica cantidad + unidad + precio unitario (ej: "alicatado 15m2 a 50 euros el m2"), extrae los tres valores directamente del dictado.
3. Si el dictado indica cantidad + unidad sin precio (ej: "enfoscado 20m2"), busca la tarifa más cercana por nombre o categoría y usa su precio como precio_unitario.
4. Si el dictado menciona el trabajo SIN cantidad (ej: "demolición de tabique"), pon cantidad: null. NUNCA estimes ni inventes una cantidad: el servidor se la preguntará al usuario. El precio, en ese caso, sí puede venir de la tarifa más cercana.
5. Los números que dice el usuario (cantidades y precios) se copian EXACTOS, sin redondear ni sustituir por los de la tarifa: "alicatar 16 metros a 34" es cantidad 16 y precio_unitario 34, aunque la tarifa diga 35. La tarifa solo se usa si el usuario NO dijo precio.
En todos los casos: responde SOLO con un array JSON válido de partidas. No incluyas texto adicional ni menciones IVA en el JSON.`;

  const completion = await getOpenAI().chat.completions.create({
    model: AGENTE_MODELO_POR_DEFECTO,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: d },
    ],
    temperature: 0.25,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJsonArrayFromContent(content);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('El modelo no devolvió partidas válidas');
  }

  const sinCantidad = (parsed as Array<Record<string, unknown>>)
    .filter((it) => cantidadFaltante(it?.cantidad))
    .map((it, i) => String(it?.descripcion ?? `Partida ${i + 1}`).trim());
  if (sinCantidad.length > 0) throw new DictadoIncompletoError(sinCantidad);

  const partidas = parsed.map((item, i) => normalizePartida(item as Record<string, unknown>, i));
  return corregirPartidasConDictado(d, partidas);
}

// ───────────────── Lo que dijo el usuario manda sobre lo que devuelva el modelo ─────────────────

/** Números del dictado («16», «34», «1.250,50»), sin las unidades pegadas (m2, m²) ni los porcentajes. */
export function numerosDelDictado(dictado: string): number[] {
  const limpio = dictado
    .toLowerCase()
    .replace(/\bm\s?[²23]\b/g, ' m ')
    .replace(/\d+(?:[.,]\d+)?\s?%/g, ' ');
  const out: number[] = [];
  for (const m of limpio.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let t = m[0];
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(',', '.');
    const n = Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const palabras = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.replace(/(ados|adas|ado|ada|ar|er|ir|es|s|o|a)$/, ''));

const aNumero = (t: string) => Number(t.replace(',', '.'));
const RE_CANT_PRECIO =
  /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|m3|ml|metros?(?:\s+cuadrados?|\s+lineales?)?|m|uds?|unidades?|horas?|h)\b[^\d]*?\b(?:a|por|x|@)\s*(\d+(?:[.,]\d+)?)/i;

/**
 * Si el usuario dijo cantidad y precio («alicatar 16 metros a 34»), se respetan SIEMPRE: si el modelo los ha
 * cambiado (p. ej. 35 de la tarifa), se corrigen en la partida correspondiente.
 */
export function corregirPartidasConDictado(dictado: string, partidas: PartidaPresupuesto[]): PartidaPresupuesto[] {
  const out = partidas.map((p) => ({ ...p }));
  for (const segmento of dictado.split(/[,;.\n]|\by\b/i)) {
    const m = segmento.match(RE_CANT_PRECIO);
    if (!m) continue;
    const cantidad = aNumero(m[1]);
    const precio = aNumero(m[2]);
    const pals = new Set(palabras(segmento));
    let mejor = -1;
    let puntos = 0;
    let empate = false;
    out.forEach((p, i) => {
      const comunes = palabras(`${p.descripcion} ${p.categoria}`).filter((w) => pals.has(w)).length;
      if (comunes > puntos) {
        mejor = i;
        puntos = comunes;
        empate = false;
      } else if (comunes === puntos && comunes > 0) empate = true;
    });
    if (mejor < 0 || empate) continue;
    const p = out[mejor]!;
    p.cantidad = cantidad;
    p.precio_unitario = round2(precio);
    p.total = round2(cantidad * round2(precio));
  }
  return out;
}

/**
 * Cada número dicho en el dictado tiene que aparecer en las partidas (como cantidad, precio o importe).
 * Si falta alguno, se devuelve un mensaje para PREGUNTAR (nunca se guarda un presupuesto que no cuadra).
 */
export function validarPartidasContraDictado(dictado: string, partidas: PartidaPresupuesto[]): string | null {
  const presentes = new Set<number>();
  for (const p of partidas) {
    for (const n of [p.cantidad, p.precio_unitario, p.total]) presentes.add(round2(n));
  }
  const faltan = [...new Set(numerosDelDictado(dictado).map(round2))].filter((n) => !presentes.has(n));
  if (faltan.length === 0) return null;
  return `En el dictado dijiste ${faltan.join(', ')} y no lo veo reflejado en las partidas. ¿Me repites cantidad y precio de ese trabajo? No he guardado nada.`;
}

export function formatearBorradorPresupuestoDictado(
  partidas: PartidaPresupuesto[],
  clienteNombre: string,
  direccionObra: string
): { texto: string; subtotal: number; iva: number; totalConIva: number } {
  let subtotal = 0;
  for (const p of partidas) {
    subtotal += p.total;
  }
  subtotal = round2(subtotal);
  const iva = round2(subtotal * 0.21);
  const totalConIva = round2(subtotal + iva);

  const lineasPartidas = partidas.map((p, i) => {
    const pu = round2(p.precio_unitario).toFixed(2);
    const tot = round2(p.total).toFixed(2);
    return `${i + 1}. ${p.descripcion} - ${p.cantidad} ${p.unidad} x ${pu}€ = ${tot}€`;
  });

  const texto = [
    'BORRADOR - Presupuesto de reforma',
    `Cliente: ${clienteNombre.trim() || '—'}`,
    `Dirección: ${direccionObra.trim() || '—'}`,
    '',
    'PARTIDAS:',
    ...lineasPartidas,
    '',
    `SUBTOTAL: ${subtotal.toFixed(2)}€`,
    `IVA (21%): ${iva.toFixed(2)}€`,
    `TOTAL: ${totalConIva.toFixed(2)}€`,
    '',
    '* Precios orientativos sujetos a revisión',
  ].join('\n');

  return { texto, subtotal, iva, totalConIva };
}
