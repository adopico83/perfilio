export const GASTO_CATEGORIAS = [
  'material',
  'herramienta',
  'vertido',
  'subcontrata',
  'transporte',
  'otros',
] as const;

export type GastoCategoria = (typeof GASTO_CATEGORIAS)[number];

const SET = new Set<string>(GASTO_CATEGORIAS);

/** Valor guardado en BD y en la tool del agente. */
export function normalizeGastoCategoria(input: unknown): GastoCategoria {
  const s = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (SET.has(s)) return s as GastoCategoria;
  return 'material';
}

const ETIQUETAS: Record<GastoCategoria, string> = {
  material: 'Material',
  herramienta: 'Herramienta',
  vertido: 'Vertido',
  subcontrata: 'Subcontrata',
  transporte: 'Transporte',
  otros: 'Otros',
};

export function etiquetaGastoCategoria(c: unknown): string {
  const n = normalizeGastoCategoria(c);
  return ETIQUETAS[n];
}
