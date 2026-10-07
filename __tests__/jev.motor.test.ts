import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A } from '../evals/base-simulada';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));

describe('jev: crear cliente (fallo 1 de la ronda 5)', () => {
  it('«Iker PRUEBA Etxeberria» se CREA aunque exista «Mikel PRUEBA Etxeberria» (no hay dedupe difuso)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const antes = db.tablas.clientes.length;
    const r = await s.di('crea el cliente Iker PRUEBA Etxeberria', { accion: 'CREAR_CLIENTE', nombre_texto: 'Iker PRUEBA Etxeberria' });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Iker PRUEBA Etxeberria');
    expect(r.respuesta).toMatch(/parecido/); // avisa de parecidos sin bloquear
    expect(db.tablas.clientes).toHaveLength(antes); // todavía nada guardado
    const c = await s.confirmar(r.accionPendiente!.orden_id);
    expect(c.ejecutado).toBe(true);
    expect(db.tablas.clientes).toHaveLength(antes + 1);
    expect(db.tablas.clientes.at(-1)).toMatchObject({ business_id: NEGOCIO_A, nombre: 'Iker PRUEBA Etxeberria' });
  });
  it('un nombre EXACTAMENTE igual no se duplica y se dice', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('crea el cliente Mikel prueba etxeberria', { accion: 'CREAR_CLIENTE', nombre_texto: 'mikel prueba etxeberria' });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/exactamente igual/);
  });
});

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

describe('jev: obra y cita con clientes parecidos (fallo 2)', () => {
  it('crear obra para «Iker PRUEBA»: el cliente es Iker PRUEBA Goikoetxea (no Iker Agirre) y el resumen lo muestra', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('crea la obra Reforma baño Iker Hondarribia para Iker PRUEBA', { accion: 'CREAR_OBRA', nombre_texto: 'Reforma baño Iker Hondarribia', cliente_texto: 'Iker PRUEBA' });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Iker PRUEBA Goikoetxea');
    expect(r.respuesta).toContain('«Reforma baño Iker Hondarribia»'); // nombre tal cual, con «Hondarribia»
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.obras.at(-1)).toMatchObject({ nombre: 'Reforma baño Iker Hondarribia', cliente_id: 'cli-iker-prueba', business_id: NEGOCIO_A });
  });
  it('«visita con Iker» con dos Iker: pregunta cuál (no elige) y «la 2» guarda ESE cliente', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('visita con Iker el lunes a las 5', { accion: 'CITA_CREAR', cliente_texto: 'Iker', fecha_texto: 'el lunes', hora_texto: 'las 5' });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.opciones?.map((o) => o.etiqueta)).toEqual(expect.arrayContaining(['Iker Agirre', 'Iker PRUEBA Goikoetxea']));
    const n = r.opciones!.find((o) => o.etiqueta === 'Iker PRUEBA Goikoetxea')!.n;
    const r2 = await s.sinTraductor(`la ${n}`); // sin modelo: se rellena el hueco con el id del resolvedor
    expect(r2.accionPendiente).toBeDefined();
    expect(r2.respuesta).toContain('Iker PRUEBA Goikoetxea');
    expect(r2.respuesta).toContain('2026-10-12'); // «el lunes» desde el martes 6 = lunes 12
    expect(r2.respuesta).toContain('17:00');
    await s.confirmar(r2.accionPendiente!.orden_id);
    expect(db.tablas.agenda.at(-1)).toMatchObject({ fecha: '2026-10-12', hora: '17:00', cliente_id: 'cli-iker-prueba' });
  });
});

describe('jev: gasto «180 más IVA» (fallo 3): lo guardado == lo mostrado', () => {
  it('base 180, IVA 37,80, total 217,80 en la vista previa Y en la base de datos', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('apunta 180 más IVA en Saltoki, cable y mecanismos', { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas', descripcion_texto: 'cable y mecanismos' });
    expect(r.respuesta).toContain('base 180,00 €');
    expect(r.respuesta).toContain('217,80 €');
    expect(r.respuesta).toContain('Saltoki');
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.gastos.at(-1)).toMatchObject({ importe: 180, iva: 37.8, importe_total: 217.8, proveedor_id: IDS.proveedorSaltoki, descripcion: 'cable y mecanismos' });
  });
  it('aunque el modelo diga «incluido», manda lo que dijo el usuario («más IVA»)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('apunta 250 más IVA en Saltoki', { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '250', iva_modo: 'incluido' });
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.gastos.at(-1)).toMatchObject({ importe: 250, importe_total: 302.5 });
  });
  it('«121 con IVA»: el total es 121', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('121 con IVA en Saltoki para lo de Leire', { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', iva_modo: 'incluido', obra_texto: 'Leire' });
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.gastos.at(-1)).toMatchObject({ importe: 100, iva: 21, importe_total: 121, obra_id: IDS.obraLeire, cliente_id: IDS.clienteLeire });
  });
  it('un importe que NO está en el mensaje se rechaza y se pregunta', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('apunta un gasto en Saltoki', { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '300' });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No veo el importe 300/);
    expect(db.tablas.gastos).toHaveLength(0);
  });
});

