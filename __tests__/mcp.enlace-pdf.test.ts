/**
 * Nota sobre el alcance de estos tests:
 * - La caducidad real del enlace la aplica Supabase Storage; aquí solo se comprueba que se
 *   pide `expiresIn` correcto y que `expira_en` se calcula a partir de él.
 * - Las políticas RLS de `storage.objects` de la migración 20260929100000_presupuestos_pdf_bucket.sql
 *   no se pueden ejercitar con Jest. Quedan cubiertas por los tests de aislamiento entre negocios
 *   de la propia tool (filtro business_id, ruta con el business_id del contexto) y deben
 *   verificarse a mano tras aplicar la migración.
 */
import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  DIAS_VALIDEZ_DEFECTO,
  DIAS_VALIDEZ_MAX,
  obtenerEnlacePdfPresupuesto,
} from '@/lib/presupuestos/enlace-pdf';
import { MSG_NO_ENCONTRADO } from '@/lib/presupuestos/lectura';
import { renderPresupuestoPdf } from '@/lib/pdf/presupuesto-render';
import type { McpContext } from '@/lib/mcp/context';
import { createFakeSupabase, type FakeRow } from './helpers/fake-supabase';

// @react-pdf/renderer es ESM y no hace falta: se sustituye por un stub mínimo para poder
// cargar el módulo real del render (y conservar sus helpers puros).
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Image: 'Image',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: jest.fn(),
}));

jest.mock('@/lib/pdf/presupuesto-render', () => ({
  ...jest.requireActual('@/lib/pdf/presupuesto-render'),
  renderPresupuestoPdf: jest.fn(),
}));

const renderMock = renderPresupuestoPdf as jest.MockedFunction<typeof renderPresupuestoPdf>;

const BIZ = 'biz-1';
const OTRO_BIZ = 'biz-2';
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_AJENO = '99999999-9999-4999-8999-999999999999';
const AHORA = new Date('2026-09-29T10:00:00.000Z');
const DIA_S = 86400;

function fila(over: FakeRow): FakeRow {
  return {
    id: ID_1,
    business_id: BIZ,
    numero_presupuesto: 1,
    cliente_nombre: 'Pino',
    estado: 'borrador',
    preview_id: null,
    fecha: '2026-09-01',
    presupuesto_generado: 'texto',
    mensaje_cliente: null,
    obra_id: null,
    created_at: '2026-09-01T09:00:00Z',
    ...over,
  };
}

function montar(rows: FakeRow[]) {
  const fake = createFakeSupabase({ tables: { presupuestos: rows } });
  const ctx: McpContext = { supabase: fake.client, businessId: BIZ, userId: 'user-1' };
  return { fake, ctx };
}

beforeEach(() => {
  renderMock.mockReset();
  renderMock.mockResolvedValue({ ok: true, buffer: Buffer.from('%PDF-fake'), fecha: '2026-09-01' });
});

