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

/** Builder thenable compatible con await supabase.from(...).select()... */
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

describe('POST /api/agente — tools', () => {
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

  async function postWithTool(
    toolName: string,
    handlers: Record<string, ReturnType<typeof makeThenableResult> | typeof businessProfileChain>,
    toolArgs = '{}'
  ) {
    createMock
      .mockResolvedValueOnce(toolCallMessage(toolName, toolArgs))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Respuesta final del agente.' } }],
      });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: mockFromFactory({
        business_profiles: businessProfileChain,
        ...handlers,
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

    return POST(req);
  }

  describe('obtener_mensajes_pendientes', () => {
    it('devuelve array vacío si no hay mensajes (sin conversation_id)', async () => {
      const conv = makeThenableResult({ data: [], error: null });

      const res = await postWithTool('obtener_mensajes_pendientes', {
        conversation_history: conv,
      });
      expect(res.status).toBe(200);

      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toBeDefined();
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ items: [] });
    });

    it('devuelve mensajes correctamente cuando existen', async () => {
      const conv = makeThenableResult({
        data: [{ conversation_id: 'conv-1' }],
        error: null,
      });
      const aiRows = makeThenableResult({
        data: [
          {
            id: 'ar1',
            conversation_id: 'conv-1',
            created_at: '2025-01-01',
            ai_response: 'Hola',
            edited_response: null,
            approved_at: null,
            rejected_at: null,
          },
        ],
        error: null,
      });

      const res = await postWithTool('obtener_mensajes_pendientes', {
        conversation_history: conv,
        ai_responses: aiRows,
      });
      expect(res.status).toBe(200);

      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as {
        items: Array<{ respuesta_ia: string | null }>;
      };
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].respuesta_ia).toBe('Hola');
    });

    it('maneja error de Supabase correctamente (conversation_history)', async () => {
      const conv = makeThenableResult({
        data: null,
        error: { message: 'fallo red' },
      });

      const res = await postWithTool('obtener_mensajes_pendientes', {
        conversation_history: conv,
      });
      expect(res.status).toBe(200);

      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ error: 'fallo red' });
    });
  });

  describe('obtener_presupuestos_pendientes', () => {
    it('devuelve array vacío si no hay presupuestos', async () => {
      const pres = makeThenableResult({ data: [], error: null });
      const res = await postWithTool('obtener_presupuestos_pendientes', { presupuestos: pres });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ items: [] });
    });

    it('devuelve presupuestos con cliente, importe y fecha', async () => {
      const pres = makeThenableResult({
        data: [
          {
            cliente_nombre: 'Ana',
            importe_total: 99.5,
            fecha: '2025-03-01',
          },
        ],
        error: null,
      });
      const res = await postWithTool('obtener_presupuestos_pendientes', { presupuestos: pres });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { items: unknown[] };
      expect(parsed.items).toEqual([
        { cliente: 'Ana', importe: 99.5, fecha: '2025-03-01' },
      ]);
    });

    it('maneja error de Supabase correctamente', async () => {
      const pres = makeThenableResult({
        data: null,
        error: { message: 'error presupuestos' },
      });
      const res = await postWithTool('obtener_presupuestos_pendientes', { presupuestos: pres });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ error: 'error presupuestos' });
    });
  });

  describe('obtener_facturas_pendientes', () => {
    it('devuelve array vacío si no hay facturas', async () => {
      const fac = makeThenableResult({ data: [], error: null });
      const res = await postWithTool('obtener_facturas_pendientes', { facturas: fac });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ items: [] });
    });

    it('devuelve facturas con cliente, importe y fecha', async () => {
      const fac = makeThenableResult({
        data: [{ cliente_nombre: 'Luis', total: 200, fecha: '2025-02-01' }],
        error: null,
      });
      const res = await postWithTool('obtener_facturas_pendientes', { facturas: fac });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { items: unknown[] };
      expect(parsed.items).toEqual([{ cliente: 'Luis', importe: 200, fecha: '2025-02-01' }]);
    });

    it('maneja error de Supabase correctamente', async () => {
      const fac = makeThenableResult({
        data: null,
        error: { message: 'error facturas' },
      });
      const res = await postWithTool('obtener_facturas_pendientes', { facturas: fac });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ error: 'error facturas' });
    });
  });

  describe('obtener_albaranes_pendientes', () => {
    it('devuelve array vacío si no hay albaranes', async () => {
      const alb = makeThenableResult({ data: [], error: null });
      const res = await postWithTool('obtener_albaranes_pendientes', { albaranes: alb });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ items: [] });
    });

    it('devuelve albaranes con cliente y fecha', async () => {
      const alb = makeThenableResult({
        data: [{ cliente_nombre: 'Pepe', fecha: '2025-01-15' }],
        error: null,
      });
      const res = await postWithTool('obtener_albaranes_pendientes', { albaranes: alb });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { items: unknown[] };
      expect(parsed.items).toEqual([{ cliente: 'Pepe', fecha: '2025-01-15' }]);
    });

    it('maneja error de Supabase correctamente', async () => {
      const alb = makeThenableResult({
        data: null,
        error: { message: 'error albaranes' },
      });
      const res = await postWithTool('obtener_albaranes_pendientes', { albaranes: alb });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ error: 'error albaranes' });
    });
  });

  describe('leer_emails_recientes', () => {
    it('devuelve error si no hay token de Gmail', async () => {
      const gmailTokens = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'no row' },
        }),
      };

      const res = await postWithTool('leer_emails_recientes', {
        gmail_tokens: gmailTokens as unknown as ReturnType<typeof makeThenableResult>,
      });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { error?: string };
      expect(parsed.error).toBe('Gmail no conectado para este usuario');
    });

    it('devuelve lista de emails correctamente con token válido', async () => {
      const gmailTokens = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            access_token: 'tok',
            refresh_token: null,
            expiry_date: new Date(Date.now() + 86400000).toISOString(),
          },
          error: null,
        }),
      };

      const fetchMock = global.fetch as jest.Mock;
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'm1' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            snippet: 'snip',
            payload: {
              headers: [
                { name: 'From', value: 'a@b.com' },
                { name: 'Subject', value: 'Asunto' },
              ],
            },
          }),
        });

      const res = await postWithTool('leer_emails_recientes', {
        gmail_tokens: gmailTokens as unknown as ReturnType<typeof makeThenableResult>,
      });
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as {
        items: Array<{ remitente: string | null; asunto: string | null }>;
      };
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].remitente).toBe('a@b.com');
      expect(parsed.items[0].asunto).toBe('Asunto');
    });
  });

  describe('enviar_email', () => {
    const args = JSON.stringify({
      destinatario: 'x@y.com',
      asunto: 'Hola',
      cuerpo: 'Texto',
    });

    it('devuelve error si no hay token de Gmail', async () => {
      const gmailTokens = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'no row' },
        }),
      };

      const res = await postWithTool(
        'enviar_email',
        {
          gmail_tokens: gmailTokens as unknown as ReturnType<typeof makeThenableResult>,
        },
        args
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { error?: string };
      expect(parsed.error).toBe('Gmail no conectado para este usuario');
    });

    it('devuelve { ok: true } si el email se envía correctamente', async () => {
      const gmailTokens = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            access_token: 'tok',
            refresh_token: null,
            expiry_date: new Date(Date.now() + 86400000).toISOString(),
          },
          error: null,
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const res = await postWithTool(
        'enviar_email',
        {
          gmail_tokens: gmailTokens as unknown as ReturnType<typeof makeThenableResult>,
        },
        args
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({ ok: true });
    });
  });
});
