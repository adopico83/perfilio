import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';
import { handleDiario } from '@/lib/agente/modules/diario';
import { handleDocumentosAgent } from '@/lib/agente/modules/documentos';
import { handleEnlacesPdf } from '@/lib/agente/modules/enlaces-pdf';
import { IDS, NEGOCIO_A, NEGOCIO_B, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

const openai = {} as never;
const presupuestos = (db: ReturnType<typeof crearFakeDb>, tool: string, args: Record<string, unknown>, negocio = NEGOCIO_A) =>
  handlePresupuestos(tool, args, negocio, USUARIO, db.client, openai, {});

describe('presupuestos por número', () => {
  it('buscar_presupuesto por numero devuelve el del negocio (y su numero_presupuesto)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'buscar_presupuesto', { numero: 7 })) as { ok: boolean; items: Array<Record<string, unknown>> };
    expect(r.ok).toBe(true);
    expect(r.items).toEqual([
      { id: IDS.presupuesto7, numero_presupuesto: 7, cliente_nombre: 'Paqui', estado: 'aceptado', importe_total: 8871 },
    ]);
  });
  it('el mismo número en OTRO negocio devuelve el suyo, nunca el del primero', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'buscar_presupuesto', { numero: 7 }, NEGOCIO_B)) as { items: Array<{ id: string }> };
    expect(r.items.map((i) => i.id)).toEqual([IDS.presupuesto7Ajeno]);
  });
  it('un número que no existe en el negocio → no encontrado (aunque exista en otro)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await presupuestos(db, 'buscar_presupuesto', { numero: 8 }, NEGOCIO_B);
    expect(r).toMatchObject({ ok: false, resolve: 'none' });
  });
  it('buscar por nombre con varios resultados ofrece candidatos con el nº en la etiqueta', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'buscar_presupuesto', { query: 'García' })) as {
      necesita_aclaracion?: boolean;
      candidatos?: Array<{ etiqueta: string }>;
    };
    expect(r.necesita_aclaracion).toBe(true);
    expect(r.candidatos?.map((c) => c.etiqueta)).toEqual(expect.arrayContaining([expect.stringContaining('nº 8'), expect.stringContaining('nº 9')]));
  });
  it('listar_presupuestos trae numero_presupuesto', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'listar_presupuestos', {})) as { items: Array<{ numero_presupuesto: number | null }> };
    expect(r.items.map((i) => i.numero_presupuesto as number).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11]);
  });
  it('convertir_presupuesto_a_factura por número crea la factura del presupuesto correcto, numerada por negocio', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'convertir_presupuesto_a_factura', { numero: 7 })) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, numero_factura: 4, cliente_nombre: 'Paqui', ya_existia: false });
    expect(String(r.mensaje)).toContain('Factura nº 4 creada para Paqui (580.8 €).');
    expect(String(r.mensaje)).toMatch(/\[Descargar PDF de la factura nº 4\]\(https:/); // ya devuelve el enlace del PDF
    expect(db.tablas.facturas.find((f) => f.presupuesto_id === IDS.presupuesto7)).toMatchObject({ business_id: NEGOCIO_A, numero_factura: 4 });
  });
  it('convertir por nombre con varios presupuestos pide aclaración y no crea nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await presupuestos(db, 'convertir_presupuesto_a_factura', { query: 'García' });
    expect(r).toMatchObject({ ok: false, necesita_aclaracion: true });
    expect(db.inserts).toHaveLength(0);
  });
  it('convertir dos veces es idempotente (devuelve la misma factura)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    await presupuestos(db, 'convertir_presupuesto_a_factura', { numero: 7 });
    const r2 = (await presupuestos(db, 'convertir_presupuesto_a_factura', { numero: 7 })) as Record<string, unknown>;
    expect(r2).toMatchObject({ ok: true, ya_existia: true });
    expect(r2.mensaje).toContain('ya tenía la factura');
    expect(db.tablas.facturas.filter((f) => f.presupuesto_id === IDS.presupuesto7)).toHaveLength(1);
  });
  it('sin ningún dato pide número o cliente', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    expect(await presupuestos(db, 'convertir_presupuesto_a_factura', {})).toMatchObject({ ok: false });
  });
});

