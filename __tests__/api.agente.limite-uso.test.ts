import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

const mockLimite = jest.fn();
jest.mock('@/lib/ia/limite-uso', () => ({
  ...jest.requireActual('@/lib/ia/limite-uso'),
  comprobarLimiteIAAgente: (...a: unknown[]) => mockLimite(...a),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

void IDS;
beforeEach(() => {
  jest.clearAllMocks();
  const db = crearFakeDb(crearBaseSimulada());
  (createServiceClient as jest.Mock).mockReturnValue(db.client);
  (createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) },
  });
  delete process.env.JEV_API_KEY;
  delete process.env.AGENTE_CONFIRMACION;
  process.env.OPENAI_API_KEY = 'k';
  mockLimite.mockResolvedValue({ permitido: true });
});

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/agente/route');
  return POST(
    new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], ...body }),
    })
  );
};

describe('límite de uso del agente', () => {
  it('pasado el límite: 429 con aviso y Retry-After, sin llamar a OpenAI', async () => {
    mockLimite.mockResolvedValue({ permitido: false, motivo: 'minuto', reintentarEnS: 25 });
    const res = await post({ mensaje: 'hola' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('25');
    expect((await res.json()).error).toBe('Has hecho demasiadas consultas a la IA. Prueba de nuevo en 25 s.');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('se comprueba con el usuario y el negocio ya validados', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: 'Aupa.' } }] });
    await post({ mensaje: 'hola' });
    expect(mockLimite).toHaveBeenCalledTimes(1);
    expect(mockLimite.mock.calls[0][1]).toBe(USUARIO);
    expect(mockLimite.mock.calls[0][2]).toBe(NEGOCIO_A);
  });

  it('confirmar_accion no gasta OpenAI y no cuenta para el límite', async () => {
    const res = await post({ confirmar_accion: { tool: 'crear_cliente', args: { nombre: 'Lola Nueva' } } });
    expect(res.status).toBe(200);
    expect(mockLimite).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sin sesión (401) o sin acceso al negocio (403) no se gasta cupo', async () => {
    (createClient as jest.Mock).mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await post({ mensaje: 'hola' })).status).toBe(401);
    const { assertUserOwnsBusiness } = jest.requireMock('@/lib/supabase/assert-user-owns-business') as { assertUserOwnsBusiness: jest.Mock };
    assertUserOwnsBusiness.mockResolvedValueOnce(false);
    expect((await post({ mensaje: 'hola' })).status).toBe(403);
    expect(mockLimite).not.toHaveBeenCalled();
  });
});
