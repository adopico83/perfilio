import { crearFakeDb } from './helpers/fake-db';
import { MARTES, baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A, NEGOCIO_B, USUARIO } from '../evals/base-simulada';
import { cargarPendiente } from '@/lib/jev/pendientes';
import { confirmarOrdenJev, procesarMensajeJev } from '@/lib/jev/motor';
import { crearRunToolJev } from '@/lib/jev/despacho';
import { ejecutarOrdenMcp } from '@/lib/jev/mcp';
import type { OrdenJev } from '@/lib/jev/ordenes';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

const CASOS: Array<{ mensaje: string; orden: OrdenJev }> = [
  { mensaje: 'crea el cliente Iker PRUEBA Etxeberria', orden: { accion: 'CREAR_CLIENTE', nombre_texto: 'Iker PRUEBA Etxeberria' } },
  { mensaje: 'crea la obra Reforma baño Hondarribia para Mikel Etxeberria', orden: { accion: 'CREAR_OBRA', nombre_texto: 'Reforma baño Hondarribia', cliente_texto: 'Mikel Etxeberria' } },
  { mensaje: '180 más IVA en Saltoki, cable', orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas', descripcion_texto: 'cable' } },
  { mensaje: 'cita con Mikel el lunes a las 10 y media', orden: { accion: 'CITA_CREAR', cliente_texto: 'Mikel Etxeberria', fecha_texto: 'el lunes', hora_texto: '10 y media' } },
  { mensaje: 'pasa lo de Mikel al jueves', orden: { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al jueves' } },
  { mensaje: 'ponle 8 horas a Iker en lo de Paqui', orden: { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui' } },
  { mensaje: 'ayer desmontamos los muebles en lo de Leire', orden: { accion: 'DIARIO', obra_texto: 'Leire', texto: 'Desmontamos los muebles', fecha_texto: 'ayer' } },
  { mensaje: 'el NIF de Ainhoa es 44444444B', orden: { accion: 'ACTUALIZAR_CLIENTE', cliente_texto: 'Ainhoa Etxeberria', nif_texto: '44444444B' } },
  { mensaje: 'márcalo aceptado', orden: { accion: 'CAMBIAR_ESTADO_PRESUPUESTO', presupuesto_texto: '10', estado: 'aceptado' } },
  { mensaje: 'quítale la mampara y 2 metros más de alicatado al 10', orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', quitar_texto: ['mampara'], cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }] } },
  { mensaje: 'marca la factura 3 como pagada', orden: { accion: 'MARCAR_PAGADA', factura_texto: '3' } },
  { mensaje: 'cierra la obra de Leire', orden: { accion: 'CERRAR_OBRA', obra_texto: 'Leire' } },
  { mensaje: 'da de alta a Bricomart de Irún', orden: { accion: 'PROVEEDOR_CREAR', nombre_texto: 'Bricomart' } },
  { mensaje: 'hazme un presupuesto para Paqui: alicatar 16 metros a 34', orden: { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '16', precio_texto: '34' }] } },
];

describe('PROPIEDAD: para toda orden confirmada, lo ejecutado == lo mostrado', () => {
  it.each(CASOS.map((c) => [c.mensaje, c] as const))('«%s»', async (_m, caso) => {
    const db = crearFakeDb(baseRonda5());
    const base = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
    const llamadas: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const s = sesion(db);
    // Se espía lo que realmente se ejecuta (después del «Sí»).
    const runTool = async (tool: string, args: Record<string, unknown>) => {
      llamadas.push({ tool, args: JSON.parse(JSON.stringify(args)) });
      return base(tool, args);
    };
    const sesionEspia = (mensaje: string, orden: OrdenJev) =>
      procesarMensajeJev({
        supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, mensaje, categoria: 'general', hoyTexto: 'martes', ahora: new Date(MARTES), runTool,
        traducir: async () => ({ orden, continuaTarea: false }),
      });
    void s;
    const r = await sesionEspia(caso.mensaje, caso.orden);
    expect(r.accionPendiente).toBeDefined();
    // Lo guardado en el servidor al proponer (y mostrar):
    const guardada = await cargarPendiente(db.client, r.accionPendiente!.orden_id, NEGOCIO_A, USUARIO);
    expect(guardada.ok).toBe(true);
    const mostrada = guardada.ok ? guardada.pendiente.accion : null;
    llamadas.length = 0; // las vistas previas no cuentan: solo lo que se ejecuta tras el «Sí»
    const c = await confirmarOrdenJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, ordenId: r.accionPendiente!.orden_id, runTool });
    expect(c.ejecutado).toBe(true);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toEqual({ tool: mostrada!.tool, args: mostrada!.args });
  });
});

describe('seguridad: ids y args del navegador o del modelo', () => {
  async function propuesta() {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('cierra la obra de Leire', { accion: 'CERRAR_OBRA', obra_texto: 'Leire' });
    return { db, s, id: r.accionPendiente!.orden_id };
  }
  it('el navegador no recibe los args y el resumen sale de lo guardado', async () => {
    const { db, id } = await propuesta();
    const fila = db.tablas.jev_ordenes_pendientes!.find((f) => f.id === id)!;
    expect((fila.args_resueltos as { args: Record<string, unknown> }).args).toMatchObject({ obra_id: IDS.obraLeire, estado: 'cerrada' });
  });
  it('un orden_id inventado, de otro negocio o de otro usuario se rechaza y no ejecuta nada', async () => {
    const { db, id } = await propuesta();
    const base = { supabase: db.client, runTool: crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO }) };
    const escrituras = () => db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;
    for (const [negocio, usuario, orden] of [
      [NEGOCIO_A, USUARIO, 'id-inventado'],
      [NEGOCIO_B, USUARIO, id],
      [NEGOCIO_A, 'otro-usuario', id],
    ] as const) {
      const r = await confirmarOrdenJev({ ...base, businessId: negocio, userId: usuario, ordenId: orden });
      expect(r.ejecutado).toBeFalsy();
      expect(r.respuesta).toMatch(/No encuentro|No hago nada|ya se ha usado/);
    }
    expect(escrituras()).toBe(0);
    expect(db.tablas.obras!.find((o) => o.id === IDS.obraLeire)).toMatchObject({ estado: 'en_curso' });
  });
  it('una orden caducada o ya usada no se ejecuta; solo una confirmación puede ganar', async () => {
    const { db, id } = await propuesta();
    const base = { supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, runTool: crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO }) };
    const [a, b] = await Promise.all([confirmarOrdenJev({ ...base, ordenId: id }), confirmarOrdenJev({ ...base, ordenId: id })]);
    expect([a.ejecutado, b.ejecutado].filter(Boolean)).toHaveLength(1);
    const otra = await confirmarOrdenJev({ ...base, ordenId: id });
    expect(otra.respuesta).toMatch(/ya se ha usado/);

    const p2 = await propuesta();
    const fila = p2.db.tablas.jev_ordenes_pendientes!.find((f) => f.id === p2.id)!;
    fila.expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await confirmarOrdenJev({ supabase: p2.db.client, businessId: NEGOCIO_A, userId: USUARIO, ordenId: p2.id, runTool: crearRunToolJev({ supabase: p2.db.client, businessId: NEGOCIO_A, userId: USUARIO }) });
    expect(r.respuesta).toMatch(/caducado/);
    expect(p2.db.tablas.obras!.find((o) => o.id === IDS.obraLeire)).toMatchObject({ estado: 'en_curso' });
  });
  it('un «No» escrito cancela la pendiente y un «sí» posterior ya no hace nada', async () => {
    const { db, s, id } = await propuesta();
    const no = await s.sinTraductor('no');
    expect(no.respuesta).toMatch(/no hago nada/i);
    const si = await s.sinTraductor('sí');
    expect(si.respuesta).toMatch(/No tengo nada pendiente/);
    expect(db.tablas.obras!.find((o) => o.id === IDS.obraLeire)).toMatchObject({ estado: 'en_curso' });
    const fila = db.tablas.jev_ordenes_pendientes!.find((f) => f.id === id)!;
    expect(fila.estado).toBe('cancelada');
  });
  it('una propuesta nueva sustituye a la anterior (solo hay una viva)', async () => {
    const { db, s, id } = await propuesta();
    const r2 = await s.di('da de alta a Bricomart', { accion: 'PROVEEDOR_CREAR', nombre_texto: 'Bricomart' });
    expect(r2.accionPendiente!.orden_id).not.toBe(id);
    const vieja = db.tablas.jev_ordenes_pendientes!.find((f) => f.id === id)!;
    expect(vieja.estado).toBe('cancelada');
  });
  it('un id que NO salió del resolvedor no entra: el obra_texto desconocido se pregunta, no se inventa', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('diario en la obra Zorionak', { accion: 'DIARIO', obra_texto: 'Zorionak Garmendia', texto: 'x' });
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No encuentro ninguna obra/);
  });
  it('las órdenes confirmadas de otro negocio no tocan datos de este (misma orden, otro negocio)', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('cierra la obra', { accion: 'CERRAR_OBRA', obra_texto: 'Reforma Paqui' });
    // La obra «Reforma Paqui» existe en A y en B: solo se cierra la de A.
    await sesion(db).confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.obras!.find((o) => o.id === IDS.obraPaqui)).toMatchObject({ estado: 'cerrada' });
    expect(db.tablas.obras!.find((o) => o.id === IDS.obraPaquiAjena)).toMatchObject({ estado: 'en_curso' });
  });
});

