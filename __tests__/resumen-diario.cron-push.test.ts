import { NextRequest } from 'next/server';
import { calcularResumenDia } from '@/lib/resumen-diario/calcular';

const mockCargar = jest.fn();
const mockGuardar = jest.fn();
const mockPush = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({ select: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }) }),
  }),
  createClient: jest.fn(),
}));
jest.mock('@/lib/resumen-diario/datos', () => ({ cargarResumenDia: (...a: unknown[]) => mockCargar(...a) }));
jest.mock('@/lib/resumen-diario/guardar', () => ({
  guardarResumenComoNotificacion: (...a: unknown[]) => mockGuardar(...a),
}));
jest.mock('@/lib/resumen-diario/push', () => ({ enviarPushResumen: (...a: unknown[]) => mockPush(...a) }));

const vacio = calcularResumenDia(
  { citas: [], obras: [], diario: [], presupuestos: [], facturas: [] },
  new Date('2026-10-05T05:30:00Z')
);

describe('cron resumen-diario + push', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'secreto';
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T05:30:00Z'));
    mockCargar.mockResolvedValue(vacio);
  });
  afterEach(() => jest.useRealTimers());

  const llamar = async () => {
    const { GET } = await import('@/app/api/cron/resumen-diario/route');
    return (await GET(new NextRequest('http://x/api/cron/resumen-diario', { headers: { authorization: 'Bearer secreto' } }))).json();
  };

  it('manda el push solo de los negocios cuyo resumen se acaba de crear', async () => {
    mockGuardar.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockPush.mockResolvedValue({ pushover: 'enviado', webpush: 'sin_suscripciones' });
    const json = await llamar();
    expect(json).toMatchObject({ creados: 1, yaExistian: 1 });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][1]).toBe('a');
    expect(json.push).toEqual([{ business_id: 'a', pushover: 'enviado', webpush: 'sin_suscripciones' }]);
  });

  it('si ya existían todos (cron repetido) no manda ningún push', async () => {
    mockGuardar.mockResolvedValue(false);
    const json = await llamar();
    expect(mockPush).not.toHaveBeenCalled();
    expect(json.push).toBeUndefined();
  });

  it('no lista los negocios con el push desactivado', async () => {
    mockGuardar.mockResolvedValue(true);
    mockPush.mockResolvedValue({ pushover: 'desactivado', webpush: 'desactivado' });
    const json = await llamar();
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(json.push).toBeUndefined();
    expect(json.ok).toBe(true);
  });
});
