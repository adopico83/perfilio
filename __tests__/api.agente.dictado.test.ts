import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { toolPayloadFromFinalCompletion } from './helpers/agente-openai';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));

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

function estructurarDictadoMock(): jest.Mock {
  return jest.requireMock('@/lib/dictado-presupuesto').estructurarDictadoEnPartidas as jest.Mock;
}

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

/** Tabla `presupuestos`: lectura del último número + insert(...).select().single(). */
function makePresupuestosTable(insertMock: jest.Mock, opts?: { ultimoNumero?: number | null }) {
  const lectura = makeThenableResult({
    data: opts?.ultimoNumero != null ? { numero_presupuesto: opts.ultimoNumero } : null,
    error: null,
  });
  (lectura as Record<string, jest.Mock>).not = jest.fn(() => lectura);
  (lectura as Record<string, jest.Mock>).maybeSingle = jest.fn().mockResolvedValue({
    data: opts?.ultimoNumero != null ? { numero_presupuesto: opts.ultimoNumero } : null,
    error: null,
  });
  return {
    select: lectura.select,
    eq: lectura.eq,
    not: (lectura as Record<string, jest.Mock>).not,
    order: lectura.order,
    limit: lectura.limit,
    maybeSingle: (lectura as Record<string, jest.Mock>).maybeSingle,
    insert: jest.fn((payload: unknown) => {
      insertMock(payload);
      const ins: Record<string, jest.Mock> = {};
      ins.select = jest.fn(() => ins);
      ins.single = jest.fn().mockResolvedValue({ data: { id: 'pres-1' }, error: null });
      return ins;
    }),
  };
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

// Estos tests comprueban lo que hace cada tool al EJECUTARSE dentro del turno del agente. La barrera de
// confirmación del servidor (que ahora retiene las tools de escritura hasta que el usuario dice «sí»)
// se apaga aquí con su interruptor de emergencia y se prueba aparte en `agente.confirmacion.test.ts`.
beforeAll(() => {
  process.env.AGENTE_CONFIRMACION = 'off';
});
afterAll(() => {
  delete process.env.AGENTE_CONFIRMACION;
});

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

  function toolPayloadFromFinal(toolName: string): unknown {
    return toolPayloadFromFinalCompletion(createMock, toolName);
  }

  function mockServicioConPresupuestos(insertMock: jest.Mock) {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return businessProfileChain;
        if (table === 'tarifas') {
          return makeThenableResult({ data: [], error: null });
        }
        if (table === 'presupuestos') {
          return makePresupuestosTable(insertMock, { ultimoNumero: 7 });
        }
        return makeThenableResult({ data: null, error: { message: 'unknown' } });
      }),
    });
  }

  function reqDictado() {
    return new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: 'Genera presupuesto del dictado',
        business_id: 'biz-1',
        historial: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dictadoArgs = {
    dictado: 'Unos 20 metros de solado en el salón',
    cliente_nombre: 'García',
    direccion_obra: 'Calle Mayor 1',
  };

  function encolarLlamadaDictado(args: Record<string, unknown> = dictadoArgs) {
    createMock
      .mockResolvedValueOnce(
        toolCallMessage('generar_presupuesto_por_dictado', JSON.stringify(args))
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo.' } }],
      });
  }

  it('generar_presupuesto_por_dictado guarda el texto canónico con número correlativo y devuelve presupuesto_id', async () => {
    const insertMock = jest.fn();
    encolarLlamadaDictado();
    mockServicioConPresupuestos(insertMock);

    const res = await POST(reqDictado());
    expect(res.status).toBe(200);

    const parsed = toolPayloadFromFinal('generar_presupuesto_por_dictado') as {
      mensaje?: string;
      presupuesto_id?: string;
      importe_total?: number;
    };
    expect(parsed.mensaje).toContain('BORRADOR - Presupuesto de reforma');
    expect(parsed.mensaje).toContain('PARTIDAS:');
    expect(parsed.mensaje).toContain('García');
    expect(parsed.presupuesto_id).toBe('pres-1');
    expect(parsed.importe_total).toBe(847);

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.numero_presupuesto).toBe(8);
    expect(payload.business_id).toBe('biz-1');
    expect(payload.importe_total).toBe(847);

    const pdf = parsePresupuestoGenerado(String(payload.presupuesto_generado));
    expect(pdf.capitulos).toHaveLength(1);
    expect(pdf.capitulos[0].partidas).toEqual([
      { concepto: 'Solado de gres', cantidad: 20, precio: 35, importe: 700 },
    ]);
    expect(pdf.baseImponible).toBe(700);
    expect(pdf.porcentajeIva).toBe(21);
    expect(pdf.importeIva).toBe(147);
    expect(pdf.total).toBe(847);
  });

  it('generar_presupuesto_por_dictado guarda el importe calculado aunque el total de la partida venga mal', async () => {
    estructurarDictadoMock().mockResolvedValueOnce([
      {
        descripcion: 'Solado de gres',
        cantidad: 20,
        unidad: 'm2',
        precio_unitario: 35,
        total: 650,
        categoria: 'suelo',
      },
    ]);
    const insertMock = jest.fn();
    encolarLlamadaDictado();
    mockServicioConPresupuestos(insertMock);

    const res = await POST(reqDictado());
    expect(res.status).toBe(200);

    const parsed = toolPayloadFromFinal('generar_presupuesto_por_dictado') as {
      error?: string;
      presupuesto_id?: string;
      importe_total?: number;
    };
    expect(parsed.error).toBeUndefined();
    expect(parsed.presupuesto_id).toBe('pres-1');
    expect(parsed.importe_total).toBe(847);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(parsePresupuestoGenerado(String(payload.presupuesto_generado)).baseImponible).toBe(700);
  });

  it('generar_presupuesto_por_dictado rechaza cantidades no finitas o negativas antes del insert', async () => {
    estructurarDictadoMock().mockResolvedValueOnce([
      {
        descripcion: 'Solado de gres',
        cantidad: -20,
        unidad: 'm2',
        precio_unitario: 35,
        total: -700,
        categoria: 'suelo',
      },
    ]);
    const insertMock = jest.fn();
    encolarLlamadaDictado();
    mockServicioConPresupuestos(insertMock);

    const res = await POST(reqDictado());
    expect(res.status).toBe(200);

    const parsed = toolPayloadFromFinal('generar_presupuesto_por_dictado') as { error?: string };
    expect(parsed.error).toMatch(/cantidad no válida/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('generar_presupuesto_por_dictado con solo_vista_previa no inserta y valida igual', async () => {
    const insertMock = jest.fn();
    encolarLlamadaDictado({ ...dictadoArgs, solo_vista_previa: true });
    mockServicioConPresupuestos(insertMock);

    const res = await POST(reqDictado());
    expect(res.status).toBe(200);

    const parsed = toolPayloadFromFinal('generar_presupuesto_por_dictado') as {
      pendiente_confirmacion?: boolean;
      importe_total?: number;
    };
    expect(parsed.pendiente_confirmacion).toBe(true);
    expect(parsed.importe_total).toBe(847);
    expect(insertMock).not.toHaveBeenCalled();
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

    const tarifasArgs = { accion: 'listar' };
    createMock
      .mockResolvedValueOnce(toolCallMessage('gestionar_tarifas', JSON.stringify(tarifasArgs)))
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

    const parsed = toolPayloadFromFinal('gestionar_tarifas') as {
      items?: Array<{ nombre?: string; precio?: number | null }>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items![0].nombre).toBe('Alicatado');
    expect(parsed.items![0].precio).toBe(32);
  });
});
