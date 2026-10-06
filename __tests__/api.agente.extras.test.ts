import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { toolPayloadFromFinalCompletion } from './helpers/agente-openai';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));

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

// Estos tests comprueban lo que hace cada tool al EJECUTARSE dentro del turno del agente. La barrera de
// confirmación del servidor (que ahora retiene las tools de escritura hasta que el usuario dice «sí»)
// se apaga aquí con su interruptor de emergencia y se prueba aparte en `agente.confirmacion.test.ts`.
beforeAll(() => {
  process.env.AGENTE_CONFIRMACION = 'off';
});
afterAll(() => {
  delete process.env.AGENTE_CONFIRMACION;
});

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

  function toolPayloadFromFinal(toolName: string): unknown {
    return toolPayloadFromFinalCompletion(createMock, toolName);
  }

  it('registrar_extra devuelve mensaje con descripción e importe', async () => {
    // insert().select().single(): el alta del extra pasa por el número correlativo de presupuestos.
    const insertMock = jest.fn().mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: 'extra-1' }, error: null }) }),
    });
    // select… para leer el padre (2 eq + maybeSingle) y para leer el máximo numero_presupuesto.
    const leerPadreOMaximo = {
      eq: jest.fn(),
      not: jest.fn(),
      order: jest.fn(),
      limit: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'parent-uuid-1', cliente_nombre: 'Obra Norte', cliente_id: 'cli-1' },
        error: null,
      }),
    };
    leerPadreOMaximo.eq.mockReturnValue(leerPadreOMaximo);
    leerPadreOMaximo.not.mockReturnValue(leerPadreOMaximo);
    leerPadreOMaximo.order.mockReturnValue(leerPadreOMaximo);
    leerPadreOMaximo.limit.mockReturnValue(leerPadreOMaximo);

    const extraArgs = {
      descripcion: 'Toma adicional de luz',
      importe: 350.5,
      presupuesto_parent_id: 'parent-uuid-1',
    };
    createMock
      .mockResolvedValueOnce(toolCallMessage('registrar_extra', JSON.stringify(extraArgs)))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'presupuestos') {
          return {
            select: jest.fn().mockReturnValue(leerPadreOMaximo),
            insert: insertMock,
          };
        }
        if (table === 'clientes') {
          const afterFirstEq = {
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { email: 'cliente@example.com' },
                error: null,
              }),
            }),
            ilike: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue(afterFirstEq),
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

    const parsed = toolPayloadFromFinal('registrar_extra') as { mensaje?: string };
    expect(parsed.mensaje).toContain('Toma adicional de luz');
    expect(parsed.mensaje).toContain('350.50');
    expect(parsed.mensaje).toContain('Obra Norte');
    expect(parsed.mensaje).toContain('borrador');
    expect(insertMock).toHaveBeenCalled();
    const payload = insertMock.mock.calls[0]?.[0] as {
      es_extra?: boolean;
      parent_id?: string;
      numero_presupuesto?: number;
    };
    expect(payload.numero_presupuesto).toBe(1); // los extras también llevan número
    expect(payload.es_extra).toBe(true);
    expect(payload.parent_id).toBe('parent-uuid-1');
  });

  it('listar_extras devuelve lista filtrada por es_extra=true', async () => {
    createMock
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

    const parsed = toolPayloadFromFinal('listar_extras') as {
      items?: Array<{ descripcion?: string | null; importe?: number | null }>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items![0].descripcion).toBe('Canalización extra');
    expect(parsed.items![0].importe).toBe(120);
  });
});
