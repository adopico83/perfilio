import { NextRequest } from 'next/server';
import { guardarResumenComoNotificacion, slugResumen } from '@/lib/resumen-diario/guardar';
import { calcularResumenDia } from '@/lib/resumen-diario/calcular';
import { executeMcpTool } from '@/lib/mcp/execute-tool';
import type { McpContext } from '@/lib/mcp/context';

const mockCargar = jest.fn();
const mockGuardar = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
  createClient: jest.fn(),
}));
jest.mock('@/lib/resumen-diario/datos', () => ({
  cargarResumenDia: (...a: unknown[]) => mockCargar(...a),
}));

const NOW = new Date('2026-10-05T05:30:00Z');
const vacio = calcularResumenDia({ citas: [], obras: [], diario: [], presupuestos: [], facturas: [] }, NOW);

/** Cliente mínimo para bicho_notifications: select(...).eq().eq().limit().maybeSingle() / insert(). */
function fakeNotificaciones(opts: { existente?: boolean; insertError?: { code?: string; message: string } }) {
  const insertado: unknown[] = [];
  const filtros: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => (filtros.push([c, v]), q);
  q.limit = () => q;
  q.maybeSingle = async () => ({ data: opts.existente ? { id: 'n1' } : null, error: null });
  q.insert = async (row: unknown) => {
    insertado.push(row);
    return { error: opts.insertError ?? null };
  };
  return { client: { from: () => q } as never, insertado, filtros };
}

describe('guardarResumenComoNotificacion', () => {
  it('guarda la notificación del negocio con tipo, slug del día y el resumen en metadata', async () => {
    const f = fakeNotificaciones({});
    const creado = await guardarResumenComoNotificacion(f.client, 'biz-1', vacio);
    expect(creado).toBe(true);
    expect(f.insertado[0]).toMatchObject({
      business_id: 'biz-1',
      type: 'resumen_diario',
      slug: slugResumen('2026-10-05'),
      message: 'Resumen del día: todo en orden.',
      is_read: false,
      metadata: vacio,
    });
    expect(f.filtros).toContainEqual(['business_id', 'biz-1']);
  });
  it('no duplica si ya hay una del día', async () => {
    const f = fakeNotificaciones({ existente: true });
    expect(await guardarResumenComoNotificacion(f.client, 'biz-1', vacio)).toBe(false);
    expect(f.insertado).toHaveLength(0);
  });
  it('tolera la carrera con otra ejecución (índice único)', async () => {
    const f = fakeNotificaciones({ insertError: { code: '23505', message: 'duplicate' } });
    expect(await guardarResumenComoNotificacion(f.client, 'biz-1', vacio)).toBe(false);
  });
  it('propaga otros errores', async () => {
    const f = fakeNotificaciones({ insertError: { code: '42501', message: 'denied' } });
    await expect(guardarResumenComoNotificacion(f.client, 'biz-1', vacio)).rejects.toThrow(/denied/);
  });
});

describe('cron /api/cron/resumen-diario', () => {
  const OLD = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'secreto';
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGuardar.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env.CRON_SECRET = OLD;
  });

  const llamar = async (url: string, auth?: string) => {
    const { GET } = await import('@/app/api/cron/resumen-diario/route');
    return GET(new NextRequest(url, { headers: auth ? { authorization: auth } : {} }));
  };

  it('rechaza sin el secreto', async () => {
    expect((await llamar('http://x/api/cron/resumen-diario')).status).toBe(403);
    expect((await llamar('http://x/api/cron/resumen-diario', 'Bearer otro')).status).toBe(403);
  });

  it('a las 7:30 de Madrid (verano, 05:30 UTC) genera el resumen de cada negocio', async () => {
    jest.setSystemTime(new Date('2026-10-05T05:30:00Z'));
    const insert = jest.fn().mockResolvedValue({ error: null });
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.insert = insert;
    mockFrom.mockImplementation((t: string) =>
      t === 'business_profiles' ? { select: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }) } : q
    );
    mockCargar.mockResolvedValue(vacio);

    const res = await llamar('http://x/api/cron/resumen-diario', 'Bearer secreto');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, negocios: 2, creados: 2 });
    expect(mockCargar).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls.map((c) => c[0].business_id)).toEqual(['a', 'b']);
  });

  it('en invierno la entrada de 06:30 UTC es la buena y la de 05:30 UTC se descarta', async () => {
    jest.setSystemTime(new Date('2026-12-05T05:30:00Z')); // 6:30 en Madrid
    expect(await (await llamar('http://x/api/cron/resumen-diario', 'Bearer secreto')).json()).toMatchObject({
      skipped: true,
    });
    jest.setSystemTime(new Date('2026-12-05T06:30:00Z')); // 7:30 en Madrid
    mockFrom.mockImplementation(() => ({ select: async () => ({ data: [], error: null }) }));
    expect(await (await llamar('http://x/api/cron/resumen-diario', 'Bearer secreto')).json()).toMatchObject({
      ok: true,
      negocios: 0,
    });
  });

  it('?force=1 se salta la comprobación de hora', async () => {
    jest.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    mockFrom.mockImplementation(() => ({ select: async () => ({ data: [], error: null }) }));
    const json = await (await llamar('http://x/api/cron/resumen-diario?force=1', 'Bearer secreto')).json();
    expect(json.skipped).toBeUndefined();
    expect(json.ok).toBe(true);
  });

  it('un negocio que falla no impide los demás', async () => {
    jest.setSystemTime(new Date('2026-10-05T05:30:00Z'));
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.insert = async () => ({ error: null });
    mockFrom.mockImplementation((t: string) =>
      t === 'business_profiles' ? { select: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }) } : q
    );
    mockCargar.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(vacio);
    const json = await (await llamar('http://x/api/cron/resumen-diario', 'Bearer secreto')).json();
    expect(json.creados).toBe(1);
    expect(json.errores).toEqual([{ business_id: 'a', error: 'boom' }]);
  });
});

describe('MCP resumen_del_dia', () => {
  const ctx = { businessId: 'biz-1', userId: 'u', supabase: {} } as unknown as McpContext;
  beforeEach(() => jest.clearAllMocks());

  it('devuelve el resumen del negocio de la conexión', async () => {
    mockCargar.mockResolvedValue(vacio);
    const r = (await executeMcpTool('resumen_del_dia', {}, ctx)) as Record<string, unknown>;
    expect(mockCargar).toHaveBeenCalledWith(ctx.supabase, 'biz-1');
    expect(r).toMatchObject({ todo_en_orden: true, texto: 'Resumen del día: todo en orden.', fecha: '2026-10-05' });
  });
  it('devuelve error en vez de lanzar', async () => {
    mockCargar.mockRejectedValue(new Error('sin base'));
    expect(await executeMcpTool('resumen_del_dia', {}, ctx)).toEqual({ error: 'sin base' });
  });
});
