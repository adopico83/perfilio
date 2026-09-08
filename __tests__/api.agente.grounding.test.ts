import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

const createMock = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

function makeThenableResult<T>(result: { data: T; error: { message: string } | null }) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.update = jest.fn(self);
  chain.order = jest.fn(self);
  chain.limit = jest.fn(self);
  chain.is = jest.fn(self);
  chain.ilike = jest.fn(self);
  chain.in = jest.fn(self);
  chain.or = jest.fn(self);
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue({
    data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
    error: result.error,
  });
  (chain as unknown as PromiseLike<typeof result>).then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const businessProfileChain = (() => {
  const bp = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({
      data: {
        nombre: 'Mi taller',
        sector: 'Carpintería',
        descripcion: '',
        servicios: '',
        tarifas: '',
        contexto_adicional: '',
      },
      error: null,
    }),
  };
  bp.select.mockImplementation(() => bp);
  bp.eq.mockImplementation(() => bp);
  return bp;
})();

const PRUEBA_3 =
  'Añade partida 12.345 € Mármol alienígena al presupuesto del cliente inexistente XYZ-999';

describe('POST /api/agente — Fase A.2 grounding', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const mod = await import('@/app/api/agente/route');
    POST = mod.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
    });
  });

  it('prueba 3: cliente inexistente XYZ-999 → fail-closed, no inventa éxito', async () => {
    const insertBorrador = jest.fn().mockReturnValue(
      makeThenableResult({ data: { id: 'draft-fake' }, error: null })
    );
    const insertItems = jest.fn().mockReturnValue(
      makeThenableResult({ data: { id: 'item-fake' }, error: null })
    );

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'presupuesto_borrador') {
          const chain = makeThenableResult({ data: [], error: null });
          chain.insert = insertBorrador;
          return chain;
        }
        if (table === 'presupuesto_borrador_items') {
          const chain = makeThenableResult({ data: [], error: null });
          chain.insert = insertItems;
          return chain;
        }
        if (table === 'clientes' || table === 'presupuestos' || table === 'obras') {
          return makeThenableResult({ data: [], error: null });
        }
        return makeThenableResult({ data: [], error: null });
      }),
    });

    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'presupuesto' } }] })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'iniciar_borrador_presupuesto',
                    arguments: JSON.stringify({ cliente_nombre: 'XYZ-999' }),
                  },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'agregar_partida_borrador',
                    arguments: JSON.stringify({
                      cliente_nombre: 'XYZ-999',
                      descripcion: 'Mármol alienígena',
                      cantidad: 1,
                      unidad: 'ud',
                      precio_unitario: 12345,
                      raw_dictado: PRUEBA_3,
                    }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Añadido: Mármol alienígena (12345€) al presupuesto de XYZ-999. ¿Siguiente?',
            },
          },
        ],
      });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: PRUEBA_3,
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(String(json.respuesta)).toMatch(/XYZ-999|no encuentro|no he añadido|no creo/i);
    expect(String(json.respuesta)).not.toMatch(/añadido:\s*mármol/i);
    expect(insertBorrador).not.toHaveBeenCalled();
    expect(insertItems).not.toHaveBeenCalled();
  });
});
