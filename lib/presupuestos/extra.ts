/**
 * Un EXTRA (trabajo nuevo sobre un presupuesto) se guarda como una fila más de `presupuestos`, y en TODOS los presupuestos
 * `importe_total` lleva el IVA. El usuario da el extra sin IVA («95 más IVA»): lo que se guarda es 95 + 21 % = 114,95.
 */
export const IVA_EXTRA_PCT = 21;

export const totalExtraConIva = (base: number): number => Math.round((base * (1 + IVA_EXTRA_PCT / 100) + Number.EPSILON) * 100) / 100;
