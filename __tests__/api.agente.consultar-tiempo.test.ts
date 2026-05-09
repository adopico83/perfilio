import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

jest.mock('@/lib/weather', () => {
  const actual = jest.requireActual<typeof import('@/lib/weather')>('@/lib/weather');
  return {
    ...actual,
    geocodeDireccion: jest.fn(async () => null),
    getPrediccionPorCiudad: jest.fn(async () => [
      {
        fecha: '2026-03-31',
        descripcion: 'cielo claro',
        temp_min: 12,
        temp_max: 18,
        lluvia: false,
        viento_fuerte: false,
        icono: '☀️',
        recomendacion: 'Buenas condiciones',
      },
    ]),
    getPrediccionPorCoordenadas: jest.fn(),
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

describe('POST /api/agente — consultar_tiempo', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENWEATHER_API_KEY = 'test-ow';
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
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
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

  function toolPayloadFromFinalCompletion(toolName: string): unknown {
    const req = createMock.mock.calls[3]?.[0] as {
      messages: Array<{ role: string; content?: string | null }>;
    };
    const lastUser = [...(req?.messages ?? [])].reverse().find((m) => m.role === 'user');
    const line = String(lastUser?.content ?? '')
      .split('\n')
      .find((l) => l.startsWith(`${toolName}: `));
    if (!line) throw new Error(`missing tool line ${toolName}`);
    return JSON.parse(line.slice(toolName.length + 2));
  }

  it('consultar_tiempo devuelve mensaje con emoji y temperatura', async () => {
    const tiempoArgs = JSON.stringify({ ubicacion: 'Madrid', dias: 1 });
    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(toolCallMessage('consultar_tiempo', tiempoArgs))
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { tool: 'consultar_tiempo', args: JSON.parse(tiempoArgs) as Record<string, unknown> },
              ]),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: '¿Qué tiempo hace?',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const parsed = toolPayloadFromFinalCompletion('consultar_tiempo') as { mensaje?: string };
    expect(parsed.mensaje).toContain('☀️');
    expect(parsed.mensaje).toMatch(/°C/);
    expect(parsed.mensaje).toContain('12');
    expect(parsed.mensaje).toContain('18');
  });
});
