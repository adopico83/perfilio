import { crearFacturaDesdePresupuesto, DIAS_VENCIMIENTO_FACTURA } from '@/lib/facturas/desde-presupuesto';
import { crearFakeDb, type Fila } from './helpers/fake-db';

const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';
const NOW = new Date('2026-10-06T10:00:00Z'); // 12:00 en Madrid

const cliente = { id: 'cli-1', business_id: BIZ, nif: 'B12345678', direccion: 'Calle Mayor 1' };
const presupuesto = (extra: Fila = {}): Fila => ({
  id: 'pres-1',
  business_id: BIZ,
  estado: 'aceptado',
  cliente_nombre: 'Ana',
  cliente_id: 'cli-1',
  obra_id: 'obra-1',
  preview_id: null,
  presupuesto_generado: '',
  ...extra,
});

function db(tablas: Record<string, Fila[]>) {
  return crearFakeDb({ presupuestos: [presupuesto()], clientes: [cliente], facturas: [], ...tablas });
}

const TEXTO_GENERADO = [
  'CAPÍTULO ALBAÑILERÍA',
  '1. Alicatado baño | Cantidad: 10 | Precio: 30,00 € | Importe: 300,00 €',
  'TOTAL ALBAÑILERÍA: 300,00 €',
  'BASE IMPONIBLE: 300,00 € | IVA (10%): 30,00 € | TOTAL: 330,00 €',
].join('\n');

describe('crearFacturaDesdePresupuesto — líneas e IVA', () => {
  it('(a) usa el borrador y su IVA', async () => {
    const d = db({
      presupuesto_borrador: [{ id: 'bor-1', presupuesto_id: 'pres-1', business_id: BIZ, iva_porcentaje: 10 }],
      presupuesto_borrador_items: [
        { borrador_id: 'bor-1', orden: 2, capitulo: 'Baño', descripcion: 'Plato ducha', cantidad: 1, unidad: 'ud', precio_unitario: 200, importe: 999 },
        { borrador_id: 'bor-1', orden: 1, capitulo: 'Baño', descripcion: 'Alicatado', cantidad: 10, unidad: 'm2', precio_unitario: 30.555, importe: 0 },
      ],
    });
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(r).toMatchObject({ ok: true, ya_existia: false, numero_factura: 1 });
    const f = d.inserts.find((i) => i.tabla === 'facturas')!.fila;
    // importe recalculado = cantidad × precio, 2 decimales (el 999 guardado se ignora)
    expect(f.lineas).toEqual([
      { descripcion: 'Alicatado', cantidad: 10, unidad: 'm2', precio_unitario: 30.555, importe: 305.55, capitulo: 'Baño' },
      { descripcion: 'Plato ducha', cantidad: 1, unidad: 'ud', precio_unitario: 200, importe: 200, capitulo: 'Baño' },
    ]);
    expect(f.base_imponible).toBe(505.55);
    expect(f.iva).toBe(50.56);
    expect(f.total).toBe(556.11);
  });

  it('(b) sin borrador usa las partidas de la previsualización MCP y su IVA', async () => {
    const d = db({
      presupuestos: [presupuesto({ preview_id: 'prev-1' })],
      presupuesto_previews: [
        {
          id: 'prev-1',
          business_id: BIZ,
          iva_porcentaje: 21,
          partidas: [
            { concepto: 'Pintura salón', cantidad: 40, unidad: 'm2', precio: 12.5, capitulo: 'Pintura' },
            { concepto: 'Lijado', cantidad: 2, unidad: 'h', precio: 32, capitulo: 'Pintura' },
          ],
        },
      ],
    });
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(r.ok).toBe(true);
    const f = d.inserts.find((i) => i.tabla === 'facturas')!.fila;
    expect(f.lineas).toEqual([
      { descripcion: 'Pintura salón', cantidad: 40, unidad: 'm2', precio_unitario: 12.5, importe: 500, capitulo: 'Pintura' },
      { descripcion: 'Lijado', cantidad: 2, unidad: 'h', precio_unitario: 32, importe: 64, capitulo: 'Pintura' },
    ]);
    expect(f).toMatchObject({ base_imponible: 564, iva: 118.44, total: 682.44 });
  });

  it('(c) sin borrador ni preview parsea presupuesto_generado y su IVA (10 %)', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(r.ok).toBe(true);
    const f = d.inserts.find((i) => i.tabla === 'facturas')!.fila;
    expect((f.lineas as unknown[]).length).toBe(1);
    expect(f).toMatchObject({ base_imponible: 300, iva: 30, total: 330 });
  });

  it('IVA por defecto 21 si ninguna fuente lo trae', async () => {
    const d = db({
      presupuestos: [presupuesto({ preview_id: 'prev-1' })],
      presupuesto_previews: [
        { id: 'prev-1', business_id: BIZ, partidas: [{ concepto: 'X', cantidad: 1, precio: 100 }] },
      ],
    });
    await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(d.inserts.find((i) => i.tabla === 'facturas')!.fila).toMatchObject({ iva: 21, total: 121 });
  });

  it('error claro si no hay líneas en ninguna fuente', async () => {
    const r = await crearFacturaDesdePresupuesto(db({}).client, BIZ, 'pres-1', NOW);
    expect(r).toMatchObject({ ok: false, code: 'sin_lineas' });
  });
});

