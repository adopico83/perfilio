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

describe('POST /api/agente — extras', () => {
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

  it('registrar_extra devuelve mensaje con descripción e importe', async () => {
    const insertMock = jest.fn().mockReturnValue({
      then: (onOk: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onOk),
    });

    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(
        toolCallMessage(
          'registrar_extra',
          JSON.stringify({
            descripcion: 'Toma adicional de luz',
            importe: 350.5,
            presupuesto_parent_id: 'parent-uuid-1',
          })
        )
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'presupuestos') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      id: 'parent-uuid-1',
                      cliente_nombre: 'Obra Norte',
                      cliente_id: 'cli-1',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            insert: insertMock,
          };
        }
        if (table === 'clientes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { email: 'cliente@example.com' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Registra un extra',
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
    expect(parsed.mensaje).toContain('Toma adicional de luz');
    expect(parsed.mensaje).toContain('350.50');
    expect(parsed.mensaje).toContain('Obra Norte');
    expect(parsed.mensaje).toContain('borrador');
    expect(insertMock).toHaveBeenCalled();
    const payload = insertMock.mock.calls[0]?.[0] as { es_extra?: boolean; parent_id?: string };
    expect(payload.es_extra).toBe(true);
    expect(payload.parent_id).toBe('parent-uuid-1');
  });

  it('listar_extras devuelve lista filtrada por es_extra=true', async () => {
    createMock
      .mockResolvedValueOnce(mockRouterGeneral())
      .mockResolvedValueOnce(toolCallMessage('listar_extras', '{}'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Aquí tienes los extras.' } }],
      });

    const extrasRows = [
      {
        id: 'ex-1',
        presupuesto_generado: 'Canalización extra',
        importe_total: 120,
        cliente_nombre: 'Luis G.',
        fecha: '2026-03-30',
        estado: 'pendiente',
        parent_id: 'p-1',
      },
    ];

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'presupuestos') {
          return makeThenableResult({ data: extrasRows, error: null });
        }
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Lista extras',
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
      items?: Array<{ descripcion?: string | null; importe?: number | null }>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items![0].descripcion).toBe('Canalización extra');
    expect(parsed.items![0].importe).toBe(120);
  });
});
