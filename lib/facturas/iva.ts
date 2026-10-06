/** IVA que se puede elegir en una factura. Fichero pequeño y sin dependencias: lo usan servidor y navegador. */
export const IVA_PORCENTAJES_PERMITIDOS = [0, 4, 10, 21] as const;
export const IVA_POR_DEFECTO = 21;

/**
 * El % permitido más cercano al dado (el que sale de dividir iva / base puede ser 20,9 o 9,96 por los
 * redondeos de céntimos). En empate gana el mayor; con un valor no numérico, 21.
 */
export function ivaPermitidoMasCercano(pct: number): number {
  if (!Number.isFinite(pct)) return IVA_POR_DEFECTO;
  let mejor: number = IVA_PORCENTAJES_PERMITIDOS[0];
  for (const p of IVA_PORCENTAJES_PERMITIDOS) {
    const d = Math.abs(p - pct);
    const dMejor = Math.abs(mejor - pct);
    if (d < dMejor || (d === dMejor && p > mejor)) mejor = p;
  }
  return mejor;
}

/** % de IVA de una factura a partir de su base y su cuota (iva / base), ajustado a los permitidos. */
export function ivaPorcentajeDeFactura(base: unknown, iva: unknown): number {
  const b = Number(base);
  const i = Number(iva);
  if (!Number.isFinite(b) || !Number.isFinite(i) || b <= 0) return IVA_POR_DEFECTO;
  return ivaPermitidoMasCercano((i / b) * 100);
}
