import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  AGENTE_PROSA_TEMPERATURE,
  AGENTE_TOOLS_TEMPERATURE,
} from '@/lib/agente/orquestacion';
import {
  findOpenAiCallWithTools,
  openaiCallParams,
  singleToolResultFromFinalCompletion,
} from './helpers/agente-openai';

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

describe('POST /api/agente — Fase A anti-alucinación', () => {
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

  function mockServiceFrom(
    extra: Record<string, ReturnType<typeof makeThenableResult> | typeof businessProfileChain> = {}
  ) {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (extra[table]) return extra[table];
        return makeThenableResult({ data: null, error: { message: 'unknown table' } });
      }),
    });
  }

  async function postAgente(mensaje: string) {
    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje,
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    return POST(req);
  }

  it('con borrador activo siempre llama al router y no fuerza presupuesto', async () => {
    const borrador = makeThenableResult({
      data: [{ id: 'borrador-1' }],
      error: null,
    });
    mockServiceFrom({ presupuesto_borrador: borrador });

    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'operarios' } }] })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '¿De qué operario quieres las horas?' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '¿De qué operario quieres las horas?' } }],
      });

    const res = await postAgente('Registra 8 horas de Juan en la obra Norte');
    expect(res.status).toBe(200);

    expect(createMock).toHaveBeenCalled();
    const routerParams = openaiCallParams(createMock, 0);
    expect(routerParams.tools).toBeUndefined();
    expect(routerParams.temperature).toBe(0);
    const routerSystem = String(
      (routerParams.messages as Array<{ role: string; content?: string }>)[0]?.content ?? ''
    );
    expect(routerSystem).toMatch(/borrador de presupuesto/i);

    const agentCall = findOpenAiCallWithTools(createMock);
    expect(agentCall).not.toBeNull();
    const toolNames = (
      (agentCall?.params.tools as Array<{ function?: { name?: string } }>) ?? []
    )
      .map((t) => t.function?.name)
      .filter(Boolean);
    expect(toolNames).toContain('registrar_jornada');
    expect(toolNames).not.toContain('agregar_partida_borrador');
    expect(toolNames).not.toContain('confirmar_borrador');
  });

  it('usa temperature 0 en el path con tools y ~0.7 en la prosa final', async () => {
    mockServiceFrom();
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'general' } }] })
      .mockResolvedValueOnce(toolCallMessage('listar_operarios', '{}'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Estos son los operarios.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'operarios') {
          return makeThenableResult({ data: [{ nombre: 'Juan' }], error: null });
        }
        return makeThenableResult({ data: [], error: null });
      }),
    });

    const res = await postAgente('Lista los operarios');
    expect(res.status).toBe(200);

    const routerParams = openaiCallParams(createMock, 0);
    expect(routerParams.temperature).toBe(0);
    expect(routerParams.tools).toBeUndefined();

    const agentCall = findOpenAiCallWithTools(createMock);
    expect(agentCall?.params.temperature).toBe(AGENTE_TOOLS_TEMPERATURE);
    expect(agentCall?.params.temperature).toBeLessThanOrEqual(0.2);

    const finalParams = openaiCallParams(createMock, 2);
    expect(finalParams.tools).toBeUndefined();
    expect(finalParams.temperature).toBe(AGENTE_PROSA_TEMPERATURE);
  });

  it('ejecuta tool_calls nativos sin llamar al planificador JSON', async () => {
    const insertCliente = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'cli-1' },
          error: null,
        }),
      }),
    });

    mockServiceFrom({
      clientes: {
        select: jest.fn(() => makeThenableResult({ data: [], error: null })),
        insert: insertCliente,
      } as unknown as ReturnType<typeof makeThenableResult>,
    });

    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'clientes' } }] })
      .mockResolvedValueOnce(
        toolCallMessage('crear_cliente', JSON.stringify({ nombre: 'Cliente Test' }))
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Cliente creado.' } }],
      });

    const res = await postAgente('Crea el cliente Cliente Test');
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);

    for (const call of createMock.mock.calls) {
      const params = call[0] as { messages?: Array<{ role: string; content?: unknown }> };
      const system = params.messages?.find((m) => m.role === 'system');
      expect(String(system?.content ?? '')).not.toMatch(/planificador de herramientas/i);
    }

    const parsed = singleToolResultFromFinalCompletion(createMock) as {
      id?: string;
      mensaje?: string;
    };
    expect(parsed.id).toBe('cli-1');
    expect(insertCliente).toHaveBeenCalled();

    const json = await res.json();
    expect(json.respuesta).toBe('Cliente creado.');
    expect(json).toEqual(
      expect.objectContaining({
        respuesta: expect.any(String),
        email_pendiente: null,
        canvas: null,
        obra_modal: null,
      })
    );
    expect(Object.keys(json).sort()).toEqual(
      ['canvas', 'email_pendiente', 'obra_modal', 'respuesta'].sort()
    );
  });

  it('reintenta una sola vez con tool_choice required si parece acción y no hay tool_calls', async () => {
    mockServiceFrom();
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'operarios' } }] })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Voy a registrar las horas.' } }],
      })
      .mockResolvedValueOnce(toolCallMessage('listar_operarios', '{}'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Operarios listados.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'operarios') {
          return makeThenableResult({ data: [{ nombre: 'Juan' }], error: null });
        }
        return makeThenableResult({ data: [], error: null });
      }),
    });

    const res = await postAgente('Registra las horas de Juan en la obra Norte');
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(4);

    const retryParams = openaiCallParams(createMock, 2);
    expect(retryParams.tool_choice).toBe('required');
    expect(retryParams.temperature).toBe(AGENTE_TOOLS_TEMPERATURE);

    const json = await res.json();
    expect(json.respuesta).toBe('Operarios listados.');
  });

  it('un saludo no dispara tools ni reintento', async () => {
    mockServiceFrom();
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: 'general' } }] })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Aupa, ¿en qué te ayudo?' } }],
      });

    const res = await postAgente('Hola');
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);

    const agentParams = openaiCallParams(createMock, 1);
    expect(agentParams.tool_choice).toBe('auto');
    expect(Array.isArray(agentParams.tools)).toBe(true);

    const json = await res.json();
    expect(json.respuesta).toBe('Aupa, ¿en qué te ayudo?');
  });
});
