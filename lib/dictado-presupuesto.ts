import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function normalizePartida(raw: Record<string, unknown>, index: number): PartidaPresupuesto {
  const descripcion = String(raw.descripcion ?? raw.descripción ?? `Partida ${index + 1}`).trim();
  const cantidad = Number(raw.cantidad);
  const unidad = String(raw.unidad ?? 'ud').trim() || 'ud';
  const precio_unitario = Number(raw.precio_unitario ?? raw.precioUnitario);
  const categoria = String(raw.categoria ?? 'varios').trim() || 'varios';
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new Error(`Partida ${index + 1}: cantidad inválida`);
  }
  if (!Number.isFinite(precio_unitario) || precio_unitario < 0) {
    throw new Error(`Partida ${index + 1}: precio_unitario inválido`);
  }
  const total = round2(cantidad * precio_unitario);
  return {
    descripcion: descripcion || `Partida ${index + 1}`,
    cantidad,
    unidad,
    precio_unitario: round2(precio_unitario),
    total,
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

Responde SOLO con un array JSON válido de partidas, sin texto adicional.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
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

  return parsed.map((item, i) =>
    normalizePartida(item as Record<string, unknown>, i)
  );
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
