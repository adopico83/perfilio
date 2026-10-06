import { crearFacturaDesdeAlbaran } from '@/lib/facturas/desde-albaran';
import { crearFakeDb, type Fila } from './helpers/fake-db';

const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';
const NOW = new Date('2026-10-06T10:00:00Z');

const albaran = (extra: Fila = {}): Fila => ({
  id: 'alb-1',
  business_id: BIZ,
  numero_albaran: 13,
  estado: 'entregado',
  cliente_nombre: 'Ana',
  cliente_id: 'cli-1',
  cliente_direccion: 'Calle Mayor 1',
  obra_id: 'obra-1',
  descripcion_trabajos: 'Arreglo',
  lineas: null,
  total: 121,
  ...extra,
});
const db = (tablas: Record<string, Fila[]> = {}) =>
  crearFakeDb({ albaranes: [albaran()], facturas: [], presupuestos: [], ...tablas });

describe('crearFacturaDesdeAlbaran', () => {
  it('IVA 21: total IVA incluido, base 100, una línea y albarán facturado', async () => {
    const d = db();
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', { iva_porcentaje: 21 }, NOW);
    expect(r).toMatchObject({ ok: true, ya_existia: false, numero_factura: 1, total: 121 });
    const f = d.inserts.find((i) => i.tabla === 'facturas')!.fila;
    expect(f).toMatchObject({
      albaran_id: 'alb-1',
      base_imponible: 100,
      iva: 21,
      total: 121,
      fecha: '2026-10-06',
      fecha_vencimiento: '2026-11-05',
      estado: 'pendiente',
      obra_id: 'obra-1',
    });
    expect(f.lineas).toEqual([
      { descripcion: 'Trabajos según albarán nº 13', cantidad: 1, unidad: null, precio_unitario: 100, importe: 100, capitulo: null },
    ]);
    expect(d.tablas.albaranes[0].estado).toBe('facturado');
  });

  it('IVA 10 sobre 4,82 €', async () => {
    const d = db({ albaranes: [albaran({ total: 4.82 })] });
    await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', { iva_porcentaje: 10 }, NOW);
    expect(d.tablas.facturas[0]).toMatchObject({ base_imponible: 4.38, iva: 0.44, total: 4.82 });
  });

  it('usa las líneas del albarán si cuadran con la base', async () => {
    const lineas = [{ descripcion: 'Mano de obra', cantidad: 2, precio_unitario: 50 }];
    const d = db({ albaranes: [albaran({ lineas })] });
    await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', { iva_porcentaje: 21 }, NOW);
    expect(d.tablas.facturas[0].lineas).toEqual([
      { descripcion: 'Mano de obra', cantidad: 2, unidad: null, precio_unitario: 50, importe: 100, capitulo: null },
    ]);
  });

  it('suma los extras aceptados del cliente', async () => {
    const d = db({
      presupuestos: [
        { business_id: BIZ, es_extra: true, estado: 'aceptado', cliente_id: 'cli-1', importe_total: 121, presupuesto_generado: 'Toma de luz' },
      ],
    });
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', { iva_porcentaje: 21 }, NOW);
    expect(r).toMatchObject({ ok: true, total: 242 });
    expect(String(d.tablas.facturas[0].descripcion_trabajos)).toContain('Toma de luz');
  });

  it.each([18, 5, -1])('IVA %s no permitido → validación sin tocar nada', async (iva) => {
    const d = db();
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', { iva_porcentaje: iva }, NOW);
    expect(r).toMatchObject({ ok: false, code: 'validacion' });
    expect(d.inserts).toHaveLength(0);
  });

  it('es idempotente: si ya hay factura la devuelve y no crea otra', async () => {
    const d = db({ facturas: [{ id: 'fac-9', business_id: BIZ, albaran_id: 'alb-1', numero_factura: 4, total: 50, cliente_nombre: 'Ana' }] });
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', {}, NOW);
    expect(r).toMatchObject({ ok: true, ya_existia: true, factura_id: 'fac-9', numero_factura: 4 });
    expect(d.inserts).toHaveLength(0);
    expect(d.tablas.albaranes[0].estado).toBe('facturado');
  });

  it('facturado sin factura → error claro y no crea nada', async () => {
    const d = db({ albaranes: [albaran({ estado: 'facturado' })] });
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', {}, NOW);
    expect(r).toMatchObject({ ok: false, code: 'facturado_sin_factura' });
    expect(d.inserts).toHaveLength(0);
  });

  it('no ve albaranes de otro negocio', async () => {
    const d = db({ albaranes: [albaran({ business_id: OTRO })] });
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', {}, NOW);
    expect(r).toMatchObject({ ok: false, code: 'no_encontrado' });
    expect(d.inserts).toHaveLength(0);
    expect(d.updates).toHaveLength(0);
  });

  it('la carrera con otra llamada (23505 del índice) devuelve su factura', async () => {
    const d = db();
    d.erroresInsert.facturas = [{ code: '23505', message: 'duplicate key value violates unique constraint "uq_facturas_albaran_id"' }];
    d.ganchos.antesDeInsertar = () => {
      d.tablas.facturas.push({ id: 'fac-x', business_id: BIZ, albaran_id: 'alb-1', numero_factura: 1, total: 121, cliente_nombre: 'Ana' });
    };
    const r = await crearFacturaDesdeAlbaran(d.client, BIZ, 'alb-1', {}, NOW);
    expect(r).toMatchObject({ ok: true, ya_existia: true, factura_id: 'fac-x' });
  });
});
