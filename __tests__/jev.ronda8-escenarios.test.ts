/** Los escenarios de la ronda 8 con el traductor SIMULADO (cada paso lleva la orden que debería salir). */
import { ESCENARIOS_RONDA8, ejecutarEscenario } from '../evals/ronda8';

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

describe('escenarios de la ronda 8 (traductor simulado)', () => {
  it.each(ESCENARIOS_RONDA8.map((e) => [e.nombre, e] as const))('%s', async (_n, esc) => {
    const { problemas } = await ejecutarEscenario(esc, async (_e, paso) => {
      if (!paso.orden) throw new Error('el paso no lleva orden simulada');
      return { orden: paso.orden as never, continuaTarea: paso.continua === true, ...(paso.otras ? { otras: paso.otras as never } : {}) };
    });
    expect(problemas).toEqual([]);
  });
});
