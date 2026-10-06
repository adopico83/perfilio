import { NextRequest } from 'next/server';
import { createPerfilioMcpServer } from '@/lib/mcp/server';
import { executeMcpTool } from '@/lib/mcp/execute-tool';
import { renderFacturaPdf } from '@/lib/pdf/factura-render';
import type { McpContext } from '@/lib/mcp/context';
import { createFakeSupabase, type FakeRow } from './helpers/fake-supabase';

jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Image: 'Image',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: jest.fn(),
}));
jest.mock('@/lib/pdf/factura-render', () => ({
  ...jest.requireActual('@/lib/pdf/factura-render'),
  renderFacturaPdf: jest.fn(),
}));
const mockCrearFactura = jest.fn();
jest.mock('@/lib/facturas/desde-presupuesto', () => ({
  ...jest.requireActual('@/lib/facturas/desde-presupuesto'),
  crearFacturaDesdePresupuesto: (...a: unknown[]) => mockCrearFactura(...a),
}));

const mockAuthUser = jest.fn();
const mockOwns = jest.fn();
const mockServiceFrom = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockAuthUser() } }),
  createServiceClient: () => ({ from: (...a: unknown[]) => mockServiceFrom(...a) }),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: (...a: unknown[]) => mockOwns(...a),
}));

const renderMock = renderFacturaPdf as jest.MockedFunction<typeof renderFacturaPdf>;

const BIZ = 'biz-1';
const ID = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-10-06T10:00:00Z');

type Registered = { description?: string; inputSchema?: { shape?: Record<string, unknown> } };
function tools(ctx: McpContext): Record<string, Registered> {
  const server = createPerfilioMcpServer(ctx) as unknown as { _registeredTools?: Record<string, Registered> };
  return server._registeredTools ?? {};
}
function montar(tables: Record<string, FakeRow[]>) {
  const fake = createFakeSupabase({ tables });
  const ctx: McpContext = { supabase: fake.client, businessId: BIZ, userId: 'u' };
  return { fake, ctx };
}

describe('registro de las tools de facturas', () => {
  const { ctx } = montar({});
  const t = tools(ctx);

  it('crear_factura_desde_presupuesto: solo id y numero, sin business_id', () => {
    const tool = t.crear_factura_desde_presupuesto;
    expect(tool).toBeDefined();
    expect(Object.keys(tool.inputSchema?.shape ?? {}).sort()).toEqual(['id', 'numero']);
    expect(tool.description).toMatch(/confirmación explícita/);
    expect(tool.description).toMatch(/idempotente/);
  });
  it('obtener_enlace_pdf_factura: id, numero y dias_validez, sin business_id', () => {
    const tool = t.obtener_enlace_pdf_factura;
    expect(tool).toBeDefined();
    expect(Object.keys(tool.inputSchema?.shape ?? {}).sort()).toEqual(['dias_validez', 'id', 'numero']);
  });
  it('las tools existentes siguen ahí', () => {
    for (const n of ['crear_cita', 'ver_citas', 'ver_facturas_pendientes', 'obtener_enlace_pdf_presupuesto', 'crear_entrada_diario']) {
      expect(t[n]).toBeDefined();
    }
  });
});

