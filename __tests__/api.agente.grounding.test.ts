import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { findOpenAiCallWithTools } from './helpers/agente-openai';

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

  it('prueba 1: «obras abiertas» no crea borrador aunque el modelo llame iniciar_borrador', async () => {
    const insertBorrador = jest.fn().mockReturnValue(
      makeThenableResult({ data: { id: 'draft-ocasar' }, error: null })
    );

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'presupuesto_borrador') {
          const chain = makeThenableResult({ data: [], error: null });
          chain.insert = insertBorrador;
          return chain;
        }
        if (table === 'obras') {
          return makeThenableResult({
            data: [
              {
                id: 'o-1',
                nombre: 'Reforma Ocasar',
                cliente_id: 'c-1',
                direccion: null,
                estado: 'abierta',
                fecha_inicio: null,
              },
            ],
            error: null,
          });
        }
        if (table === 'clientes') {
          return makeThenableResult({
            data: [{ id: 'c-1', nombre: 'Javier Ocasar' }],
            error: null,
          });
        }
        return makeThenableResult({ data: [], error: null });
      }),
    });

    createMock
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
                    arguments: JSON.stringify({ cliente_nombre: 'Javier Ocasar' }),
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
              content: 'He iniciado un presupuesto para Javier Ocasar.',
            },
          },
        ],
      });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: '¿Qué obras tengo abiertas?',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(insertBorrador).not.toHaveBeenCalled();
    expect(String(json.respuesta)).not.toMatch(/he iniciado un presupuesto/i);
    expect(String(json.respuesta)).toMatch(/no he creado|obras|listado|buscar_obra/i);

    const agentCall = findOpenAiCallWithTools(createMock);
    const toolNames = (
      (agentCall?.params.tools as Array<{ function?: { name?: string } }>) ?? []
    )
      .map((t) => t.function?.name)
      .filter(Boolean);
    expect(toolNames).toContain('buscar_obra');
    expect(toolNames).not.toContain('iniciar_borrador_presupuesto');
  });

  it('prueba 1: buscar_obra lista las obras abiertas', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'obras') {
          return makeThenableResult({
            data: [
              {
                id: 'o-1',
                nombre: 'Reforma Ocasar',
                cliente_id: 'c-1',
                direccion: 'Irun',
                estado: 'abierta',
                fecha_inicio: null,
              },
            ],
            error: null,
          });
        }
        if (table === 'clientes') {
          return makeThenableResult({
            data: [{ id: 'c-1', nombre: 'Javier Ocasar' }],
            error: null,
          });
        }
        return makeThenableResult({ data: [], error: null });
      }),
    });

    createMock
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
                    name: 'buscar_obra',
                    arguments: JSON.stringify({ query: 'abiertas' }),
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
              content: 'Tienes 1 obra abierta: Reforma Ocasar (Javier Ocasar).',
            },
          },
        ],
      });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: '¿Qué obras tengo abiertas?',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(String(json.respuesta)).toMatch(/Reforma Ocasar/i);
    expect(String(json.respuesta)).not.toMatch(/he iniciado un presupuesto|borrador/i);
  });
});
