import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  esPresupuestoConfirmado,
  listarPresupuestos,
  verPresupuesto,
} from '@/lib/presupuestos/lectura';
import type { McpContext } from '@/lib/mcp/context';
import { createFakeSupabase, type FakeRow } from './helpers/fake-supabase';

const BIZ = 'biz-1';
const OTRO_BIZ = 'biz-2';
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const ID_AJENO = '99999999-9999-4999-8999-999999999999';

const TEXTO_CON_PIE = [
  'CAPÍTULO ALBAÑILERÍA',
  '1. Alicatado | Cantidad: 20 | Precio: 35,00 € | Importe: 700,00 €',
  'TOTAL ALBAÑILERÍA: 700,00 €',
  'BASE IMPONIBLE: 700,00 € | IVA (21%): 147,00 € | TOTAL: 847,00 €',
].join('\n');

const TEXTO_SIN_PIE = [
  'CAPÍTULO ALBAÑILERÍA',
  '1. Alicatado | Cantidad: 20 | Precio: 35,00 € | Importe: 700,00 €',
  'TOTAL ALBAÑILERÍA: 700,00 €',
].join('\n');

function fila(over: FakeRow): FakeRow {
  return {
    id: ID_1,
    business_id: BIZ,
    numero_presupuesto: 1,
    cliente_nombre: 'Pino',
    importe_total: 847,
    estado: 'borrador',
    fecha: '2026-09-01',
    obra_id: null,
    confirmado_por_humano: false,
    presupuesto_generado: TEXTO_CON_PIE,
    created_at: '2026-09-01T09:00:00Z',
    ...over,
  };
}

function montar(rows: FakeRow[]) {
  const fake = createFakeSupabase({ tables: { presupuestos: rows } });
  const ctx: McpContext = { supabase: fake.client, businessId: BIZ, userId: 'user-1' };
  return { fake, ctx };
}

const base: FakeRow[] = [
  fila({ id: ID_1, numero_presupuesto: 1, cliente_nombre: 'Pino Martín', fecha: '2026-09-01', estado: 'borrador' }),
  fila({
    id: ID_2,
    numero_presupuesto: 2,
    cliente_nombre: 'Mendi SL',
    fecha: '2026-09-10',
    estado: 'Enviado ',
    created_at: '2026-09-10T09:00:00Z',
  }),
  fila({
    id: ID_3,
    numero_presupuesto: 3,
    cliente_nombre: 'Pinares SA',
    fecha: '2026-09-10',
    estado: 'borrador',
    confirmado_por_humano: true,
    created_at: '2026-09-10T12:00:00Z',
  }),
  fila({ id: ID_AJENO, business_id: OTRO_BIZ, numero_presupuesto: 1, cliente_nombre: 'Pino Ajeno', fecha: '2026-09-05' }),
];

describe('esPresupuestoConfirmado', () => {
  it.each([
    [{ estado: 'borrador', confirmado_por_humano: true }, true],
    [{ estado: 'rechazado', confirmado_por_humano: true }, true],
    [{ confirmado_por_humano: true }, true],
    [{ estado: 'borrador', confirmado_por_humano: false }, false],
    [{ estado: 'borrador', confirmado_por_humano: null }, false],
    [{ estado: 'borrador' }, false],
    [{ estado: 'enviado' }, true],
    [{ estado: ' Enviado ' }, true],
    [{ estado: 'ACEPTADO' }, true],
    [{ estado: '  Aprobado' }, true],
    [{ estado: 'facturado ' }, true],
    [{ estado: 'rechazado', confirmado_por_humano: false }, false],
    [{ estado: null, confirmado_por_humano: null }, false],
    [{}, false],
  ])('%j -> %s', (row, esperado) => {
    expect(esPresupuestoConfirmado(row)).toBe(esperado);
  });

  it('un preview_id por sí solo (atajo) no confirma', () => {
    expect(esPresupuestoConfirmado({ estado: 'borrador', preview_id: 'p' } as never)).toBe(false);
  });
});