describe('jev: mover «al jueves» (fallo 4) y «el lunes» tras una corrección (fallo 5)', () => {
  it('«al jueves» cuenta desde la fecha de la CITA (martes 13): la vista previa dice 2026-10-15 y se guarda 2026-10-15', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('pasa lo de Mikel al jueves', { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al jueves' });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('2026-10-15');
    s.cambiarReloj('2026-10-07T20:00:00Z'); // confirma otro día: da igual, la acción ya está cerrada
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.agenda.find((e) => e.id === 'ev-mikel')).toMatchObject({ fecha: '2026-10-15' });
  });
  it('«no, con Iker PRUEBA» corrige solo el cliente y conserva «el lunes 17:00»; luego un «sí» escrito confirma', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const a = await s.di('cita con Mikel el lunes a las 5', { accion: 'CITA_CREAR', cliente_texto: 'Mikel PRUEBA Etxeberria', fecha_texto: 'el lunes', hora_texto: '17:00' });
    expect(a.accionPendiente).toBeDefined();
    // Corrige el cliente: el traductor solo trae lo nuevo (cliente); el resto se conserva de la tarea.
    const antes = await s.di('cita con Mikel el lunes a las 5', { accion: 'CITA_CREAR', cliente_texto: 'Mikel PRUEBA Etxeberria', fecha_texto: 'el lunes', hora_texto: '17:00' });
    expect(antes.respuesta).toContain('2026-10-12');
    // Tarea a medias: falta la hora → pregunta; luego se completa («a las 5») sin repetir el día.
    const b = await s.di('visita con Iker PRUEBA el lunes', { accion: 'CITA_CREAR', cliente_texto: 'Iker PRUEBA', fecha_texto: 'el lunes' });
    expect(b.respuesta).toMatch(/¿A qué hora\?/);
    const c = await s.di('a las 5', { accion: 'CITA_CREAR', fecha_texto: 'el lunes', hora_texto: 'las 5', cliente_texto: undefined as unknown as null }, { continua: true });
    expect(c.respuesta).toContain('2026-10-12');
    expect(c.respuesta).toContain('Iker PRUEBA Goikoetxea');
    expect(c.respuesta).toContain('17:00');
    // Un «sí» ESCRITO confirma solo la orden pendiente real, sin pasar por el modelo.
    const d = await s.sinTraductor('sí');
    expect(d.ejecutado).toBe(true);
    expect(db.tablas.agenda.at(-1)).toMatchObject({ fecha: '2026-10-12', hora: '17:00', cliente_id: 'cli-iker-prueba' });
  });
  it('un «sí» escrito sin nada pendiente no hace nada', async () => {
    const db = crearFakeDb(baseRonda5());
    const antes = JSON.stringify(db.tablas);
    const r = await sesion(db).sinTraductor('sí');
    expect(r.respuesta).toMatch(/No tengo nada pendiente/);
    expect(JSON.stringify(db.tablas)).toBe(antes);
  });
});

describe('jev: enlaces y consultas por plantilla (fallos 6 y 7)', () => {
  it('el enlace del PDF sale tal cual de la tool: ni el modelo ni Maps lo tocan', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('pásame el pdf del 10', { accion: 'PDF_ENLACE', documento: 'presupuesto', ref_texto: '10' });
    const url = r.respuesta.match(/\]\((https:\/\/storage\.test[^)]+)\)/)?.[1];
    expect(url).toBeTruthy();
    expect(r.respuesta).not.toMatch(/maps\.google/);
    expect(r.respuesta).toContain('BORRADOR'); // el nº 10 está en borrador
  });
  it('«¿qué tengo esta semana y la que viene?» devuelve TODOS los eventos del rango', async () => {
    const b = baseRonda5();
    b.agenda.length = 0;
    for (const [i, f] of ['2026-10-06', '2026-10-08', '2026-10-12', '2026-10-14', '2026-10-18'].entries()) {
      b.agenda.push({ id: `ev-${i}`, business_id: NEGOCIO_A, titulo: `Cita ${i + 1}`, fecha: f, hora: `${9 + i}:00` });
    }
    b.agenda.push({ id: 'ev-fuera', business_id: NEGOCIO_A, titulo: 'Fuera de rango', fecha: '2026-10-19', hora: '10:00' });
    const db = crearFakeDb(b);
    const r = await sesion(db).di('¿qué tengo esta semana y la que viene?', { accion: 'CONSULTA_AGENDA', rango_texto: 'esta semana y la que viene' });
    expect(r.respuesta).toContain('Tienes 5 eventos');
    for (let i = 1; i <= 5; i++) expect(r.respuesta).toContain(`Cita ${i}`);
    expect(r.respuesta).not.toContain('Fuera de rango');
  });
  it('un nombre de proveedor no se convierte en enlace de Maps (consulta de gastos)', async () => {
    const b = baseRonda5();
    b.gastos = [{ id: 'g1', business_id: NEGOCIO_A, proveedor: 'Calle Mayor Saltoki', fecha: '2026-10-01', importe: 10, iva: 2.1, importe_total: 12.1, categoria: 'material' }];
    const r = await sesion(crearFakeDb(b)).di('cuánto he gastado en Saltoki', { accion: 'CONSULTA_GASTOS', proveedor_texto: 'Saltoki' });
    expect(r.respuesta).toContain('Calle Mayor Saltoki');
    expect(r.respuesta).not.toMatch(/maps\.google/);
  });
});