describe('diario con obra_id', () => {
  const diario = (db: ReturnType<typeof crearFakeDb>, args: Record<string, unknown>) =>
    handleDiario('crear_entrada_diario', args, NEGOCIO_A, USUARIO, db.client, openai, { mensajeTrim: '' });

  it('con solo obra_id (sin obra_nombre) anota en esa obra', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await diario(db, { obra_id: IDS.obraPaqui, texto: 'Se ha picado el baño' })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(db.tablas.diario_obra[0]).toMatchObject({ business_id: NEGOCIO_A, obra_id: IDS.obraPaqui, obra_nombre: 'Reforma Paqui' });
  });
  it('un obra_id de otro negocio no escribe nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await diario(db, { obra_id: IDS.obraPaquiAjena, texto: 'x' })) as Record<string, unknown>;
    expect(r.error).toMatch(/obra_id no existe/);
    expect(db.inserts).toHaveLength(0);
  });
  it('sin obra_id ni obra_nombre: error claro', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    expect(await diario(db, { texto: 'x' })).toEqual({ error: 'Indica obra_id u obra_nombre' });
  });
  it('varias obras con el nombre: candidatos con dirección para elegir', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await diario(db, { obra_nombre: 'Olabide', texto: 'x' })) as {
      necesita_aclaracion?: boolean;
      candidatos?: Array<{ id: string; etiqueta: string }>;
    };
    expect(r.necesita_aclaracion).toBe(true);
    expect(r.candidatos?.map((c) => c.etiqueta).sort()).toEqual([
      'Obra Olabide 12 · Olabide 12, Ondarribia',
      'Obra Olabide 9 · Olabide 9, Ondarribia',
    ]);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('crear_factura del agente: número correlativo por negocio', () => {
  it('toma el siguiente al último del negocio (3 → 4) aunque el otro negocio tenga el 3', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleDocumentosAgent(
      'crear_factura',
      { descripcion_trabajos: 'Trabajos varios', total: 121, iva: 21 },
      NEGOCIO_A,
      USUARIO,
      db.client,
      openai,
      { mensajeTrim: 'crea una factura', mensaje: 'crea una factura' }
    )) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, numero_factura: 4 });
    expect(db.tablas.facturas.filter((f) => f.business_id === NEGOCIO_A).map((f) => f.numero_factura).sort()).toEqual([3, 4]);
  });
});

describe('enlaces PDF del agente', () => {
  it('factura por número: sube a la carpeta del negocio y devuelve un enlace en Markdown', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleEnlacesPdf('obtener_enlace_pdf_factura', { numero: 3 }, NEGOCIO_A, USUARIO, db.client)) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, factura_id: IDS.factura3, numero_factura: 3 });
    expect(r.mensaje).toMatch(/^\[Descargar PDF de la factura nº 3\]\(https:\/\/storage\.test\/facturas-pdf\//);
    expect(db.subidas).toEqual([{ bucket: 'facturas-pdf', path: `${NEGOCIO_A}/${IDS.factura3}.pdf` }]);
  });
  it('la factura nº 3 del otro negocio no es accesible desde este', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await handleEnlacesPdf('obtener_enlace_pdf_factura', { id: IDS.factura3Ajena }, NEGOCIO_A, USUARIO, db.client);
    expect(r).toMatchObject({ ok: false });
    expect(db.subidas).toHaveLength(0);
  });
  it('sin id ni número, error de validación', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    expect(await handleEnlacesPdf('obtener_enlace_pdf_factura', {}, NEGOCIO_A, USUARIO, db.client)).toMatchObject({ ok: false });
  });
});