describe('listarPresupuestos', () => {
  it('solo devuelve filas del negocio aunque la tabla tenga las de otro', async () => {
    const { ctx, fake } = montar(base);
    const r = await listarPresupuestos(ctx, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.id).sort()).toEqual([ID_1, ID_2, ID_3].sort());
    expect(fake.queries[0].filters).toContainEqual({ op: 'eq', col: 'business_id', val: BIZ });
  });

  it('ordena por fecha desc y luego created_at desc, y no filtra preview_id ni confirmado_por_humano al exterior', async () => {
    const { ctx } = montar(base);
    const r = await listarPresupuestos(ctx, {});
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.items.map((i) => i.id)).toEqual([ID_3, ID_2, ID_1]);
    for (const item of r.items) {
      expect(item).not.toHaveProperty('preview_id');
      expect(item).not.toHaveProperty('confirmado_por_humano');
    }
    expect(Object.keys(r.items[0]).sort()).toEqual(
      ['cliente_nombre', 'confirmado', 'estado', 'fecha', 'id', 'importe_total', 'numero_presupuesto', 'obra_id'].sort()
    );
  });

  it('marca confirmado por confirmado_por_humano o por estado normalizado', async () => {
    const { ctx } = montar(base);
    const r = await listarPresupuestos(ctx, {});
    if (!r.ok) throw new Error('esperaba ok');
    const por = Object.fromEntries(r.items.map((i) => [i.id, i.confirmado]));
    expect(por).toEqual({ [ID_1]: false, [ID_2]: true, [ID_3]: true });
  });

  it('filtra por cliente con coincidencia parcial y sin comodines del usuario', async () => {
    const { ctx, fake } = montar(base);
    const r = await listarPresupuestos(ctx, { cliente: 'pin' });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.items.map((i) => i.id).sort()).toEqual([ID_1, ID_3].sort());

    await listarPresupuestos(ctx, { cliente: '%_*Pi*n%' });
    expect(fake.queries[1].filters).toContainEqual({ op: 'ilike', col: 'cliente_nombre', pattern: '%Pin%' });
  });

  it('filtra por estado exacto en minúsculas', async () => {
    const { ctx } = montar([fila({ id: ID_1, estado: 'enviado' }), fila({ id: ID_2, estado: 'borrador' })]);
    const r = await listarPresupuestos(ctx, { estado: '  ENVIADO ' });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.items.map((i) => i.id)).toEqual([ID_1]);
  });

  it('filtra por desde y hasta inclusivos', async () => {
    const { ctx } = montar(base);
    const r = await listarPresupuestos(ctx, { desde: '2026-09-10', hasta: '2026-09-10' });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.items.map((i) => i.id).sort()).toEqual([ID_2, ID_3].sort());
    const soloDesde = await listarPresupuestos(ctx, { desde: '2026-09-02' });
    if (!soloDesde.ok) throw new Error('esperaba ok');
    expect(soloDesde.items).toHaveLength(2);
    const soloHasta = await listarPresupuestos(ctx, { hasta: '2026-09-01' });
    if (!soloHasta.ok) throw new Error('esperaba ok');
    expect(soloHasta.items.map((i) => i.id)).toEqual([ID_1]);
  });

  it('rechaza fechas con formato inválido', async () => {
    const { ctx } = montar(base);
    for (const args of [{ desde: '01/09/2026' }, { hasta: 'mañana' }, { desde: '2026-9-1' }]) {
      const r = await listarPresupuestos(ctx, args);
      expect(r).toMatchObject({ ok: false, code: 'validacion' });
    }
  });

  it('limite: 20 por defecto, y se ajusta al rango 1..50', async () => {
    const muchas = Array.from({ length: 60 }, (_, i) =>
      fila({ id: `id-${i}`, numero_presupuesto: i + 1, fecha: '2026-09-01', created_at: `2026-09-01T00:${String(i).padStart(2, '0')}:00Z` })
    );
    const { ctx, fake } = montar(muchas);
    const defecto = await listarPresupuestos(ctx, {});
    if (!defecto.ok) throw new Error('esperaba ok');
    expect(defecto.items).toHaveLength(20);
    expect(fake.queries[0].limit).toBe(20);

    const alto = await listarPresupuestos(ctx, { limite: 500 });
    if (!alto.ok) throw new Error('esperaba ok');
    expect(alto.items).toHaveLength(50);

    const bajo = await listarPresupuestos(ctx, { limite: 0 });
    if (!bajo.ok) throw new Error('esperaba ok');
    expect(bajo.items).toHaveLength(1);

    const tres = await listarPresupuestos(ctx, { limite: 3 });
    if (!tres.ok) throw new Error('esperaba ok');
    expect(tres.items).toHaveLength(3);
  });

  it('pasa importe_total tal cual está guardado', async () => {
    const { ctx } = montar([fila({ id: ID_1, importe_total: 1234.5 })]);
    const r = await listarPresupuestos(ctx, {});
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.items[0].importe_total).toBe(1234.5);
  });

  it('devuelve code error si falla la base de datos', async () => {
    const fake = createFakeSupabase({ dbError: 'boom' });
    const r = await listarPresupuestos({ supabase: fake.client, businessId: BIZ, userId: 'u' }, {});
    expect(r).toEqual({ ok: false, code: 'error', error: 'boom' });
  });
});