describe('crear_factura_desde_presupuesto', () => {
  beforeEach(() => mockCrearFactura.mockReset());

  it('usa el negocio del contexto y el id indicado', async () => {
    mockCrearFactura.mockResolvedValue({ ok: true, factura_id: 'f1', ya_existia: false });
    const { ctx } = montar({});
    const r = await executeMcpTool('crear_factura_desde_presupuesto', { id: ID, business_id: 'otro' }, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(mockCrearFactura).toHaveBeenCalledWith(ctx.supabase, BIZ, ID);
  });
  it('busca por numero dentro del negocio', async () => {
    mockCrearFactura.mockResolvedValue({ ok: true });
    const { ctx } = montar({
      presupuestos: [
        { id: 'ajeno', business_id: 'otro', numero_presupuesto: 5 },
        { id: ID, business_id: BIZ, numero_presupuesto: 5 },
      ],
    });
    await executeMcpTool('crear_factura_desde_presupuesto', { numero: 5 }, ctx);
    expect(mockCrearFactura).toHaveBeenCalledWith(ctx.supabase, BIZ, ID);
  });
  it('numero inexistente → no_encontrado, sin crear nada', async () => {
    const { ctx } = montar({ presupuestos: [] });
    expect(await executeMcpTool('crear_factura_desde_presupuesto', { numero: 5 }, ctx)).toMatchObject({
      ok: false,
      code: 'no_encontrado',
    });
    expect(mockCrearFactura).not.toHaveBeenCalled();
  });
  it('valida los argumentos', async () => {
    const { ctx } = montar({});
    expect(await executeMcpTool('crear_factura_desde_presupuesto', {}, ctx)).toMatchObject({ code: 'validacion' });
    expect(await executeMcpTool('crear_factura_desde_presupuesto', { id: 'no-uuid' }, ctx)).toMatchObject({
      code: 'validacion',
    });
    expect(mockCrearFactura).not.toHaveBeenCalled();
  });
});

describe('obtener_enlace_pdf_factura', () => {
  beforeEach(() => {
    renderMock.mockReset();
    renderMock.mockResolvedValue({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 });
  });
  const fila = (over: FakeRow = {}): FakeRow => ({
    id: ID,
    business_id: BIZ,
    numero_factura: 3,
    cliente_nombre: 'Ana',
    ...over,
  });

  it('sube a facturas-pdf/{business}/{id}.pdf y firma 7 días por defecto', async () => {
    const { fake, ctx } = montar({ facturas: [fila()] });
    const { obtenerEnlacePdfFactura } = await import('@/lib/mcp/facturas');
    const r = await obtenerEnlacePdfFactura(ctx, { id: ID }, AHORA);
    expect(r).toEqual({
      ok: true,
      url: expect.stringContaining(`https://storage.test/facturas-pdf/${BIZ}/${ID}.pdf`),
      expira_en: new Date(AHORA.getTime() + 7 * 86400_000).toISOString(),
      dias_validez: 7,
      factura_id: ID,
      numero_factura: 3,
      cliente_nombre: 'Ana',
    });
    expect(fake.storageCalls.map((c) => c.type)).toEqual(['upload', 'createSignedUrl']);
    expect(renderMock.mock.calls[0][1]).toBe(BIZ);
  });
  it('no ve facturas de otro negocio', async () => {
    const { fake, ctx } = montar({ facturas: [fila({ business_id: 'otro' })] });
    expect(await executeMcpTool('obtener_enlace_pdf_factura', { id: ID }, ctx)).toMatchObject({
      ok: false,
      code: 'no_encontrado',
    });
    expect(fake.storageCalls).toHaveLength(0);
  });
  it.each([0, 31, 1.5])('rechaza dias_validez %s', async (dias) => {
    const { ctx } = montar({ facturas: [fila()] });
    expect(await executeMcpTool('obtener_enlace_pdf_factura', { id: ID, dias_validez: dias }, ctx)).toMatchObject({
      code: 'validacion',
    });
  });
  it('busca por número', async () => {
    const { ctx } = montar({ facturas: [fila()] });
    expect(await executeMcpTool('obtener_enlace_pdf_factura', { numero: 3 }, ctx)).toMatchObject({ ok: true });
  });
});

describe('PATCH /api/facturas/[id]/estado', () => {
  const llamar = async (body: unknown, id = ID) => {
    const { PATCH } = await import('@/app/api/facturas/[id]/estado/route');
    return PATCH(
      new NextRequest('http://x/api/facturas/x/estado', { method: 'PATCH', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) }
    );
  };
  const update = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockOwns.mockResolvedValue(true);
    update.mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    mockServiceFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ID, business_id: BIZ }, error: null }) }) }),
      update,
    });
  });

  it('401 sin sesión', async () => {
    mockAuthUser.mockResolvedValue({ data: { user: null } });
    expect((await llamar({ estado: 'pagada' })).status).toBe(401);
  });
  it('400 con un estado no permitido', async () => {
    expect((await llamar({ estado: 'borrada' })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('403 si la factura es de otro negocio', async () => {
    mockOwns.mockResolvedValue(false);
    expect((await llamar({ estado: 'pagada' })).status).toBe(403);
    expect(mockOwns).toHaveBeenCalledWith(expect.anything(), 'user-1', BIZ);
    expect(update).not.toHaveBeenCalled();
  });
  it('404 si no existe', async () => {
    mockServiceFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    expect((await llamar({ estado: 'pagada' })).status).toBe(404);
  });
  it.each(['pendiente', 'pagada', 'vencida'])('guarda el estado %s filtrando por negocio', async (estado) => {
    const res = await llamar({ estado });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ estado });
  });
});
