import {
  extraerIvaPorcentajeDesdePresupuesto,
  metricaPresupuesto,
  sumarMetricasPresupuesto,
} from '@/lib/demo-metricas';

const SEED = [
  'BASE IMPONIBLE: 9.755,00 € | IVA (21%): 2.048,55 € | TOTAL: 11.803,55 €',
].join('\n');

describe('métricas de presupuesto demo', () => {
  it('usa base y total del texto seed aunque importe_total ya lleve IVA', () => {
    const m = metricaPresupuesto({
      id: 'p1',
      cliente_nombre: 'Ainhoa Etxeberria',
      fecha: '2026-09-07',
      importe_total: 11803.55,
      presupuesto_generado: SEED,
    });
    expect(m.base).toBeCloseTo(9755, 2);
    expect(m.conIva).toBeCloseTo(11803.55, 2);
  });

  it('trata importe_total como base y aplica el IVA del texto, como el panel de Pino', () => {
    const m = metricaPresupuesto({
      id: 'p2',
      cliente_nombre: 'Taller',
      fecha: null,
      importe_total: 100,
      presupuesto_generado: 'IVA (10%)',
    });
    expect(extraerIvaPorcentajeDesdePresupuesto('IVA (10%)')).toBe(10);
    expect(m.base).toBe(100);
    expect(m.conIva).toBeCloseTo(110, 2);
  });

  it('suma varias líneas', () => {
    const total = sumarMetricasPresupuesto([
      {
        id: 'a',
        cliente_nombre: null,
        fecha: null,
        importe_total: 100,
        presupuesto_generado: null,
      },
      {
        id: 'b',
        cliente_nombre: null,
        fecha: null,
        importe_total: 50,
        presupuesto_generado: 'IVA (21%)',
      },
    ]);
    expect(total.base).toBe(150);
    expect(total.conIva).toBeCloseTo(100 * 1.21 + 50 * 1.21, 2);
  });
});