describe('verPresupuesto', () => {
  it('devuelve el detalle por id, con confirmado y sin texto crudo, preview_id ni confirmado_por_humano', async () => {
    const { ctx, fake } = montar(base);
    const r = await verPresupuesto(ctx, { id: ID_2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({
      id: ID_2,
      numero_presupuesto: 2,
      cliente_nombre: 'Mendi SL',
      importe_total: 847,
      estado: 'Enviado ',
      confirmado: true,
      total: 847,
      base_imponible: 700,
      iva_porcentaje: 21,
      iva_importe: 147,
    });
    expect(r).not.toHaveProperty('preview_id');
    expect(r).not.toHaveProperty('confirmado_por_humano');
    expect(r).not.toHaveProperty('presupuesto_generado');
    expect(r.capitulos).toEqual([
      {
        nombre: 'CAPÍTULO ALBAÑILERÍA',
        partidas: [{ concepto: 'Alicatado', cantidad: 20, precio: 35, importe: 700 }],
        total: 700,
      },
    ]);
    expect(fake.queries[0].filters).toContainEqual({ op: 'eq', col: 'business_id', val: BIZ });
  });

  it('devuelve el detalle por numero', async () => {
    const { ctx } = montar(base);
    const r = await verPresupuesto(ctx, { numero: 3 });
    expect(r).toMatchObject({ ok: true, id: ID_3, confirmado: true });
  });

  it('id o numero de otro negocio -> no_encontrado con el mismo mensaje que uno inexistente', async () => {
    const { ctx } = montar(base);
    const ajenoId = await verPresupuesto(ctx, { id: ID_AJENO });
    const inexistente = await verPresupuesto(ctx, { id: '00000000-0000-4000-8000-000000000000' });
    expect(ajenoId).toMatchObject({ ok: false, code: 'no_encontrado' });
    expect(ajenoId).toEqual(inexistente);

    // El numero 1 existe en ambos negocios: solo debe resolver el propio.
    const propio = await verPresupuesto(ctx, { numero: 1 });
    expect(propio).toMatchObject({ ok: true, id: ID_1 });
    const sinNumero = montar([fila({ id: ID_AJENO, business_id: OTRO_BIZ, numero_presupuesto: 7 })]);
    const ajenoNumero = await verPresupuesto(sinNumero.ctx, { numero: 7 });
    expect(ajenoNumero).toEqual(inexistente);
  });

  it('sin id ni numero -> validacion', async () => {
    const { ctx } = montar(base);
    expect(await verPresupuesto(ctx, {})).toMatchObject({ ok: false, code: 'validacion' });
    expect(await verPresupuesto(ctx, { id: '  ' })).toMatchObject({ ok: false, code: 'validacion' });
    expect(await verPresupuesto(ctx, { numero: 1.5 })).toMatchObject({ ok: false, code: 'validacion' });
  });

  it('no recalcula: total es importe_total aunque no cuadre con el pie del texto', async () => {
    const { ctx } = montar([fila({ id: ID_1, importe_total: 999.99 })]);
    const r = await verPresupuesto(ctx, { id: ID_1 });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.importe_total).toBe(999.99);
    expect(r.total).toBe(999.99);
    expect(r.base_imponible).toBe(700);
    expect(r.iva_importe).toBe(147);
  });

  it('sin pie en el texto: base e IVA son null (no se expone el recálculo del parser)', async () => {
    const { ctx } = montar([fila({ id: ID_1, presupuesto_generado: TEXTO_SIN_PIE, importe_total: 847 })]);
    const r = await verPresupuesto(ctx, { id: ID_1 });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.base_imponible).toBeNull();
    expect(r.iva_porcentaje).toBeNull();
    expect(r.iva_importe).toBeNull();
    expect(r.total).toBe(847);
    expect(r.capitulos).toHaveLength(1);
  });

  it('presupuesto_generado vacío o null no rompe', async () => {
    const { ctx } = montar([fila({ id: ID_1, presupuesto_generado: null })]);
    const r = await verPresupuesto(ctx, { id: ID_1 });
    if (!r.ok) throw new Error('esperaba ok');
    expect(r.capitulos).toEqual([]);
    expect(r.base_imponible).toBeNull();
  });
});

describe('executeMcpTool ver_presupuestos / ver_presupuesto', () => {
  it('enruta a las funciones de lectura', async () => {
    const { ctx } = montar(base);
    const lista = (await executeMcpTool('ver_presupuestos', { limite: 1 }, ctx)) as { ok: boolean; items: unknown[] };
    expect(lista.ok).toBe(true);
    expect(lista.items).toHaveLength(1);
    const detalle = await executeMcpTool('ver_presupuesto', { numero: 2 }, ctx);
    expect(detalle).toMatchObject({ ok: true, id: ID_2 });
  });
});
