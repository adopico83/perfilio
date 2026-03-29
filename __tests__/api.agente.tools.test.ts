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

    it('devuelve borrador pendiente de aprobación (sin Gmail)', async () => {
      const res = await postWithTool('enviar_email', {}, args);
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolMsg!.content as string)).toEqual({
        tipo: 'email_pendiente_aprobacion',
        para: 'x@y.com',
        asunto: 'Hola',
        cuerpo: 'Texto',
      });
    });

    it('devuelve error si faltan parámetros', async () => {
      const res = await postWithTool(
        'enviar_email',
        {},
        JSON.stringify({ destinatario: '', asunto: 'x', cuerpo: 'y' })
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { error?: string };
      expect(parsed.error).toContain('Faltan parámetros');
    });
  });

  describe('calcular_medicion', () => {
    it('superficie en m con huecos', async () => {
      const args = JSON.stringify({
        tipo: 'superficie',
        dimensiones: [{ largo: 5, ancho: 4 }],
        huecos: [{ cantidad: 2, largo: 1, ancho: 1 }],
        unidad: 'm',
        descripcion: 'Sala',
      });
      const res = await postWithTool('calcular_medicion', {}, args);
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as {
        total: number;
        unidad: string;
        descripcion?: string;
        desglose: string[];
      };
      expect(parsed.unidad).toBe('m²');
      expect(parsed.total).toBeCloseTo(18, 5);
      expect(parsed.descripcion).toBe('Sala');
      expect(parsed.desglose.some((l) => l.includes('Total neto'))).toBe(true);
    });

    it('convierte cm a m²', async () => {
      const args = JSON.stringify({
        tipo: 'superficie',
        dimensiones: [{ largo: 100, ancho: 100 }],
        unidad: 'cm',
      });
      const res = await postWithTool('calcular_medicion', {}, args);
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { total: number; unidad: string };
      expect(parsed.unidad).toBe('m²');
      expect(parsed.total).toBeCloseTo(1, 5);
    });

    it('volumen en m³', async () => {
      const resVol = await postWithTool(
        'calcular_medicion',
        {},
        JSON.stringify({
          tipo: 'volumen',
          dimensiones: [{ largo: 2, ancho: 3, alto: 1 }],
          unidad: 'm',
        })
      );
      expect(resVol.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { total: number; unidad: string };
      expect(parsed.unidad).toBe('m³');
      expect(parsed.total).toBeCloseTo(6, 5);
    });

    it('perímetro en ml (2×(largo+ancho))', async () => {
      const res = await postWithTool(
        'calcular_medicion',
        {},
        JSON.stringify({
          tipo: 'perimetro',
          dimensiones: [{ largo: 2, ancho: 3 }],
          unidad: 'm',
        })
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { total: number; unidad: string };
      expect(parsed.unidad).toBe('ml');
      expect(parsed.total).toBeCloseTo(10, 5);
    });

    it('lineal suma largos', async () => {
      const res = await postWithTool(
        'calcular_medicion',
        {},
        JSON.stringify({
          tipo: 'lineal',
          dimensiones: [
            { largo: 2, ancho: 0 },
            { largo: 3, ancho: 0 },
          ],
          unidad: 'm',
        })
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { total: number; unidad: string };
      expect(parsed.unidad).toBe('ml');
      expect(parsed.total).toBeCloseTo(5, 5);
    });

    it('devuelve error si volumen sin alto', async () => {
      const res = await postWithTool(
        'calcular_medicion',
        {},
        JSON.stringify({
          tipo: 'volumen',
          dimensiones: [{ largo: 1, ancho: 1 }],
          unidad: 'm',
        })
      );
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { error?: string };
      expect(parsed.error).toContain('alto');
    });
  });

  describe('vincular_gasto', () => {
    const gastoUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const facturaUuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
    const albaranUuid = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';

    it('llama a insert con gasto_id y documentos válidos (factura y albarán)', async () => {
      const gastoChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: gastoUuid }, error: null }),
      };
      const facturaChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: facturaUuid }, error: null }),
      };
      const albaranChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: albaranUuid }, error: null }),
      };
      const insertMockGd = jest.fn().mockResolvedValue({ data: null, error: null });

      createMock
        .mockResolvedValueOnce(
          toolCallMessage(
            'vincular_gasto',
            JSON.stringify({
              gasto_id: gastoUuid,
              documentos: [
                { tipo: 'factura', id: facturaUuid },
                { tipo: 'albaran', id: albaranUuid },
              ],
            })
          )
        )
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Respuesta final del agente.' } }],
        });

      (createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'business_profiles') return businessProfileChain;
          if (table === 'gastos') return gastoChain;
          if (table === 'facturas') return facturaChain;
          if (table === 'albaranes') return albaranChain;
          if (table === 'gastos_documentos')
            return { insert: insertMockGd };
          return makeThenableResult({ data: null, error: { message: 'unknown table' } });
        }),
      });

      const req = new NextRequest('http://localhost/api/agente', {
        method: 'POST',
        body: JSON.stringify({
          mensaje: 'Vincular gasto',
          business_id: 'biz-1',
          historial: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(insertMockGd).toHaveBeenCalledWith([
        {
          business_id: 'biz-1',
          gasto_id: gastoUuid,
          documento_tipo: 'factura',
          documento_id: facturaUuid,
        },
        {
          business_id: 'biz-1',
          gasto_id: gastoUuid,
          documento_tipo: 'albaran',
          documento_id: albaranUuid,
        },
      ]);

      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { mensaje?: string };
      expect(parsed.mensaje).toBe('Gasto vinculado correctamente a 2 documento(s).');
    });

    it('devuelve mensaje de éxito cuando el INSERT no devuelve error', async () => {
      const gastoChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: gastoUuid }, error: null }),
      };
      const facturaChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: facturaUuid }, error: null }),
      };
      const insertMockGd = jest.fn().mockResolvedValue({ data: null, error: null });

      createMock
        .mockResolvedValueOnce(
          toolCallMessage(
            'vincular_gasto',
            JSON.stringify({
              gasto_id: gastoUuid,
              documentos: [{ tipo: 'factura', id: facturaUuid }],
            })
          )
        )
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Listo.' } }],
        });

      (createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'business_profiles') return businessProfileChain;
          if (table === 'gastos') return gastoChain;
          if (table === 'facturas') return facturaChain;
          if (table === 'gastos_documentos')
            return { insert: insertMockGd };
          return makeThenableResult({ data: null, error: { message: 'unknown table' } });
        }),
      });

      const req = new NextRequest('http://localhost/api/agente', {
        method: 'POST',
        body: JSON.stringify({
          mensaje: 'x',
          business_id: 'biz-1',
          historial: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { mensaje?: string };
      expect(parsed.mensaje).toMatch(/Gasto vinculado correctamente a 1 documento/);
    });
  });

  describe('crear_entrada_diario', () => {
    it('devuelve mensaje de éxito con nombre de obra y fecha', async () => {
      createMock
        .mockResolvedValueOnce(
          toolCallMessage(
            'crear_entrada_diario',
            JSON.stringify({
              obra_nombre: 'Reforma Norte',
              texto: 'Instalación eléctrica',
            })
          )
        )
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Respuesta final del agente.' } }],
        });

      (createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'business_profiles') return businessProfileChain;
          if (table === 'diario_obra') {
            return {
              insert: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'diario-uuid-1',
                  business_id: 'biz-1',
                  obra_nombre: 'Reforma Norte',
                  obra_direccion: null,
                  texto: 'Instalación eléctrica',
                  fotos: [],
                  videos: [],
                  fecha: '2026-03-20T14:00:00.000Z',
                },
                error: null,
              }),
            };
          }
          return makeThenableResult({ data: null, error: { message: 'unknown table' } });
        }),
      });

      const req = new NextRequest('http://localhost/api/agente', {
        method: 'POST',
        body: JSON.stringify({
          mensaje: 'Registra en el diario',
          business_id: 'biz-1',
          historial: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const secondCall = createMock.mock.calls[1]?.[0] as {
        messages: Array<{ role: string; content?: string }>;
      };
      const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
      const parsed = JSON.parse(toolMsg!.content as string) as { mensaje?: string; id?: string };
      expect(parsed.id).toBe('diario-uuid-1');
      expect(parsed.mensaje).toContain('Reforma Norte');
      expect(parsed.mensaje).toMatch(/para el/);
      expect(parsed.mensaje).toContain('¿Quieres generar el PDF del diario completo de esta obra?');
    });
  });
});