describe('obtenerEnlacePdfPresupuesto', () => {
  it('constantes de caducidad', () => {
    expect(DIAS_VALIDEZ_DEFECTO).toBe(7);
    expect(DIAS_VALIDEZ_MAX).toBe(30);
  });

  it('presupuesto confirmado por preview_id: sube, firma y devuelve el enlace', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'prev-1' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);

    expect(r).toEqual({
      ok: true,
      url: expect.stringContaining('https://storage.test/presupuestos-pdf/biz-1/' + ID_1 + '.pdf'),
      expira_en: new Date(AHORA.getTime() + 7 * DIA_S * 1000).toISOString(),
      dias_validez: 7,
      presupuesto_id: ID_1,
      numero_presupuesto: 1,
      cliente_nombre: 'Pino',
    });
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0][1]).toBe(BIZ);
    expect(fake.storageCalls.map((c) => c.type)).toEqual(['upload', 'createSignedUrl']);
  });

  it('presupuesto confirmado por estado aceptado (busca por numero)', async () => {
    const { ctx } = montar([fila({ estado: 'aceptado', numero_presupuesto: 7 })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { numero: 7 }, AHORA);
    expect(r.ok).toBe(true);
  });

  it('borrador sin preview_id: no_confirmado y sin render, subida ni firma', async () => {
    const { fake, ctx } = montar([fila({})]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'no_confirmado' });
    expect(renderMock).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  it('estado rechazado: no_confirmado', async () => {
    const { fake, ctx } = montar([fila({ estado: 'rechazado' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'no_confirmado' });
    expect(renderMock).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  describe('aislamiento entre negocios', () => {
    const ajeno = fila({ id: ID_AJENO, business_id: OTRO_BIZ, numero_presupuesto: 5, preview_id: 'prev-x' });

    it('por id de otro negocio: no_encontrado, sin storage y con filtro business_id', async () => {
      const { fake, ctx } = montar([fila({ id: ID_2, numero_presupuesto: 2, preview_id: 'p' }), ajeno]);
      const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_AJENO }, AHORA);
      expect(r).toEqual({ ok: false, code: 'no_encontrado', error: MSG_NO_ENCONTRADO });
      expect(fake.storageCalls).toEqual([]);
      expect(renderMock).not.toHaveBeenCalled();
      expect(fake.queries[0].filters).toContainEqual({ op: 'eq', col: 'business_id', val: BIZ });
    });

    it('por numero de otro negocio: no_encontrado, sin storage y con filtro business_id', async () => {
      const { fake, ctx } = montar([fila({ id: ID_2, numero_presupuesto: 2, preview_id: 'p' }), ajeno]);
      const r = await obtenerEnlacePdfPresupuesto(ctx, { numero: 5 }, AHORA);
      expect(r).toEqual({ ok: false, code: 'no_encontrado', error: MSG_NO_ENCONTRADO });
      expect(fake.storageCalls).toEqual([]);
      expect(renderMock).not.toHaveBeenCalled();
      expect(fake.queries[0].filters).toContainEqual({ op: 'eq', col: 'business_id', val: BIZ });
    });

    it('id inexistente devuelve el mismo mensaje', async () => {
      const { ctx } = montar([]);
      const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_AJENO }, AHORA);
      expect(r).toEqual({ ok: false, code: 'no_encontrado', error: MSG_NO_ENCONTRADO });
    });
  });

  it('la ruta de subida usa el business_id del contexto, upsert y application/pdf', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    // Un business_id colado en los argumentos no debe influir.
    await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1, business_id: OTRO_BIZ }, AHORA);
    const subida = fake.storageCalls.find((c) => c.type === 'upload');
    expect(subida).toMatchObject({
      bucket: 'presupuestos-pdf',
      path: `biz-1/${ID_1}.pdf`,
      opts: { contentType: 'application/pdf', upsert: true },
    });
    expect(Buffer.isBuffer((subida as { body: unknown }).body)).toBe(true);
  });

  it('caducidad por defecto 7 dias y nombre de descarga estable', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    const firma = fake.storageCalls.find((c) => c.type === 'createSignedUrl');
    expect(firma).toMatchObject({
      path: `biz-1/${ID_1}.pdf`,
      expiresIn: 604800,
      opts: { download: 'presupuesto-2026-09-01.pdf' },
    });
    expect(r).toMatchObject({ expira_en: '2026-10-06T10:00:00.000Z' });
  });

  it('dias_validez personalizado (3 dias)', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1, dias_validez: 3 }, AHORA);
    const firma = fake.storageCalls.find((c) => c.type === 'createSignedUrl');
    expect(firma).toMatchObject({ expiresIn: 259200 });
    expect(r).toMatchObject({ ok: true, dias_validez: 3, expira_en: '2026-10-02T10:00:00.000Z' });
  });

  it('acepta el maximo de 30 dias', async () => {
    const { ctx } = montar([fila({ preview_id: 'p' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1, dias_validez: 30 }, AHORA);
    expect(r).toMatchObject({ ok: true, dias_validez: 30 });
  });

  it.each([31, 0, -1, 1.5, 'abc', NaN, Infinity])(
    'dias_validez %p se rechaza sin tocar storage',
    async (dias) => {
      const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
      const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1, dias_validez: dias }, AHORA);
      expect(r).toMatchObject({ ok: false, code: 'validacion' });
      expect(fake.storageCalls).toEqual([]);
      expect(renderMock).not.toHaveBeenCalled();
    }
  );

  it('sin id ni numero: validacion', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, {}, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'validacion' });
    expect(fake.queries).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it('id que no es uuid o numero no entero: validacion', async () => {
    const { ctx } = montar([]);
    expect(await obtenerEnlacePdfPresupuesto(ctx, { id: 'xyz' }, AHORA)).toMatchObject({
      ok: false,
      code: 'validacion',
    });
    expect(await obtenerEnlacePdfPresupuesto(ctx, { numero: 1.5 }, AHORA)).toMatchObject({
      ok: false,
      code: 'validacion',
    });
  });

  it('fallo del render: error, sin subida', async () => {
    renderMock.mockResolvedValue({ ok: false, error: 'sin perfil de empresa' });
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'error', error: expect.stringContaining('sin perfil') });
    expect(fake.storageCalls).toEqual([]);
  });

  it('fallo de la subida: ok false y sin url ni firma', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    fake.failUpload('Bucket not found');
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'error', error: expect.stringContaining('Bucket not found') });
    expect(r).not.toHaveProperty('url');
    expect(fake.storageCalls.map((c) => c.type)).toEqual(['upload']);
  });

  it('fallo de la firma: ok false y sin url', async () => {
    const { fake, ctx } = montar([fila({ preview_id: 'p' })]);
    fake.failSignedUrl('boom');
    const r = await obtenerEnlacePdfPresupuesto(ctx, { id: ID_1 }, AHORA);
    expect(r).toMatchObject({ ok: false, code: 'error', error: expect.stringContaining('boom') });
    expect(r).not.toHaveProperty('url');
  });

  it('executeMcpTool despacha obtener_enlace_pdf_presupuesto', async () => {
    const { ctx } = montar([fila({ preview_id: 'p' })]);
    const r = (await executeMcpTool('obtener_enlace_pdf_presupuesto', { id: ID_1 }, ctx)) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
  });
});
