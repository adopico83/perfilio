import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

const insertMock = jest.fn();

/** Cadena tipo Postgrest: métodos encadenables + then/catch + single/maybeSingle como promesas. */
function createSupabaseQueryChain(options?: {
  singleData?: unknown;
}): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  const chainMethods = [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'order',
    'limit',
    'is',
  ];
  for (const m of chainMethods) {
    chain[m] = jest.fn(self);
  }

  chain.single = jest.fn().mockResolvedValue({
    data: options?.singleData ?? null,
    error: null,
  });
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });

  const emptyThenResult = { data: [] as unknown[], error: null };
  chain.then = (onFulfilled: (value: typeof emptyThenResult) => unknown) =>
    Promise.resolve(emptyThenResult).then(onFulfilled);
  chain.catch = (onRejected: (reason: unknown) => unknown) =>
    Promise.resolve(emptyThenResult).catch(onRejected);

  return chain;
}

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

describe('POST /api/agente', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        const chain = createSupabaseQueryChain(
          table === 'business_profiles'
            ? {
                singleData: {
                  nombre: 'Mi taller',
                  sector: 'Carpintería',
                  descripcion: '',
                  servicios: '',
                  tarifas: '',
                  contexto_adicional: '',
                },
              }
            : undefined
        );

        if (table === 'presupuestos') {
          chain.insert = jest.fn((payload: unknown) => {
            insertMock(payload);
            return chain;
          });
        }

        return chain;
      }),
    });
  });

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const mod = await import('@/app/api/agente/route');
    POST = mod.POST;
  });

  it('devuelve 400 si falta "mensaje"', async () => {
    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz1', historial: [] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('mensaje');
  });

  it('devuelve 400 si falta business_id', async () => {
    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({ mensaje: 'Hola', historial: [] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/business_id/i);
  });

  it('devuelve 200 con datos válidos', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Respuesta del modelo para el usuario.',
          },
        },
      ],
    });

    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Hola, necesito información.',
        business_id: 'biz1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.respuesta).toContain('Respuesta del modelo');
  });

  it('responde con datos válidos y guarda un presupuesto con importe_total y cliente_nombre', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  type: 'function',
                  id: 'call_1',
                  function: {
                    name: 'crear_presupuesto',
                    arguments: JSON.stringify({
                      texto_presupuesto: 'Presupuesto para Juan Pérez. Total 123,45 €',
                      cliente_nombre: 'Juan Pérez',
                      importe_total: 123.45,
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
              content: 'Presupuesto:\nTotal: 123,45 €',
            },
          },
        ],
      });

    insertMock.mockResolvedValue({ data: [{}], error: null });

    const mensaje = 'Necesito un presupuesto. Cliente: Juan Pérez.';
    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje,
        business_id: 'biz1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.respuesta).toContain('Total: 123,45');

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg).toEqual(
      expect.objectContaining({
        business_id: 'biz1',
        mensaje_cliente: mensaje,
        estado: 'borrador',
        importe_total: 123.45,
        cliente_nombre: 'Juan Pérez',
      })
    );
  });

  it('maneja errores si "mensaje" tiene tipo incorrecto', async () => {
    const req = new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 123,
        business_id: 'biz1',
        historial: [],
      } as unknown as { mensaje: string; business_id: string; historial: unknown[] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('mensaje');
  });
});