describe('crearFacturaDesdePresupuesto — datos de la factura', () => {
  it('guarda vínculo, fechas en Madrid, estado y marca el presupuesto facturado', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', new Date('2026-10-06T22:30:00Z'));
    expect(r).toMatchObject({ ok: true, cliente_nombre: 'Ana', total: 330 });
    const f = d.inserts.find((i) => i.tabla === 'facturas')!.fila;
    // 22:30 UTC ya es el 7 en Madrid
    expect(f.fecha).toBe('2026-10-07');
    expect(f.fecha_vencimiento).toBe('2026-11-06'); // 7 oct + 30 días
    expect(DIAS_VENCIMIENTO_FACTURA).toBe(30);
    expect(f).toMatchObject({
      business_id: BIZ,
      presupuesto_id: 'pres-1',
      obra_id: 'obra-1',
      cliente_id: 'cli-1',
      cliente_nif: 'B12345678',
      cliente_direccion: 'Calle Mayor 1',
      estado: 'pendiente',
    });
    expect(Array.isArray(f.lineas)).toBe(true); // array real, no string
    expect(d.tablas.presupuestos[0].estado).toBe('facturado');
  });

  it('acepta el estado aprobado', async () => {
    const d = db({ presupuestos: [presupuesto({ estado: 'aprobado', presupuesto_generado: TEXTO_GENERADO })] });
    expect((await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).ok).toBe(true);
  });

  it.each(['borrador', 'pendiente', 'rechazado'])('rechaza el estado %s', async (estado) => {
    const d = db({ presupuestos: [presupuesto({ estado, presupuesto_generado: TEXTO_GENERADO })] });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'estado_invalido',
    });
  });

  it('no encuentra presupuestos de otro negocio', async () => {
    const d = db({ presupuestos: [presupuesto({ business_id: OTRO, presupuesto_generado: TEXTO_GENERADO })] });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'no_encontrado',
    });
  });
});

describe('crearFacturaDesdePresupuesto — idempotencia', () => {
  it('si ya hay factura de ese presupuesto la devuelve con ya_existia', async () => {
    const d = db({
      presupuestos: [presupuesto({ estado: 'facturado' })],
      facturas: [
        { id: 'fac-9', business_id: BIZ, presupuesto_id: 'pres-1', numero_factura: 7, total: 330, cliente_nombre: 'Ana' },
      ],
    });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toEqual({
      ok: true,
      factura_id: 'fac-9',
      numero_factura: 7,
      total: 330,
      cliente_nombre: 'Ana',
      ya_existia: true,
    });
    expect(d.inserts).toHaveLength(0);
  });

  it('facturado sin factura vinculada: error claro', async () => {
    const d = db({ presupuestos: [presupuesto({ estado: 'facturado' })] });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'facturado_sin_factura',
    });
  });

  it('dos llamadas seguidas crean una sola factura', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    const a = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    const b = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(a).toMatchObject({ ok: true, ya_existia: false });
    expect(b).toMatchObject({ ok: true, ya_existia: true });
    expect(d.tablas.facturas).toHaveLength(1);
  });

  it('si el índice único de presupuesto salta (carrera), devuelve la factura de la otra llamada', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    d.erroresInsert.facturas = [
      { code: '23505', message: 'duplicate key value violates unique constraint "uq_facturas_presupuesto_id"' },
    ];
    // Justo antes de nuestro insert, otra llamada crea la factura de ese presupuesto.
    d.ganchos.antesDeInsertar = () => {
      d.tablas.facturas.push({ id: 'fac-otra', business_id: BIZ, presupuesto_id: 'pres-1', numero_factura: 3, total: 330, cliente_nombre: 'Ana' });
    };
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(r).toMatchObject({ ok: true, ya_existia: true, factura_id: 'fac-otra' });
  });
});

describe('crearFacturaDesdePresupuesto — cliente', () => {
  it.each([
    ['sin NIF', { nif: '' }],
    ['sin dirección', { direccion: null }],
  ])('cliente %s → cliente_incompleto con cliente_id', async (_n, cambio) => {
    const d = db({
      clientes: [{ ...cliente, ...cambio }],
      presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })],
    });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'cliente_incompleto',
      cliente_id: 'cli-1',
    });
    expect(d.inserts).toHaveLength(0);
  });

  it('presupuesto sin cliente_id → cliente_incompleto con cliente_id null', async () => {
    const d = db({ presupuestos: [presupuesto({ cliente_id: null, presupuesto_generado: TEXTO_GENERADO })] });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'cliente_incompleto',
      cliente_id: null,
    });
  });
});

describe('numeración', () => {
  it('sigue al último número del negocio (ignora los de otros negocios)', async () => {
    const d = db({
      presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })],
      facturas: [
        { id: 'a', business_id: BIZ, numero_factura: 4, presupuesto_id: null },
        { id: 'b', business_id: BIZ, numero_factura: null, presupuesto_id: null },
        { id: 'c', business_id: OTRO, numero_factura: 99, presupuesto_id: null },
      ],
    });
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: true,
      numero_factura: 5,
    });
  });

  it('reintenta una vez si otra alta se lleva el número (23505 en facturas_business_numero_unique)', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    d.erroresInsert.facturas = [
      { code: '23505', message: 'duplicate key value violates unique constraint "facturas_business_numero_unique"' },
    ];
    const r = await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW);
    expect(r).toMatchObject({ ok: true, numero_factura: 1 });
  });

  it('si la colisión se repite, devuelve error de colisión', async () => {
    const d = db({ presupuestos: [presupuesto({ presupuesto_generado: TEXTO_GENERADO })] });
    const choque = { code: '23505', message: 'duplicate key ... "facturas_business_numero_unique"' };
    d.erroresInsert.facturas = [choque, choque];
    expect(await crearFacturaDesdePresupuesto(d.client, BIZ, 'pres-1', NOW)).toMatchObject({
      ok: false,
      code: 'error',
      error: expect.stringContaining('Colisión'),
    });
    expect(d.tablas.presupuestos[0].estado).toBe('aceptado');
  });
});
