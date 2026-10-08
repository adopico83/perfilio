/** El bloque de paráfrasis con modelos SIMULADOS (cada paso lleva la orden y la intención que deberían salir). El real: `npm run eval:jev-real`. */
import { PARAFRASIS_R9 } from '../evals/parafrasis';
import { ejecutarEscenario, escriturasIncorrectas, ordenPerdidaSinAviso } from '../evals/ronda8';
import { clasificadorSimulado } from './helpers/clasificador-simulado';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/presupuesto-render', () => ({
  PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre, estado',
  nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
  renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
}));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

describe('bloque de paráfrasis (modelos simulados)', () => {
  it('tiene al menos 60 escenarios', () => {
    expect(PARAFRASIS_R9.length).toBeGreaterThanOrEqual(70);
  });
  it.each(PARAFRASIS_R9.map((e) => [e.nombre, e] as const))('%s', async (_n, esc) => {
    const { problemas, db, respuestas } = await ejecutarEscenario(
      esc,
      async (_e, paso) => {
        if (!paso.orden) throw new Error('el paso no lleva orden simulada');
        return { orden: paso.orden as never, continuaTarea: paso.continua === true, ...(paso.otras ? { otras: paso.otras as never } : {}) };
      },
      async (e, paso) => (paso.intencion ? { intencion: paso.intencion, segura: true } : clasificadorSimulado(e))
    );
    expect(problemas).toEqual([]);
    expect(escriturasIncorrectas(esc, db)).toEqual([]);
    expect(ordenPerdidaSinAviso(esc, respuestas)).toBe(false);
  });
});
