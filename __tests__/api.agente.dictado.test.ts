import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

jest.mock('@/lib/dictado-presupuesto', () => {
  const actual = jest.requireActual<typeof import('@/lib/dictado-presupuesto')>(
    '@/lib/dictado-presupuesto'
  );
  return {
    ...actual,
    estructurarDictadoEnPartidas: jest.fn(async () => [
      {
        descripcion: 'Solado de gres',
        cantidad: 20,
        unidad: 'm2',
        precio_unitario: 35,
        total: 700,
        categoria: 'suelo',
      },
    ]),
  };
});

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
  chain.order = jest.fn(self);
  chain.limit = jest.fn(self);
  chain.is = jest.fn(self);
  chain.in = jest.fn(self);
  chain.neq = jest.fn(self);
  chain.ilike = jest.fn(self);
  chain.single = jest.fn().mockResolvedValue(result);
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
        sector: 'Albañilería',
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

describe('POST /api/agente — dictado y tarifas', () => {
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

  function toolCallMessage(name: string, args = '{}') {
    return {
      choices: [
        {
          message: {
            content: null as string | null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function' as const,
                function: { name, arguments: args },
              },
            ],
          },
        },
      ],
    };
  }

  function mockRouterGeneral() {
    return {
      choices: [{ message: { content: 'general' } }],
    };
  }

  it('generar_presupuesto_por_dictado devuelve mensaje con borrador', async () => {
    const insertMock = jest.fn().mockReturnValue({
      then: (onOk: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onOk),
    });

    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(
        toolCallMessage(
          'generar_presupuesto_por_dictado',
          JSON.stringify({
            dictado: 'Unos 20 metros de solado en el salón',
            cliente_nombre: 'García',
            direccion_obra: 'Calle Mayor 1',
          })
        )
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'tarifas') {
          return makeThenableResult({ data: [], error: null });
        }
        if (table === 'presupuestos') {
          return { insert: insertMock };
        }
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Genera presupuesto del dictado',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const secondCall = createMock.mock.calls[2]?.[0] as {
      messages: Array<{ role: string; content?: string }>;
    };
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg!.content as string) as { mensaje?: string };
    expect(parsed.mensaje).toContain('BORRADOR - Presupuesto de reforma');
    expect(parsed.mensaje).toContain('PARTIDAS:');
    expect(parsed.mensaje).toContain('García');
    expect(insertMock).toHaveBeenCalled();
  });

  it('gestionar_tarifas listar devuelve array de tarifas', async () => {
    const filas = [
      {
        id: 't1',
        nombre: 'Alicatado',
        unidad: 'm2',
        precio: 32,
        categoria: 'alicatado',
        created_at: '2026-03-01T10:00:00Z',
      },
    ];

    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(
        toolCallMessage('gestionar_tarifas', JSON.stringify({ accion: 'listar' }))
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Aquí tienes las tarifas.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'tarifas') {
          return makeThenableResult({ data: filas, error: null });
        }
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Lista tarifas',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const secondCall = createMock.mock.calls[2]?.[0] as {
      messages: Array<{ role: string; content?: string }>;
    };
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg!.content as string) as {
      items?: Array<{ nombre?: string; precio?: number | null }>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items![0].nombre).toBe('Alicatado');
    expect(parsed.items![0].precio).toBe(32);
  });
});
