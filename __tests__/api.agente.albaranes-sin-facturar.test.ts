import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { listarAlbaranesSinFacturar } from '@/lib/albaranes-sin-facturar';

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

jest.mock('@/lib/albaranes-sin-facturar', () => ({
  ...jest.requireActual<typeof import('@/lib/albaranes-sin-facturar')>('@/lib/albaranes-sin-facturar'),
  listarAlbaranesSinFacturar: jest.fn(async () => ({ albaranes: [], total: 0 })),
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

describe('POST /api/agente — albaranes_sin_facturar', () => {
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
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
    (listarAlbaranesSinFacturar as jest.Mock).mockResolvedValue({ albaranes: [], total: 0 });
  });

  function mockFromFactory(
    handlers: Record<string, ReturnType<typeof makeThenableResult> | typeof businessProfileChain>
  ) {
    return jest.fn((table: string) => {
      const h = handlers[table];
      if (!h) return makeThenableResult({ data: null, error: { message: 'unknown table' } });
      return h;
    });
  }

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

  it('albaranes_sin_facturar devuelve mensaje cuando no hay pendientes', async () => {
    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(toolCallMessage('albaranes_sin_facturar', '{}'))
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([{ tool: 'albaranes_sin_facturar', args: {} }]),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Respuesta final del agente.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: mockFromFactory({
        business_profiles: businessProfileChain,
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Consulta de prueba para el agente.',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const parsed = toolPayloadFromFinalCompletion('albaranes_sin_facturar') as { mensaje?: string };
    expect(parsed.mensaje).toBe('No hay albaranes pendientes de facturar.');
    expect(listarAlbaranesSinFacturar).toHaveBeenCalled();
  });
});
