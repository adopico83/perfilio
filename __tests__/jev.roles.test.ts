/** Contrato de roles: un nombre del lado equivocado de la base de datos NUNCA acaba en una orden preparada ni en una escritura. */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { NEGOCIO_A, USUARIO } from '../evals/base-simulada';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { prepararOrden } from '@/lib/jev/ejecutor';
import { crearRunToolJev } from '@/lib/jev/despacho';
import { ACCIONES_CON_CONTRATO, contratoDe, validarPlan } from '@/lib/jev/roles';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/presupuesto-render', () => ({
  PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre, estado',
  nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
  renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
}));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

const o = (x: Record<string, unknown>) => x as unknown as OrdenJev;
const escrituras = (db: ReturnType<typeof crearFakeDb>) =>
  db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;

function ctxDe(db: ReturnType<typeof crearFakeDb>, mensaje: string) {
  return {
    supabase: db.client,
    businessId: NEGOCIO_A,
    userId: USUARIO,
    ahora: new Date('2026-10-06T10:00:00Z'),
    mensajes: [mensaje],
    resueltos: {},
    runTool: crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO }),
  };
}

describe('el contrato sale del esquema de cada acción', () => {
  it('cada acción con huecos de cliente, proveedor o documento tiene contrato', () => {
    expect(ACCIONES_CON_CONTRATO).toEqual(expect.arrayContaining(['CREAR_FACTURA', 'FACTURAR', 'GASTO', 'CITA_CREAR', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS']));
    expect(contratoDe('GASTO')).toMatchObject({ proveedor_texto: 'proveedor', cliente_texto: 'cliente' });
    expect(contratoDe('CITA_CREAR')).toMatchObject({ cliente_texto: 'cualquiera', proveedor_texto: 'proveedor' });
    expect(contratoDe('FACTURAR')).toMatchObject({ presupuesto_texto: 'documento', albaran_texto: 'documento' });
  });
});

describe('rol equivocado en cualquier hueco de cualquier acción → no se prepara nada', () => {
  const casos: Array<[string, string, string, string]> = ACCIONES_CON_CONTRATO.flatMap((a) =>
    Object.entries(contratoDe(a)).flatMap(([campo, rol]) => {
      if (rol === 'cliente' || rol === 'documento') return [[a, campo, 'Saltoki', 'proveedor en hueco de cliente'] as [string, string, string, string]];
      if (rol === 'proveedor') return [[a, campo, 'Paqui', 'cliente en hueco de proveedor'] as [string, string, string, string]];
      return [];
    })
  );
  it('hay casos', () => expect(casos.length).toBeGreaterThan(15));
  it.each(casos)('%s.%s = «%s» (%s)', async (accion, campo, nombre) => {
    const db = crearFakeDb(baseRonda5());
    const r = await prepararOrden(o({ accion, [campo]: nombre, importe_texto: '120', iva_modo: 'mas' }), ctxDe(db, `algo de ${nombre} 120 más IVA`));
    if (accion === 'CREAR_FACTURA' && campo === 'cliente_texto') {
      // La única excepción: una factura a un proveedor se reencamina a GASTO, con aviso, y sigue esperando el «Sí».
      expect(r.tipo === 'pendiente' ? r.resumen : '').toMatch(/proveedor tuyo[\s\S]*GASTO/);
    } else {
      expect(r.tipo).toBe('pregunta');
      expect(r.tipo === 'pregunta' ? r.slot : '').toBe('rol');
    }
    expect(escrituras(db)).toBe(0);
  });
  it('un nombre que está como cliente Y como proveedor → pregunta cuál', async () => {
    const b = baseRonda5();
    b.clientes.push({ id: 'cli-oria', business_id: NEGOCIO_A, nombre: 'Maderas Oria', telefono: '600000000' });
    const db = crearFakeDb(b);
    const r = await prepararOrden(o({ accion: 'GASTO', proveedor_texto: 'Maderas Oria', importe_texto: '100', iva_modo: 'mas' }), ctxDe(db, 'gasto de Maderas Oria 100 más IVA'));
    expect(r.tipo).toBe('pregunta');
    expect(r.tipo === 'pregunta' ? r.texto : '').toMatch(/cliente y también como proveedor/);
    expect(escrituras(db)).toBe(0);
  });
  it('una cita puede ser con un proveedor (rol «cualquiera»)', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await prepararOrden(o({ accion: 'CITA_CREAR', cliente_texto: 'Maderas Oria', fecha_texto: 'el lunes', hora_texto: 'a las 8' }), ctxDe(db, 'visita con Maderas Oria el lunes a las 8'));
    expect(r.tipo).toBe('pendiente');
  });
});

describe('FACTURAR nunca elige un presupuesto', () => {
  it('sin presupuesto nombrado y sin «ese» con contexto real → pregunta', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await prepararOrden(o({ accion: 'FACTURAR' }), ctxDe(db, 'hazme una factura'));
    expect(r.tipo).toBe('pregunta');
    expect(r.tipo === 'pregunta' ? r.texto : '').toMatch(/qué presupuesto/);
  });
});

describe('plan de varias órdenes: un proveedor nombrado no se convierte en factura de cliente', () => {
  const MSG = 'Aitor 4 y media en lo de Paqui; también la factura de Saltoki de 120 más IVA de lo de Leire';
  const horas = o({ accion: 'HORAS', operario_texto: 'Aitor', horas_texto: '4 y media', obra_texto: 'Paqui' });

  it.each([
    ['FACTURAR a nombre de Leire', { accion: 'FACTURAR', presupuesto_texto: 'Leire' }],
    ['CREAR_FACTURA a Leire por 120', { accion: 'CREAR_FACTURA', cliente_texto: 'Leire', importe_texto: '120', iva_modo: 'mas' }],
    ['FACTURAR vacío', { accion: 'FACTURAR' }],
  ])('HORAS + %s → solo se prepara HORAS, con aviso, y no se escribe nada', async (_n, falsa) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di(MSG, horas, { otras: [o(falsa)], intencion: 'VARIAS', categoria: 'general' });
    expect(r.respuesta).toMatch(/Aitor/);
    expect(r.respuesta).toMatch(/«Saltoki» es un proveedor tuyo, no un cliente: no he creado ninguna factura/);
    expect(r.accionPendiente).toBeDefined();
    expect(escrituras(db)).toBe(0);
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.facturas.length).toBe(baseRonda5().facturas.length);
    expect(db.tablas.registros_jornada.length).toBe(1);
  });

  it('si el plan es solo el documento falso, no se prepara nada y se explica', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('la factura de Saltoki de 120 más IVA de lo de Leire', o({ accion: 'FACTURAR', presupuesto_texto: 'Leire' }), { categoria: 'general' });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/es un proveedor tuyo/);
    expect(escrituras(db)).toBe(0);
  });

  it('un GASTO de ese proveedor en el plan SÍ lo cubre (no se bloquea nada)', async () => {
    const db = crearFakeDb(baseRonda5());
    const plan = await validarPlan(db.client, NEGOCIO_A, MSG, [horas as never, { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '120', iva_modo: 'mas', obra_texto: 'Leire' } as never]);
    expect(plan.avisos).toEqual([]);
    expect(plan.ordenes.length).toBe(2);
  });

  it('un documento de OTRA frase que no habla del proveedor no se bloquea', async () => {
    const db = crearFakeDb(baseRonda5());
    const msg = 'Hazle una factura a Paqui por 200 más IVA; compré tubos en Saltoki por 30 con IVA para lo de Leire';
    const plan = await validarPlan(db.client, NEGOCIO_A, msg, [{ accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', importe_texto: '200', iva_modo: 'mas' } as never]);
    expect(plan.ordenes.length).toBe(1);
  });
});
