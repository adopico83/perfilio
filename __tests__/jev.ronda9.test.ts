/**
 * Ronda 9: la IA entiende (clasificador de intención + traductor), el código decide. Aquí el modelo está SIMULADO: se prueba
 * todo lo que hace el SERVIDOR con cada intención, y los críticos de la prueba e2e estricta como casos, no como reglas a mano.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A, USUARIO } from '../evals/base-simulada';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { crearPendiente } from '@/lib/jev/pendientes';
import { confirmarOrdenJev, datosSinUsar, elegirOpcion } from '@/lib/jev/motor';
import { crearRunToolJev } from '@/lib/jev/despacho';
import { comprobarCoherencia } from '@/lib/jev/coherencia';
import { sanearCharla } from '@/lib/jev/dialogo';
import { horasEnTexto, minutosRelativos, numerosDelMensaje, parseHorasTexto, resolverHoraTexto, sumarMinutosHora, tramoHorasEnTexto } from '@/lib/jev/fechas';
import { corregirPartidasConDictado, validarPartidasContraDictado } from '@/lib/dictado-presupuesto';
import { crearFacturaDesdeAlbaran } from '@/lib/facturas/desde-albaran';
import { MENSAJE_NADA_PENDIENTE } from '@/lib/agente/orquestacion';

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

const FACTURA_ANE = o({ accion: 'CREAR_FACTURA', cliente_texto: 'Ane Mendia', importe_texto: '200', iva_modo: 'mas' });
const MSG_FACTURA = 'factura a Ane Mendia por 200 más IVA';

describe('1 · el clasificador decide; el servidor ejecuta solo con CONFIRMA + la orden que se enseñó', () => {
  it.each(['CANCELA', 'NUEVA', 'CORRIGE', 'VARIAS', 'RESPUESTA'] as const)('una orden pendiente + intención %s → nunca se ejecuta con ese mensaje', async (intencion) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di(MSG_FACTURA, FACTURA_ANE);
    const antes = db.tablas.facturas.length;
    // El traductor (simulado) intenta volver a proponer la misma orden: tras CANCELA no debe llegar ni a llamarse.
    await s.di('uy espera, esa no la hagas todavía', FACTURA_ANE, { intencion });
    expect(db.tablas.facturas).toHaveLength(antes);
  });
  it('CANCELA: cancela, no propone NADA en ese turno y un «ok» posterior no emite nada (factura nº 10 de la ronda 9)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di(MSG_FACTURA, FACTURA_ANE);
    expect(p.accionPendiente).toBeDefined();
    const r = await s.sinTraductor('uy espera, esa no la hagas todavía', 'CANCELA'); // sin traductor: ni se llama
    expect(r.respuesta).toBe('Vale, no hago nada.');
    expect(r.accionPendiente).toBeUndefined();
    const ok = await s.sinTraductor('ok', 'CONFIRMA');
    expect(ok.respuesta).toBe(MENSAJE_NADA_PENDIENTE);
    expect(db.tablas.facturas.some((f) => f.cliente_id === IDS.clienteAneMendia)).toBe(false);
  });
  it('CONFIRMA con el último mensaje del asistente = la confirmación de ESA orden → ejecuta; con otro mensaje delante → vuelve a enseñar', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di(MSG_FACTURA, FACTURA_ANE);
    s.decirAsistente('Te cuento otra cosa…');
    const re = await s.sinTraductor('venga, guárdalo', 'CONFIRMA');
    expect(re.accionPendiente?.orden_id).toBe(p.accionPendiente!.orden_id);
    expect(db.tablas.facturas.some((f) => f.cliente_id === IDS.clienteAneMendia)).toBe(false);
    s.decirAsistente(p.respuesta);
    const ok = await s.sinTraductor('venga, guárdalo', 'CONFIRMA');
    expect(ok.ejecutado).toBe(true);
  });
  it('clasificación DUDOSA con algo pendiente: no ejecuta, no descarta, vuelve a preguntar', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di(MSG_FACTURA, FACTURA_ANE);
    s.decirAsistente(p.respuesta);
    const r = await s.di('mmm sí, o no sé', o({ accion: 'CHARLA' }), { intencion: 'CONFIRMA', segura: false });
    expect(r.respuesta).toMatch(/No estoy seguro/);
    expect(r.accionPendiente?.orden_id).toBe(p.accionPendiente!.orden_id);
    expect(db.tablas.facturas.some((f) => f.cliente_id === IDS.clienteAneMendia)).toBe(false);
    // La pendiente sigue viva: un «sí» claro después sí la ejecuta.
    s.decirAsistente(r.respuesta);
    expect((await s.sinTraductor('sí', 'CONFIRMA')).ejecutado).toBe(true);
  });
  it('CONFIRMA sin nada pendiente → no hace nada', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    expect((await s.sinTraductor('adelante con ello', 'CONFIRMA')).respuesta).toBe(MENSAJE_NADA_PENDIENTE);
  });
  it('CORRIGE sin cambiar nada no vuelve a proponer la misma orden idéntica', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    await s.di(MSG_FACTURA, FACTURA_ANE);
    const r = await s.di('pues eso', FACTURA_ANE, { intencion: 'CORRIGE', continua: true });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No veo qué dato cambiar/);
  });
});

describe('4 · elegir una opción por palabras; si no encaja se repregunta (nunca es una orden nueva)', () => {
  const ops = [
    { n: 1, id: 'a', etiqueta: 'Ane Lasa' },
    { n: 2, id: 'b', etiqueta: 'Ane PRUEBA Zubizarreta' },
    { n: 3, id: 'c', etiqueta: 'Hernani · Calle Mayor' },
  ];
  it.each([['2', 'b'], ['la 2', 'b'], ['la segunda', 'b'], ['la Zubizarreta', 'b'], ['zubizarreta', 'b'], ['Ane Lasa', 'a'], ['la de Lasa', 'a'], ['el de Hernani', 'c']])('«%s» → %s', (txt, id) => {
    expect((elegirOpcion(txt, ops) as { id: string }).id).toBe(id);
  });
  it.each(['Ane', 'Pepe', 'ninguna cosa rara'])('«%s» no encaja con UNA sola → null', (txt) => {
    expect(elegirOpcion(txt, ops)).toBeNull();
  });
  it('«ninguna» y «sin obra» → ninguna', () => {
    expect(elegirOpcion('ninguna', ops)).toBe('ninguna');
  });
  it('«la Zubizarreta» como respuesta a «¿cuál Ane?» elige la opción y NO llama al traductor ni crea un cliente', async () => {
    const db = crearFakeDb(baseRonda5());
    db.tablas.clientes.push({ id: 'cli-ane-zub', business_id: NEGOCIO_A, nombre: 'Ane PRUEBA Zubizarreta', nif: '12121212X', direccion: 'Calle Z 1', telefono: null });
    const s = sesion(db);
    const q = await s.di('visita con Ane el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Ane', fecha_texto: 'el lunes', hora_texto: '10', notas_texto: 'ver azulejos' }), { categoria: 'agenda' });
    expect(q.opciones?.length).toBe(3);
    const r = await s.sinTraductor('la Zubizarreta', 'RESPUESTA');
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Ane PRUEBA Zubizarreta');
    expect(r.respuesta).toContain('ver azulejos'); // la nota no se pierde al elegir el cliente
    expect(db.tablas.clientes.filter((c) => /Zubizarreta/.test(String(c.nombre)))).toHaveLength(1);
  });
  it('una respuesta que no encaja repregunta con la misma lista (sin inventar nada)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('visita con Ane el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Ane', fecha_texto: 'el lunes', hora_texto: '10' }));
    const r = await s.sinTraductor('la de Pamplona', 'RESPUESTA');
    expect(r.accionPendiente).toBeUndefined();
    expect(r.opciones?.length).toBe(2);
    expect(r.respuesta).toMatch(/No sé cuál de estas/);
  });
});

describe('5 · la charla no puede simular una confirmación', () => {
  it.each(['Voy a poner la cita para el lunes. ¿Lo hago?', 'Preparado. ¿Lo guardo?', 'Perfecto, ¿confirmas?', '¿La registro?'])('«%s» se reconduce', (t) => {
    expect(sanearCharla(t)).toMatch(/No tengo ninguna acción preparada/);
  });
  it('una charla normal no se toca', () => {
    expect(sanearCharla('Aupa, ¿en qué te ayudo?')).toBe('Aupa, ¿en qué te ayudo?');
  });
});

describe('6-8 · huecos de la tarea, horas por tramo y lenguaje natural', () => {
  it('«a Aitor ponle media jornada» pregunta cuántas horas; «4» lo rellena conservando operario y obra', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('a Aitor ponle media jornada en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Aitor', obra_texto: 'Paqui' }), { categoria: 'operarios' });
    expect(q.respuesta).toMatch(/Cuántas horas/);
    const r = await s.sinTraductor('4', 'RESPUESTA'); // sin modelo para traducir: el hueco se rellena
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Aitor Gómez');
    expect(r.respuesta).toContain('4 h');
  });
  it('«Jon ayer estuvo de 8 a 2 y media en la fachada» → 6,5 h con el tramo; «6 y media» ya no se rechaza', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('Jon ayer estuvo de 8 a 2 y media en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Jon', horas_texto: 'de 8 a 2 y media', fecha_texto: 'ayer', obra_texto: 'Paqui' }), { categoria: 'operarios' });
    expect(p.respuesta).toContain('6,5 h (de 8:00 a 14:30)');
    const b = await sesion(crearFakeDb(baseRonda5())).di('Jon ayer estuvo de 8 a 2 y media en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6 y media', fecha_texto: 'ayer', obra_texto: 'Paqui' }));
    expect(b.respuesta).toContain('6,5 h');
  });
  it.each([
    ['de 8 a 2 y media', 6.5], ['de 7 a 3', 8], ['de 7 a 3 con media hora para comer', 7.5], ['de 7:30 a 15:30', 8], ['de siete a tres', 8], ['de 9 a 1 menos 45 minutos', 3.25],
  ])('tramo «%s» → %s h', (txt, h) => {
    expect(tramoHorasEnTexto(txt)?.horas).toBe(h);
    expect(parseHorasTexto(txt)).toBe(h);
  });
  it('«a primera hora» pregunta la hora; «a las 7 y media» la rellena y conserva el resto', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('el martes q viene a primera hora visita con Paqui', o({ accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el martes que viene', hora_texto: 'a primera hora' }), { categoria: 'agenda' });
    expect(q.respuesta).toMatch(/no es una hora exacta/);
    const r = await s.sinTraductor('a las 7 y media', 'RESPUESTA');
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('07:30');
    expect(r.respuesta).toContain('Paqui');
  });
  it('«muévela una hora más tarde» / «media hora antes» suman a la hora de ESA cita', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('muévela una hora más tarde', o({ accion: 'CITA_MOVER', evento_texto: 'ella', hora_texto: 'una hora más tarde' }), { ultimoEventoId: 'ev-mikel' }); // 10:30
    expect(r.respuesta).toContain('11:30');
    const r2 = await sesion(crearFakeDb(baseRonda5())).di('adelántala media hora', o({ accion: 'CITA_MOVER', evento_texto: 'ella', hora_texto: 'media hora antes' }), { ultimoEventoId: 'ev-mikel' });
    expect(r2.respuesta).toContain('10:00');
  });
  it.each([['una hora más tarde', 60], ['media hora antes', -30], ['dos horas después', 120], ['45 minutos antes', -45], ['a las 12', null]])('minutosRelativos(«%s») = %s', (t, m) => {
    expect(minutosRelativos(t)).toBe(m);
  });
  it('sumarMinutosHora', () => {
    expect(sumarMinutosHora('10:30', 60)).toBe('11:30');
    expect(sumarMinutosHora('00:15', -30)).toBeNull();
  });
  it.each([['a mediodía', '12:00'], ['a las siete y media', '07:30']])('hora «%s» → %s', (t, h) => {
    expect(resolverHoraTexto(t)).toEqual({ ok: true, hora: h });
  });
  it('«7 metros y medio», «metro y medio» y «treinta y cinco» cuentan como dichos', () => {
    expect(numerosDelMensaje('el rodapié déjalo en 7 metros y medio')).toContain(7.5);
    expect(numerosDelMensaje('un metro y medio de cable')).toContain(1.5);
    expect(numerosDelMensaje('treinta y cinco')).toContain(35);
  });
  it('«el rodapié déjalo en 7 metros y medio» → cantidad 7,5', async () => {
    const b = baseRonda5();
    b.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.presupuesto_generado =
      'CAPÍTULO BAÑO\n1. Rodapié | Cantidad: 5 | Precio: 8,00 € | Importe: 40,00 €\nTOTAL BAÑO: 40,00 €\nBASE IMPONIBLE: 40,00 € | IVA (21%): 8,40 € | TOTAL: 48,40 €';
    const r = await sesion(crearFakeDb(b)).di('el rodapié déjalo en 7 metros y medio', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', cambiar: [{ partida_texto: 'rodapié', cantidad_texto: '7 metros y medio' }] }), { ultimoPresupuestoId: IDS.presupuestoMikelBorrador });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/7,5 × 8/);
  });
  it('horasEnTexto no confunde un tramo con horas sueltas', () => {
    expect(horasEnTexto('Jon estuvo de 8 a 2 y media')).toEqual([6.5]);
  });
});

describe('9 · dictado con decimales', () => {
  const partida = (descripcion: string, cantidad: number, precio: number) => ({ descripcion, cantidad, unidad: 'm2', precio_unitario: precio, total: cantidad * precio, categoria: 'general' });
  it('«pintar fachada 120 m2 a 14,50» no se parte por la coma decimal: 120 × 14,50 = 1740', () => {
    const dictado = 'pintar fachada 120 m2 a 14,50, y limpiar andamio 3 horas a 20';
    const corr = corregirPartidasConDictado(dictado, [partida('pintar fachada', 120, 15), partida('limpiar andamio', 3, 20)]);
    expect(corr[0]).toMatchObject({ cantidad: 120, precio_unitario: 14.5, total: 1740 });
    expect(validarPartidasContraDictado(dictado, corr)).toBeNull();
  });
  it('en el chat: se propone 120 × 14,50 = 1740 y el total cuadra', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const r = await s.di('presu para Paqui: pintar fachada 120 m2 a 14,50', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'pintar fachada', cantidad_texto: '120', unidad_texto: 'm2', precio_texto: '14,50' }] }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/120 m2 × 14,50 € = 1740,00 €/);
  });
  it('una corrección posterior («pues 120 m2 a 15») sustituye la partida sin revalidar contra el dictado viejo', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    await s.di('presu para Paqui: pintar fachada 120 m2 a 14,50', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'pintar fachada', cantidad_texto: '120', unidad_texto: 'm2', precio_texto: '14,50' }] }));
    const r = await s.di('pues 120 m2 a 15, el resto igual', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'pintar fachada', cantidad_texto: '120', unidad_texto: 'm2', precio_texto: '15' }] }), { intencion: 'CORRIGE', continua: true });
    expect(r.respuesta).toMatch(/120 m2 × 15,00 € = 1800,00 €/);
    expect(r.accionPendiente).toBeDefined();
  });
});

describe('10 · restas y sustituciones parafraseadas', () => {
  const base = () => {
    const b = baseRonda5();
    b.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.presupuesto_generado =
      'CAPÍTULO FACHADA\n1. Pintar fachada | Cantidad: 135 | Precio: 15,00 € | Importe: 2.025,00 €\nTOTAL FACHADA: 2.025,00 €\nBASE IMPONIBLE: 2.025,00 € | IVA (21%): 425,25 € | TOTAL: 2.450,25 €';
    return b;
  };
  it.each([
    ['réstale 10 metros a lo de pintar', { sumar_cantidad_texto: '10', precio_texto: '15' }, '135 × 15 € → 125 × 15 €'],
    ['quita 10 metros a lo de pintar', { sumar_cantidad_texto: '-10' }, '135 × 15 € → 125 × 15 €'],
    ['10 metros menos en pintar fachada', { sumar_cantidad_texto: '10' }, '135 × 15 € → 125 × 15 €'],
    ['baja lo de pintar a 125', { cantidad_texto: '125', precio_texto: '15' }, '135 × 15 € → 125 × 15 €'],
  ])('«%s»', async (frase, campos, esperado) => {
    const r = await sesion(crearFakeDb(base())).di(frase, o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', cambiar: [{ partida_texto: 'pintar', ...campos }] }), { ultimoPresupuestoId: IDS.presupuestoMikelBorrador });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain(esperado);
  });
});

describe('11 · contexto de lo último tratado', () => {
  it('«pásala a las 12 entonces» con dos citas de Ane: gana la última tratada', async () => {
    const db = crearFakeDb(baseRonda5());
    db.tablas.agenda.push({ id: 'ev-ane-2', business_id: NEGOCIO_A, titulo: 'Visita con Ane Mendia', fecha: '2026-11-02', hora: '10:00' });
    const r = await sesion(db).di('pásala a las 12 entonces', o({ accion: 'CITA_MOVER', evento_texto: 'Ane', hora_texto: 'a las 12' }), { ultimoEventoId: 'ev-ane-2' });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Ane Mendia');
    const sin = await sesion(db).di('pásala a las 12 entonces', o({ accion: 'CITA_MOVER', evento_texto: 'Ane', hora_texto: 'a las 12' }));
    expect(sin.opciones?.length).toBe(2);
  });
  it('«el presu del baño de Mikel»: gana el de la obra del baño; o el último tratado', async () => {
    const b = baseRonda5();
    b.presupuestos.push(
      { id: 'pr-mikel-cocina', business_id: NEGOCIO_A, numero_presupuesto: 12, cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria, obra_id: IDS.obraLeire, estado: 'aceptado', importe_total: 1000, fecha: '2026-10-01', created_at: '2026-10-01T10:00:00Z', presupuesto_generado: '' }
    );
    const r = await sesion(crearFakeDb(b)).di('métele al presu del baño de Mikel un toallero de 95', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'baño de Mikel', anadir: [{ concepto_texto: 'toallero', cantidad_texto: '1', precio_texto: '95' }] }));
    expect(r.respuesta).toMatch(/nº 10/);
    expect(r.accionPendiente).toBeDefined();
  });
  it('el NIF con guion («44556677-L») se guarda en el cliente de la tarea y retoma la factura sola', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('factura a Ainhoa por 200 más IVA', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Ainhoa', importe_texto: '200', iva_modo: 'mas' }));
    const n = await s.sinTraductor('44556677-L', 'RESPUESTA');
    expect(n.accionPendiente).toBeDefined();
    const c = await s.confirmar(n.accionPendiente!.orden_id);
    expect(db.tablas.clientes.find((x) => x.id === IDS.clienteAinhoaEtxeberria)).toMatchObject({ nif: '44556677L' });
    expect(c.respuesta).toContain('Base 200,00 €');
  });
});

describe('13 · entidades: gastos con cliente + tema, proveedor frente a cliente, nombres parecidos', () => {
  const baseJosu = () => {
    const b = baseRonda5();
    b.clientes.push({ id: 'cli-josu', business_id: NEGOCIO_A, nombre: 'Josu PRUEBA Etxaniz Larrañaga', nif: '44556677L', direccion: 'Enparan kalea 4', telefono: null });
    b.obras.push(
      { id: 'obra-josu-tejado', business_id: NEGOCIO_A, nombre: 'tejado PRUEBA Azpeitia', direccion: 'Azpeitia', estado: 'en_curso', cliente_id: 'cli-josu', created_at: '2026-09-01T10:00:00Z' },
      { id: 'obra-josu-fachada', business_id: NEGOCIO_A, nombre: 'fachada PRUEBA Azpeitia', direccion: 'Azpeitia', estado: 'en_curso', cliente_id: 'cli-josu', created_at: '2026-09-02T10:00:00Z' }
    );
    b.proveedores.push({ id: 'prov-sanea', business_id: NEGOCIO_A, nombre: 'Saneamientos Bidasoa', nif: null, telefono: '943 000 111', email: null });
    return b;
  };
  it('GASTO: «ticket … pal tejado de Josu» se resuelve con cliente + tema', async () => {
    const r = await sesion(crearFakeDb(baseJosu())).di('ticket de Maderas Oria de 87,40 más IVA pal tejado de Josu', o({ accion: 'GASTO', proveedor_texto: 'Maderas Oria', importe_texto: '87,40', iva_modo: 'mas', obra_texto: 'pal tejado de Josu' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('tejado PRUEBA Azpeitia');
  });
  it('«factura de Saneamientos Bidasoa 300 + IVA pa la fachada de Josu» es un GASTO (proveedor), no una factura emitida', async () => {
    const db = crearFakeDb(baseJosu());
    const s = sesion(db);
    const r = await s.di('factura de Saneamientos Bidasoa 300 + IVA pa la fachada de Josu', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Saneamientos Bidasoa', importe_texto: '300', iva_modo: 'mas', obra_texto: 'la fachada de Josu' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/proveedor tuyo/);
    expect(r.respuesta).toMatch(/gasto/i);
    expect(r.respuesta).toContain('363,00 €'); // 300 + 63
    expect(r.respuesta).not.toMatch(/dar de alta/);
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.gastos.at(-1)).toMatchObject({ proveedor: 'Saneamientos Bidasoa', importe: 300, iva: 63, importe_total: 363, obra_id: 'obra-josu-fachada' });
  });
  it('«he quedado con los de Saneamientos en el tejado de Josu»: cita con Josu, proveedor en la nota, sin alta de cliente', async () => {
    const db = crearFakeDb(baseJosu());
    const s = sesion(db);
    const r = await s.di('el martes que viene a las 8 he quedado con los de Saneamientos en el tejado de Josu', o({ accion: 'CITA_CREAR', proveedor_texto: 'Saneamientos', cliente_texto: 'Josu', obra_texto: 'el tejado de Josu', fecha_texto: 'el martes que viene', hora_texto: 'a las 8' }), { categoria: 'agenda' });
    expect(r.respuesta).toMatch(/Cliente vinculado: Josu PRUEBA/);
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Saneamientos Bidasoa (tel. 943 000 111)');
    expect(r.respuesta).not.toMatch(/alta/i);
  });
  it('si no nombra al cliente, la cita se vincula al de la obra', async () => {
    const r = await sesion(crearFakeDb(baseJosu())).di('mañana a las 9 cita en el tejado de Josu', o({ accion: 'CITA_CREAR', obra_texto: 'el tejado de Josu', fecha_texto: 'mañana', hora_texto: 'a las 9' }), { categoria: 'agenda' });
    expect(r.respuesta).toMatch(/Cliente vinculado: Josu PRUEBA/);
  });
  it('crear el cliente «Josu» cuando ya existe «Josu PRUEBA Etxaniz Larrañaga» AVISA', async () => {
    const r = await sesion(crearFakeDb(baseJosu())).di('crea el cliente Josu', o({ accion: 'CREAR_CLIENTE', nombre_texto: 'Josu' }));
    expect(r.respuesta).toMatch(/Ya hay clientes con un nombre parecido \(Josu PRUEBA Etxaniz Larrañaga\)/);
  });
  it('«ábrele dos obras a Josu: el tejado y la fachada» → dos CREAR_OBRA encadenadas, ninguna perdida', async () => {
    const db = crearFakeDb(baseJosu());
    const s = sesion(db);
    const p = await s.di(
      'ábrele dos obras a Josu: el tejado y la fachada',
      o({ accion: 'CREAR_OBRA', nombre_texto: 'el tejado', cliente_texto: 'Josu' }),
      { otras: [o({ accion: 'CREAR_OBRA', nombre_texto: 'la fachada', cliente_texto: 'Josu' })], categoria: 'clientes' }
    );
    expect(p.respuesta).toMatch(/Después te pregunto por: .*obra/i);
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.accionPendiente).toBeDefined();
    await s.confirmar(c.accionPendiente!.orden_id);
    expect(db.tablas.obras.filter((x) => /tejado|fachada/.test(String(x.nombre)) && !/PRUEBA/.test(String(x.nombre))).map((x) => x.nombre).sort()).toEqual(['la fachada', 'el tejado'].sort());
  });
});

describe('14 · antiduplicados de gastos', () => {
  const gastoOtraObra = () => {
    const db = crearFakeDb(baseRonda5());
    db.tablas.gastos.push({ id: 'g-1', business_id: NEGOCIO_A, proveedor: 'Saltoki', importe: 100, iva: 21, importe_total: 121, fecha: '2026-10-06', categoria: 'material', descripcion: 'Cable', obra_id: IDS.obraPaqui });
    return db;
  };
  it('mismo proveedor, fecha e importe pero OTRA obra: se guarda (no es duplicado) y no avisa', async () => {
    const db = gastoOtraObra();
    const s = sesion(db);
    const p = await s.di('gasto de 121 en Saltoki para lo de Leire', o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', obra_texto: 'Leire' }));
    expect(p.respuesta).not.toMatch(/gasto igual/);
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.ejecutado).toBe(true);
    expect(db.tablas.gastos).toHaveLength(2);
  });
  it('igual en proveedor, fecha, importe y obra: AVISA antes del «Sí» y deja guardarlo igualmente', async () => {
    const db = gastoOtraObra();
    const s = sesion(db);
    const p = await s.di('gasto de 121 en Saltoki para lo de Paqui, cable', o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', obra_texto: 'Paqui', descripcion_texto: 'cable' }));
    expect(p.respuesta).toMatch(/ya hay un gasto igual/);
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.ejecutado).toBe(true);
    expect(db.tablas.gastos).toHaveLength(2);
  });
});

describe('2 · red de seguridad: datos del mensaje que ninguna orden ha usado', () => {
  it('datosSinUsar', () => {
    expect(datosSinUsar('apunta en el diario que hemos cambiado 20 tejas y ponle 4 horas a Jon', [{ accion: 'DIARIO', texto: 'hemos cambiado 20 tejas' }])).toMatch(/4 horas a Jon/);
    expect(datosSinUsar('ponle 8 horas a Iker', [{ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8' }])).toBeNull();
    expect(datosSinUsar('IVA al 21% de 100', [{ accion: 'GASTO', importe_texto: '100' }])).toBeNull();
    // una cifra tirada en la descripción no cuenta como recogida; un nombre con mayúscula que ninguna orden lleva, tampoco
    expect(datosSinUsar('apunta 87,40 de Saltoki y ponle 6 horas a Jon', [{ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', descripcion_texto: '6 horas de Jon' }])).toMatch(/6 horas a Jon/);
    expect(datosSinUsar('apunta 87,40 de Saltoki y de paso a Jon', [{ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }])).toMatch(/Jon/);
    expect(datosSinUsar('Hola, apunta 87,40 de Saltoki. Gracias', [{ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }])).toBeNull();
    expect(datosSinUsar('dos enchufes a 35', [{ accion: 'PRESUPUESTO_PARTIDAS', anadir: [{ cantidad_texto: 'dos', precio_texto: '35' }] }])).toBeNull();
  });
  it('un diario con horas de alguien detrás: si el traductor se las deja, el agente AVISA en vez de callarlo', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const r = await s.di('apunta en el diario de Paqui que hemos cambiado 20 tejas y ponle 4 horas a Jon ahí', o({ accion: 'DIARIO', obra_texto: 'Paqui', texto: 'hemos cambiado 20 tejas' }), { categoria: 'diario' });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/También me has dicho «.*4 horas a Jon.*» y eso no lo he preparado\. ¿Lo apunto después\?/);
  });
});

describe('3 · extras con IVA: lo que se muestra es lo que se guarda y lo que se factura', () => {
  it('«extra: toallero eléctrico, 95 más IVA»: se enseña 114,95, se guarda 114,95 y la factura suma 114,95', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('hazle un extra al presupuesto 7: toallero eléctrico 95 más IVA', o({ accion: 'EXTRA_PRESUPUESTO', presupuesto_texto: '7', descripcion_texto: 'toallero eléctrico', importe_texto: '95' }));
    expect(p.respuesta).toContain('114,95 €');
    await s.confirmar(p.accionPendiente!.orden_id);
    const extra = db.tablas.presupuestos.find((x) => x.es_extra === true)!;
    expect(extra.importe_total).toBe(114.95);
    extra.estado = 'aceptado';
    const r = await crearFacturaDesdeAlbaran(db.client, NEGOCIO_A, IDS.albaran12, { iva_porcentaje: 21 });
    expect(r.ok).toBe(true);
    const f = db.tablas.facturas.at(-1)!;
    expect(f.total).toBe(1324.95); // albarán 1.210 + extra 114,95
    expect(f.base_imponible).toBe(1095);
  });
  it('si el guardado no coincide con lo enseñado, NO se ejecuta (comprobación de coherencia)', async () => {
    const db = crearFakeDb(baseRonda5());
    const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
    const p = await crearPendiente(db.client, {
      businessId: NEGOCIO_A,
      userId: USUARIO,
      orden: o({ accion: 'EXTRA_PRESUPUESTO' }),
      accion: { tool: 'registrar_extra', args: { descripcion: 'toallero', importe: 95, presupuesto_parent_id: IDS.presupuesto7, notificar_cliente: false, _resuelto: true } },
      resumen: 'Voy a apuntar un EXTRA de 95,00 € (sin más).', // no enseña los 114,95 que se guardarían
    });
    expect(p.ok).toBe(true);
    const r = await confirmarOrdenJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, ordenId: (p as { id: string }).id, runTool });
    expect(r.respuesta).toMatch(/no coincide con lo que te enseñé/);
    expect(db.tablas.presupuestos.some((x) => x.es_extra === true)).toBe(false);
  });
  it('comprobarCoherencia: reglas por tool', () => {
    expect(comprobarCoherencia('registrar_extra', { importe: 95 }, 'EXTRA de 95,00 € (+21 % = 114,95 €)')).toBeNull();
    expect(comprobarCoherencia('registrar_extra', { importe: 95 }, 'EXTRA de 95,00 €')).toMatch(/114,95/);
    expect(comprobarCoherencia('crear_factura', { total: 242 }, 'Total 242,00 €')).toBeNull();
    expect(comprobarCoherencia('registrar_jornada', { horas_reales: 7.5 }, 'apuntar 7,5 h')).toBeNull();
    expect(comprobarCoherencia('registrar_jornada', { horas_reales: 7.5 }, 'apuntar 7 h')).toMatch(/horas/);
    expect(comprobarCoherencia('tool_sin_regla', {}, 'lo que sea')).toBeNull();
  });
  it('el extra sugerido por el aviso («extra: …») funciona contra ESE presupuesto, sin volver a preguntar presupuesto ni obra', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const aviso = await s.di('añádele dos enchufes a 35', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', anadir: [{ concepto_texto: 'enchufes', cantidad_texto: 'dos', precio_texto: '35' }] }));
    expect(aviso.respuesta).toMatch(/EXTRA/);
    const e = await s.di('extra: toallero eléctrico, 95 más IVA', o({ accion: 'EXTRA_PRESUPUESTO', presupuesto_texto: 'ese', descripcion_texto: 'toallero eléctrico', importe_texto: '95' }), { intencion: 'NUEVA' });
    expect(e.accionPendiente).toBeDefined();
    expect(e.respuesta).toContain('114,95 €');
    expect(e.respuesta).toContain('nº 11');
    expect(e.respuesta).not.toMatch(/Ficha de obra|¿Cuál es\?/);
  });
});

describe('unidades y datos con coma en los resúmenes', () => {
  it('un presupuesto que no existe: texto claro', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('factura el 999', o({ accion: 'FACTURAR', presupuesto_texto: '999' }));
    expect(escrituras(crearFakeDb(baseRonda5()))).toBe(0);
    expect(r.respuesta).toMatch(/El presupuesto nº 999 no existe/);
  });
});

describe('CONFIRMA sin nada pendiente', () => {
  it('«vale» suelto no hace nada; «el cliente ha dicho que sí, márcalo aceptado» es una orden nueva que pasa por el traductor', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const a = await s.sinTraductor('vale', 'CONFIRMA');
    expect(a.respuesta).toMatch(/pendiente/i);
    const b = await s.di('el cliente ha dicho que sí, márcalo aceptado', o({ accion: 'CAMBIAR_ESTADO_PRESUPUESTO', presupuesto_texto: 'ese', estado: 'aceptado' }), { ultimoPresupuestoId: IDS.presupuestoMikelBorrador, intencion: 'CONFIRMA' });
    expect(b.accionPendiente).toBeDefined();
  });
});

describe('copias del modelo y dudas de intención', () => {
  const gasto = { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' } as never;
  it('una orden idéntica a otra del mismo mensaje no se guarda dos veces y las horas no se pierden', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const horas = { accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' } as never;
    const p = await s.di('apunta 87,40 de Saltoki para lo de Leire y de paso ponle 6 horas a Jon en lo de Paqui', gasto, { otras: [gasto, horas], intencion: 'VARIAS', categoria: 'gastos' });
    const c1 = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c1.accionPendiente).toBeDefined();
    expect(c1.respuesta).toMatch(/Jon/);
    await s.confirmar(c1.accionPendiente!.orden_id);
    expect(db.tablas.gastos.length).toBe(1);
    expect(db.tablas.registros_jornada.length).toBe(1);
  });
  it('si el clasificador duda entre corregir y cancelar con una pendiente, corrige (no repregunta ni descarta)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('ponle 7 horas a Iker en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '7', obra_texto: 'Paqui' }), { categoria: 'operarios' });
    const r = await s.di('no, eran de Jon', o({ accion: 'HORAS', operario_texto: 'Jon', horas_texto: '7', obra_texto: 'Paqui' }), { continua: true, intencion: 'CORRIGE', segura: false, categoria: 'operarios' });
    expect(r.respuesta).toContain('Jon Arrieta');
    expect(r.accionPendiente).toBeDefined();
  });
});

describe('cita pendiente corregida por el modelo con CITA_MOVER', () => {
  it('«ponla el miércoles» sobre una cita PENDIENTE la corrige, no busca una cita guardada', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('apunta una cita con Paqui el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes', hora_texto: '10' }), { categoria: 'agenda' });
    const r = await s.di('ponla el miércoles mejor', o({ accion: 'CITA_MOVER', evento_texto: 'Cita con Paqui', fecha_texto: 'el miércoles' }), { continua: true, intencion: 'CORRIGE', categoria: 'agenda' });
    expect(r.respuesta).toContain('2026-10-07');
    expect(r.accionPendiente).toBeDefined();
  });
});

