/** Métricas de presupuesto para la home demo. Misma idea que el dashboard de Pino:
 *  base en `importe_total` + IVA del texto. Si el texto trae BASE IMPONIBLE y TOTAL
 *  (seed de reformas), se usan esas cifras para no aplicar el IVA dos veces.
 */

export type LineaPresupuestoMetrica = {
  id: string;
  cliente_nombre: string | null;
  fecha: string | null;
  importe_total: number | null;
  presupuesto_generado?: string | null;
};

export type MetricaPresupuesto = {
  base: number;
  conIva: number;
};

export function fmtEurosEs(value: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
}

export function parseEurosEs(raw: string): number | null {
  const t = raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Igual que el panel de Pino: `IVA (21%)` dentro de `presupuesto_generado`. */
export function extraerIvaPorcentajeDesdePresupuesto(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const m = texto.match(/iva\s*\(\s*(\d+(?:[.,]\d+)?)\s*%?\s*\)/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function metricaPresupuesto(p: LineaPresupuestoMetrica): MetricaPresupuesto {
  const texto = p.presupuesto_generado ?? '';
  const baseM = texto.match(/BASE IMPONIBLE:\s*([0-9.\s]+,\d{2})/i);
  const totalM = texto.match(/\|\s*TOTAL:\s*([0-9.\s]+,\d{2})/i);
  if (baseM?.[1] && totalM?.[1]) {
    const base = parseEurosEs(baseM[1]);
    const conIva = parseEurosEs(totalM[1]);
    if (base != null && conIva != null) return { base, conIva };
  }

  const base = Number(p.importe_total) || 0;
  const ivaPct = extraerIvaPorcentajeDesdePresupuesto(texto) ?? 21;
  return { base, conIva: base * (1 + ivaPct / 100) };
}

export function sumarMetricasPresupuesto(rows: LineaPresupuestoMetrica[]): MetricaPresupuesto {
  return rows.reduce(
    (acc, row) => {
      const m = metricaPresupuesto(row);
      acc.base += m.base;
      acc.conIva += m.conIva;
      return acc;
    },
    { base: 0, conIva: 0 }
  );
}