describe('importes: tienen que estar en lo que dijo el usuario (o salir de un cálculo sobre ello)', () => {
  it('partidas del dictado: una cantidad o un precio inventados se rechazan', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const a = await s.di('presupuesto para Paqui: alicatar 12 metros', { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '15', precio_texto: '40' }] });
    expect(a.respuesta).toMatch(/No veo la cantidad 15/);
    const b = await s.di('presupuesto para Paqui: alicatar 12 metros a 40', { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '12', precio_texto: '35' }] });
    expect(b.respuesta).toMatch(/No veo ese precio/);
    expect(db.tablas.presupuestos!.filter((p) => p.cliente_nombre === 'Paqui' && p.estado === 'borrador')).toHaveLength(0);
  });
  it('sin cantidad NO se estima: se pregunta', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('presupuesto para Paqui: demolición de tabique', { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'demolición de tabique' }] });
    expect(r.respuesta).toMatch(/¿Cuántos metros/);
  });
  it('sin precio dicho se usa la tarifa y se AVISA', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('presupuesto para Paqui: alicatar 10 metros', { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatado', cantidad_texto: '10', unidad_texto: 'metros' }] });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/Precio de tu tarifa/);
    expect(r.respuesta).toContain('35,00 €');
  });
  it('horas: un número de horas que no dijo se rechaza', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('ponle horas a Iker en lo de Paqui', { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui' });
    expect(r.respuesta).toMatch(/No veo cuántas horas/);
    expect(db.tablas.registros_jornada ?? []).toHaveLength(0);
  });
  it('modificar partidas: añadir sin precio no inventa; con precio que no dijo, se rechaza', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const a = await s.di('añade fontanería al 10', { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', anadir: [{ concepto_texto: 'fontanería', cantidad_texto: '1' }] });
    expect(a.respuesta).toMatch(/a cuánto es/i);
    const b = await s.di('añade fontanería 1 ud al 10', { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', anadir: [{ concepto_texto: 'fontanería', cantidad_texto: '1', precio_texto: '300' }] });
    expect(b.respuesta).toMatch(/No veo el precio/);
  });
});

describe('fechas relativas desde cada día de la semana (también si el día se dijo en un mensaje anterior)', () => {
  // Para cada «hoy» (lunes 5 … domingo 11 de octubre de 2026), «el lunes» es el próximo lunes (hoy si es lunes).
  const PROXIMO_LUNES: Record<string, string> = {
    '2026-10-05': '2026-10-05', '2026-10-06': '2026-10-12', '2026-10-07': '2026-10-12', '2026-10-08': '2026-10-12',
    '2026-10-09': '2026-10-12', '2026-10-10': '2026-10-12', '2026-10-11': '2026-10-12',
  };
  const PROXIMO_JUEVES: Record<string, string> = {
    '2026-10-05': '2026-10-08', '2026-10-06': '2026-10-08', '2026-10-07': '2026-10-08', '2026-10-08': '2026-10-08',
    '2026-10-09': '2026-10-15', '2026-10-10': '2026-10-15', '2026-10-11': '2026-10-15',
  };
  it.each(Object.keys(PROXIMO_LUNES))('hoy %s: «el lunes» y «al jueves»', async (hoy) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db, `${hoy}T10:00:00Z`);
    const a = await s.di('cita con Paqui el lunes a las 10', { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes', hora_texto: '10' });
    expect(a.respuesta).toContain(PROXIMO_LUNES[hoy]!);
    const b = await s.di('pasa lo de Mikel al jueves', { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al jueves' });
    expect(b.respuesta).toContain(PROXIMO_JUEVES[hoy]!);
  });
  it.each(Object.keys(PROXIMO_LUNES))('hoy %s: el día se dijo en un mensaje anterior y la hora llega después', async (hoy) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db, `${hoy}T10:00:00Z`);
    const a = await s.di('cita con Paqui el lunes', { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes' });
    expect(a.respuesta).toMatch(/¿A qué hora\?/);
    // El segundo mensaje NO repite el día: «a las 5» → se conserva «el lunes» de la tarea en curso.
    const b = await s.di('a las 5', { accion: 'CITA_CREAR', hora_texto: 'las 5', fecha_texto: undefined as unknown as string }, { continua: true });
    expect(b.respuesta).toContain(PROXIMO_LUNES[hoy]!);
    expect(b.respuesta).toContain('17:00');
    await s.sinTraductor('sí');
    expect(db.tablas.agenda!.at(-1)).toMatchObject({ fecha: PROXIMO_LUNES[hoy], hora: '17:00', cliente_id: IDS.clientePaqui });
  });
  it('a las 00:30 de Madrid «hoy» es ya el día siguiente en UTC', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db, '2026-10-06T22:30:00Z'); // 00:30 del miércoles 7 en Madrid
    const r = await s.di('cita con Paqui mañana a las 9', { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'mañana', hora_texto: '9' });
    expect(r.respuesta).toContain('2026-10-08');
    const d = await s.di('ayer apunté horas', { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'x', fecha_texto: 'ayer' });
    expect(d.respuesta).toContain('2026-10-06');
  });
});

describe('misma orden por chat y por MCP → mismo resultado', () => {
  it('HORAS: el chat y el MCP guardan la misma fila', async () => {
    const dbChat = crearFakeDb(baseRonda5());
    const s = sesion(dbChat);
    const r = await s.di('8 horas a Iker en Paqui', { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui', fecha_texto: '2026-10-05' });
    await s.confirmar(r.accionPendiente!.orden_id);

    const dbMcp = crearFakeDb(baseRonda5());
    const m = await ejecutarOrdenMcp(
      { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui', fecha_texto: '2026-10-05' },
      { supabase: dbMcp.client, businessId: NEGOCIO_A, userId: USUARIO },
      { mensajes: ['Iker Paqui 8 2026-10-05'], ahora: new Date(MARTES) }
    );
    expect(m.ok).toBe(true);
    const quitaId = ({ id: _i, ...resto }: Record<string, unknown>) => (void _i, resto);
    expect(quitaId(dbMcp.tablas.registros_jornada!.at(-1)!)).toEqual(quitaId(dbChat.tablas.registros_jornada!.at(-1)!));
  });
  it('DIARIO: igual por los dos caminos', async () => {
    const dbChat = crearFakeDb(baseRonda5());
    const s = sesion(dbChat);
    const r = await s.di('anota en Paqui: picado', { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'picado', fecha_texto: '2026-10-05' });
    await s.confirmar(r.accionPendiente!.orden_id);
    const dbMcp = crearFakeDb(baseRonda5());
    await ejecutarOrdenMcp({ accion: 'DIARIO', obra_texto: 'Paqui', texto: 'picado', fecha_texto: '2026-10-05' }, { supabase: dbMcp.client, businessId: NEGOCIO_A, userId: USUARIO }, { mensajes: ['picado'], ahora: new Date(MARTES) });
    const f = (d: ReturnType<typeof crearFakeDb>) => { const { id: _i, ...x } = d.tablas.diario_obra!.at(-1)!; void _i; return x; };
    expect(f(dbMcp)).toEqual(f(dbChat));
  });
  it('CITA_CREAR: la misma cita (título, fecha, hora y vínculos) por chat y por MCP', async () => {
    const orden: OrdenJev = { accion: 'CITA_CREAR', titulo_texto: 'Revisión del presupuesto', fecha_texto: '2026-10-09', hora_texto: '09:30', lugar_texto: 'Oficina' };
    const dbChat = crearFakeDb(baseRonda5());
    const s = sesion(dbChat);
    const r = await s.di('cita revisión', orden);
    await s.confirmar(r.accionPendiente!.orden_id);
    const dbMcp = crearFakeDb(baseRonda5());
    const m = await ejecutarOrdenMcp(orden, { supabase: dbMcp.client, businessId: NEGOCIO_A, userId: USUARIO }, { mensajes: ['x'], ahora: new Date(MARTES) });
    expect(m.ok).toBe(true);
    const clave = (d: ReturnType<typeof crearFakeDb>) => { const f = d.tablas.agenda!.at(-1)!; return { titulo: f.titulo, fecha: f.fecha, hora: f.hora, location: f.location, business_id: f.business_id }; };
    expect(clave(dbMcp)).toEqual(clave(dbChat));
  });
  it('el MCP rechaza lo mismo que el chat (operario inexistente, obra de otro negocio)', async () => {
    const db = crearFakeDb(baseRonda5());
    const ctx = { supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO };
    const a = await ejecutarOrdenMcp({ accion: 'HORAS', operario_texto: 'Zacarías', horas_texto: '8', obra_texto: 'Paqui' }, ctx, { mensajes: ['Zacarías Paqui 8'] });
    expect(a.ok).toBe(false);
    const b = await ejecutarOrdenMcp({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Reforma ajena inexistente' }, ctx, { mensajes: ['Iker 8'] });
    expect(b.ok).toBe(false);
    expect(db.tablas.registros_jornada ?? []).toHaveLength(0);
  });
});
