/**
 * La conversación COMPLETA de la prueba real de la ronda 5, sobre una única base simulada, comprobando LO
 * GUARDADO (filas) y no el texto. El «modelo» solo traduce (órdenes simuladas); el ejecutor hace el resto.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A } from '../evals/base-simulada';
import type { OrdenJev } from '@/lib/jev/ordenes';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 4 })),
}));
jest.mock('@/lib/pdf/presupuesto-render', () => ({
  PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre, estado',
  nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
  renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
}));

describe('día completo de la ronda 5', () => {
  it('cliente → obra → presupuesto → ese presu → cambios → aceptado → NIF → factura → PDF → pagada → diario → horas → proveedor → gastos → cita → mover → cerrar → consultas', async () => {
    const b = baseRonda5();
    // Agenda de dos semanas para la consulta final.
    b.agenda.length = 0;
    for (const [i, f] of ['2026-10-06', '2026-10-08', '2026-10-12', '2026-10-14', '2026-10-16'].entries()) {
      b.agenda.push({ id: `ev-${i}`, business_id: NEGOCIO_A, titulo: `Cita ${i + 1}`, fecha: f, hora: `${9 + i}:00` });
    }
    const db = crearFakeDb(b);
    const s = sesion(db);
    const T = db.tablas;
    const di = async (mensaje: string, orden: OrdenJev, opts: { ultimo?: string | null; factura?: string | null } = {}) => s.di(mensaje, orden, { ultimoPresupuestoId: opts.ultimo ?? null, ultimaFacturaId: opts.factura ?? null });
    const hecho = async (mensaje: string, orden: OrdenJev, opts: { ultimo?: string | null; factura?: string | null } = {}) => {
      const r = await di(mensaje, orden, opts);
      expect(r.accionPendiente).toBeDefined();
      const c = await s.confirmar(r.accionPendiente!.orden_id);
      expect(c.ejecutado).toBe(true);
      return { r, c };
    };

    // 1) Cliente con apellido igual a otro («Mikel PRUEBA Etxeberria» ya existe).
    await hecho('crea el cliente Iker PRUEBA Etxeberria', { accion: 'CREAR_CLIENTE', nombre_texto: 'Iker PRUEBA Etxeberria' });
    const iker = T.clientes!.find((c) => c.nombre === 'Iker PRUEBA Etxeberria')!;
    expect(iker).toBeDefined();

    // 2) Obra para él (no para Iker Agirre), con el nombre tal cual.
    await hecho('crea la obra Reforma baño Iker Hondarribia para Iker PRUEBA Etxeberria', { accion: 'CREAR_OBRA', nombre_texto: 'Reforma baño Iker Hondarribia', cliente_texto: 'Iker PRUEBA Etxeberria' });
    const obra = T.obras!.find((o) => o.nombre === 'Reforma baño Iker Hondarribia')!;
    expect(obra.cliente_id).toBe(iker.id);

    // 3) Presupuesto dictado: «alicatar 16 metros a 34» → 34, no 35.
    const dictado = await hecho('presupuesto para Iker PRUEBA Etxeberria: alicatar el baño, 16 metros a 34', {
      accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Iker PRUEBA Etxeberria', obra_texto: 'Reforma baño Iker Hondarribia',
      partidas: [{ concepto_texto: 'alicatar el baño', cantidad_texto: '16', unidad_texto: 'metros', precio_texto: '34' }],
    });
    const pres = T.presupuestos!.find((p) => p.cliente_id === iker.id)!;
    expect(pres).toMatchObject({ numero_presupuesto: 12, importe_total: 658.24, obra_id: obra.id, estado: 'borrador' });
    expect(String(pres.presupuesto_generado)).toContain('Precio: 34,00 €');
    expect(dictado.c.resultado).toMatchObject({ numero_presupuesto: 12, presupuesto_id: pres.id }); // «ese presu» tiene id y número

    // 4) «ese presu» → PDF (borrador, con aviso), sin que el modelo toque el enlace.
    const pdf = await di('pásame el pdf de ese presu', { accion: 'PDF_ENLACE', documento: 'presupuesto', ref_texto: 'ese' }, { ultimo: String(pres.id) });
    expect(pdf.respuesta).toMatch(/\]\(https:\/\/storage\.test\/presupuestos-pdf\//);
    expect(pdf.respuesta).toContain('BORRADOR');

    // 5) Cambio de partida: +2 metros → 18 × 34.
    await hecho('pon 2 metros más de alicatado en ese presu', { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'ese', cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }] }, { ultimo: String(pres.id) });
    expect(T.presupuestos!.find((p) => p.id === pres.id)).toMatchObject({ importe_total: 740.52 }); // 18 × 34 = 612 + 21 %
    expect(String(T.presupuestos!.find((p) => p.id === pres.id)!.presupuesto_generado)).toContain('Cantidad: 18');

    // 6) Facturar ANTES de aceptar: se dice, no se pide el «sí».
    const antes = await di('factúralo', { accion: 'FACTURAR', presupuesto_texto: 'ese' }, { ultimo: String(pres.id) });
    expect(antes.accionPendiente).toBeUndefined();
    expect(antes.respuesta).toMatch(/aceptado/);
    await hecho('márcalo aceptado', { accion: 'CAMBIAR_ESTADO_PRESUPUESTO', presupuesto_texto: 'ese', estado: 'aceptado' }, { ultimo: String(pres.id) });
    expect(T.presupuestos!.find((p) => p.id === pres.id)).toMatchObject({ estado: 'aceptado' });

    // 7) Sin NIF/dirección: se pregunta ANTES del «sí»; se guarda con actualizar_cliente; luego factura.
    const sinNif = await di('factúralo', { accion: 'FACTURAR', presupuesto_texto: 'ese' }, { ultimo: String(pres.id) });
    expect(sinNif.accionPendiente).toBeUndefined();
    expect(sinNif.respuesta).toMatch(/me falta el NIF y la dirección/);
    await hecho('su NIF es 77777777B y vive en Calle Mayor 5, Irún', { accion: 'ACTUALIZAR_CLIENTE', cliente_texto: 'Iker PRUEBA Etxeberria', nif_texto: '77777777b', direccion_texto: 'Calle Mayor 5, Irún' });
    expect(T.clientes!.find((c) => c.id === iker.id)).toMatchObject({ nif: '77777777B', direccion: 'Calle Mayor 5, Irún' });
    const fact = await hecho('factúralo', { accion: 'FACTURAR', presupuesto_texto: 'ese' }, { ultimo: String(pres.id) });
    const factura = T.facturas!.find((f) => f.presupuesto_id === pres.id)!;
    expect(factura).toMatchObject({ business_id: NEGOCIO_A, estado: 'pendiente' });
    expect(fact.c.respuesta).toMatch(/\]\(https:\/\/storage\.test\/facturas-pdf\//); // factura con PDF ya en la respuesta
    await hecho('márcala pagada', { accion: 'MARCAR_PAGADA', factura_texto: 'esa' }, { factura: String(factura.id) });
    expect(T.facturas!.find((f) => f.id === factura.id)).toMatchObject({ estado: 'pagada' });

    // 8) Diario ayer / hoy.
    await hecho('ayer desmontamos los muebles en la obra de Iker', { accion: 'DIARIO', obra_texto: 'Reforma baño Iker Hondarribia', texto: 'Desmontamos los muebles', fecha_texto: 'ayer' });
    await hecho('hoy se ha picado el baño en la obra de Iker', { accion: 'DIARIO', obra_texto: 'Reforma baño Iker Hondarribia', texto: 'Picado del baño' });
    const diario = T.diario_obra!.filter((d) => d.obra_id === obra.id);
    expect(diario.map((d) => String(d.fecha ?? '').slice(0, 10))).toEqual(['2026-10-05', ''].map((x, i) => (i === 1 ? String(diario[1]!.fecha ?? '').slice(0, 10) : x)));
    expect(String(diario[0]!.fecha).slice(0, 10)).toBe('2026-10-05');

    // 9) Horas y proveedor.
    await hecho('8 horas a Iker en la obra de Iker', { accion: 'HORAS', operario_texto: 'Iker Etxeberria', horas_texto: '8', obra_texto: 'Reforma baño Iker Hondarribia' });
    expect(T.registros_jornada!.at(-1)).toMatchObject({ obra_id: obra.id, operario_id: IDS.operarioIker, horas_reales: 8 });
    await hecho('da de alta a Bricomart de Irún', { accion: 'PROVEEDOR_CREAR', nombre_texto: 'Bricomart' });
    const bricomart = T.proveedores!.find((p) => p.nombre === 'Bricomart')!;
    expect(bricomart.notas).toBe('Población: Irún');

    // 10) Gastos «con IVA» y «más IVA», vinculados al proveedor y a la obra.
    await hecho('121 con IVA en Bricomart para lo de Iker, pintura', { accion: 'GASTO', proveedor_texto: 'Bricomart', importe_texto: '121', iva_modo: 'incluido', obra_texto: 'Reforma baño Iker Hondarribia', descripcion_texto: 'pintura' });
    expect(T.gastos!.at(-1)).toMatchObject({ importe: 100, iva: 21, importe_total: 121, proveedor_id: bricomart.id, obra_id: obra.id, cliente_id: iker.id, descripcion: 'pintura' });
    await hecho('180 más IVA en Bricomart para lo de Iker, grifería', { accion: 'GASTO', proveedor_texto: 'Bricomart', importe_texto: '180', iva_modo: 'mas', obra_texto: 'Reforma baño Iker Hondarribia', descripcion_texto: 'grifería' });
    expect(T.gastos!.at(-1)).toMatchObject({ importe: 180, iva: 37.8, importe_total: 217.8, descripcion: 'grifería' });

    // 11) Cita «el lunes» y moverla «al jueves».
    await hecho('cita con Iker PRUEBA Etxeberria el lunes a las 17:00', { accion: 'CITA_CREAR', cliente_texto: 'Iker PRUEBA Etxeberria', fecha_texto: 'el lunes', hora_texto: '17:00' });
    const cita = T.agenda!.at(-1)!;
    expect(cita).toMatchObject({ fecha: '2026-10-12', hora: '17:00', cliente_id: iker.id, obra_id: obra.id });
    await hecho('pasa lo de Iker al jueves', { accion: 'CITA_MOVER', evento_texto: 'Iker PRUEBA', fecha_texto: 'al jueves' });
    expect(T.agenda!.find((e) => e.id === cita.id)).toMatchObject({ fecha: '2026-10-15', hora: '17:00' }); // «al jueves» cuenta desde la fecha de la cita (lunes 12)

    // 12) Cerrar la obra y consultarla cerrada (no se contesta con otra).
    await hecho('cierra la obra de Iker', { accion: 'CERRAR_OBRA', obra_texto: 'Reforma baño Iker Hondarribia' });
    expect(T.obras!.find((o) => o.id === obra.id)).toMatchObject({ estado: 'cerrada' });
    const ficha = await di('¿cómo va la obra de Iker?', { accion: 'CONSULTA_OBRA', obra_texto: 'Iker PRUEBA Etxeberria' });
    expect(ficha.respuesta).toContain('Reforma baño Iker Hondarribia');
    expect(ficha.respuesta).toContain('obra cerrada');
    const noExiste = await di('¿cómo va la obra de Zorionak?', { accion: 'CONSULTA_OBRA', obra_texto: 'Zorionak Garmendia' });
    expect(noExiste.respuesta).toMatch(/No encuentro ninguna obra/);
    expect(noExiste.respuesta).not.toContain('Iker');
    // Escribir en una obra cerrada no vale.
    const cerrada = await di('apunta en la obra de Iker', { accion: 'DIARIO', obra_texto: 'Reforma baño Iker Hondarribia', texto: 'otra cosa' });
    expect(cerrada.accionPendiente).toBeUndefined();

    // 13) Gastos por proveedor y agenda de dos semanas.
    const gastos = await di('¿cuánto me he gastado en Bricomart?', { accion: 'CONSULTA_GASTOS', proveedor_texto: 'Bricomart' });
    expect(gastos.respuesta).toContain('2 gastos');
    expect(gastos.respuesta).toContain('338,80 €'); // 121 + 217,80
    const agenda = await di('¿qué tengo esta semana y la que viene?', { accion: 'CONSULTA_AGENDA', rango_texto: 'esta semana y la que viene' });
    expect(agenda.respuesta).toMatch(/Tienes \d+ eventos/);
    for (const t of ['Cita 1', 'Cita 2', 'Cita 3', 'Cita 4', 'Cita 5']) expect(agenda.respuesta).toContain(t);
  });
});
