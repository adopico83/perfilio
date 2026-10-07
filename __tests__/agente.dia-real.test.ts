import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';
import { handleAgenda } from '@/lib/agente/modules/agenda';
import { parseNumeroDocumento, scoreNombreMatch, resolverClientesPorNombre } from '@/lib/agente/modules/grounding';
import { parseEstadoPresupuesto } from '@/lib/presupuestos/estado';
import { modificarPartidasPresupuesto } from '@/lib/presupuestos/editar-partidas';
import { IDS, NEGOCIO_A, NEGOCIO_B, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';
import { prepararAccionPendiente } from '@/lib/agente/confirmacion';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));

const presupuestos = (db: ReturnType<typeof crearFakeDb>, tool: string, args: Record<string, unknown>) =>
  handlePresupuestos(tool, args, NEGOCIO_A, USUARIO, db.client, {} as never, {});
const agenda = (db: ReturnType<typeof crearFakeDb>, tool: string, args: Record<string, unknown>) =>
  handleAgenda(tool, args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: 'vale' });

describe('número de presupuesto como lo dice la gente', () => {
  it.each([['3', 3], ['el 3', 3], ['nº 3', 3], ['n.º 3', 3], ['número 3', 3], [3, 3]])('«%s» → %s', (raw, n) => {
    expect(parseNumeroDocumento(raw)).toBe(n);
  });
  it('lo que no es un número no se interpreta', () => {
    expect(parseNumeroDocumento('Paqui')).toBeNull();
    expect(parseNumeroDocumento('0')).toBeNull();
  });
});

describe('estados de presupuesto unificados', () => {
  it('borrador es un estado válido y «aceptada» vale como «aceptado»', () => {
    expect(parseEstadoPresupuesto('borrador')).toBe('borrador');
    expect(parseEstadoPresupuesto('Aceptada')).toBe('aceptado');
    expect(parseEstadoPresupuesto('inventado')).toBeNull();
  });
  it('un presupuesto en «borrador» pasa a «aceptado» por número', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await presupuestos(db, 'cambiar_estado_presupuesto', { numero: '10', estado: 'aceptado' });
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)).toMatchObject({ estado: 'aceptado' });
  });
});

describe('aceptado ANTES de facturar', () => {
  it('«factúralo» con el presupuesto en borrador dice que no está aceptado y no crea nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const antes = db.inserts.length;
    const r = (await presupuestos(db, 'convertir_presupuesto_a_factura', { numero: 10 })) as { ok?: boolean; error?: string; mensaje?: string };
    expect(`${r.error ?? ''}${r.mensaje ?? ''}`).toMatch(/aceptado/);
    expect(db.inserts.length).toBe(antes);
  });
});

describe('modificar partidas de un presupuesto guardado', () => {
  const cambios = { quitar: ['mampara'], cambiar: [{ partida: 'alicatado', sumar_cantidad: 2 }] };

  it('quita la mampara, suma 2 m² y recalcula base, IVA y total en el servidor', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoMikelBorrador, cambios, { aplicar: true });
    expect(r).toMatchObject({ ok: true, aplicado: true, total_nuevo: 580.8 });
    const fila = db.tablas.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!;
    expect(fila.importe_total).toBe(580.8);
    expect(String(fila.presupuesto_generado)).toContain('Cantidad: 12');
    expect(String(fila.presupuesto_generado)).not.toMatch(/mampara/i);
    expect(String(fila.presupuesto_generado)).toContain('BASE IMPONIBLE: 480,00 €');
  });
  it('sin aplicar solo calcula: no escribe', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoMikelBorrador, cambios, { aplicar: false });
    expect(r).toMatchObject({ ok: true, aplicado: false });
    expect(db.updates).toHaveLength(0);
  });
  it('una partida que no existe no cambia nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoMikelBorrador, { quitar: ['piscina'] }, { aplicar: true });
    expect(r.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
  it('añadir una partida sin precio no inventa el precio', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoMikelBorrador, { anadir: [{ concepto: 'Fontanería', cantidad: 1 }] }, { aplicar: true });
    expect(r.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
  it('un presupuesto facturado no se toca', async () => {
    const base = crearBaseSimulada();
    base.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.estado = 'facturado';
    const db = crearFakeDb(base);
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoMikelBorrador, cambios, { aplicar: true });
    expect(r.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
  it('no toca un presupuesto de otro negocio', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, 'otro-negocio', IDS.presupuestoMikelBorrador, cambios, { aplicar: true });
    expect(r.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
});

describe('clientes con el mismo apellido', () => {
  it('compartir solo el apellido ya no puntúa', () => {
    expect(scoreNombreMatch('Ainhoa Etxeberria', 'Mikel Etxeberria')).toBe(0);
    expect(scoreNombreMatch('Mikel Etxeberria', 'Mikel Etxeberria')).toBe(100);
  });
  it('«Mikel Etxeberria» se resuelve a Mikel, «Etxeberria» a secas ofrece los tres', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const uno = await resolverClientesPorNombre(db.client, NEGOCIO_A, 'Mikel Etxeberria');
    expect(uno).toMatchObject({ status: 'one', match: { id: IDS.clienteMikelEtxeberria } });
    const varios = await resolverClientesPorNombre(db.client, NEGOCIO_A, 'Etxeberria');
    expect(varios.status).toBe('many');
  });

  it('la cita de Mikel guarda su cliente y su obra y NO copia datos de Ainhoa ni Amaia', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await agenda(db, 'crear_recordatorio', {
      titulo: 'Cita con Mikel Etxeberria', fecha: '2026-10-15', hora: '10:30', cliente: 'Mikel Etxeberria',
    });
    expect(r).toMatchObject({ ok: true });
    const fila = db.tablas.agenda.find((a) => a.titulo === 'Cita con Mikel Etxeberria' && a.fecha === '2026-10-15')!;
    expect(fila).toMatchObject({ cliente_id: IDS.clienteMikelEtxeberria, obra_id: IDS.obraMikelEtxeberria });
    const texto = `${fila.description}${fila.location}`;
    expect(texto).toContain('611000333');
    for (const ajeno of ['622000444', '633000555', 'Calle Ainhoa', 'Calle Amaia']) expect(texto).not.toContain(ajeno);
  });
  it('con cliente_id conocido no busca por nombre', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await agenda(db, 'crear_recordatorio', {
      titulo: 'Visita', fecha: '2026-10-15', hora: '12:00', cliente_id: IDS.clienteAinhoaEtxeberria,
    });
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.agenda.find((a) => a.titulo === 'Visita con Ainhoa Etxeberria')).toMatchObject({ cliente_id: IDS.clienteAinhoaEtxeberria });
  });
  it('«Etxeberria» a secas pregunta cuál y no guarda nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const antes = db.inserts.length;
    const r = (await agenda(db, 'crear_recordatorio', { titulo: 'Cita con Etxeberria', fecha: '2026-10-15', hora: '12:00', cliente: 'Etxeberria' })) as {
      necesita_aclaracion?: boolean; candidatos?: unknown[];
    };
    expect(r.necesita_aclaracion).toBe(true);
    expect(r.candidatos).toHaveLength(3);
    expect(db.inserts.length).toBe(antes);
  });
  it('si la migración no está aplicada la cita se guarda igual, sin vínculo', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    db.erroresInsert.agenda = [{ message: "Could not find the 'cliente_id' column of 'agenda' in the schema cache" }];
    const r = await agenda(db, 'crear_recordatorio', { titulo: 'Cita con Mikel Etxeberria', fecha: '2026-10-16', hora: '09:00', cliente: 'Mikel Etxeberria' });
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.agenda.find((a) => a.fecha === '2026-10-16')).toBeDefined();
  });
  it('mover «lo de Mikel» con dos citas parecidas pregunta cuál', async () => {
    const base = crearBaseSimulada();
    base.agenda.push({ id: 'ev-mikel-2', business_id: NEGOCIO_A, titulo: 'Visita a Mikel Etxeberria', fecha: '2026-10-14', hora: '09:00' });
    const db = crearFakeDb(base);
    const r = (await agenda(db, 'modificar_evento_agenda', { titulo_fragmento: 'Mikel', nueva_fecha: '2026-10-16', solo_vista_previa: true })) as {
      necesita_aclaracion?: boolean;
    };
    expect(r.necesita_aclaracion).toBe(true);
    expect(db.updates).toHaveLength(0);
  });
});

describe('ronda 3: partida correcta al cambiar y quitar', () => {
  const nPres11 = IDS.presupuestoAinhoaPendiente;

  it('«2 metros más de alicatado» toca «Alicatar 18 m2», no «Quitar alicatado y plato viejo»', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, nPres11, { cambiar: [{ partida: 'alicatado', sumar_cantidad: 2, unidad: 'metros' }] }, { aplicar: true });
    expect(r).toMatchObject({ ok: true, aplicado: true });
    const texto = String(db.tablas.presupuestos.find((p) => p.id === nPres11)!.presupuesto_generado);
    expect(texto).toContain('Alicatar 18 m2 | Cantidad: 20');
    expect(texto).toContain('Quitar alicatado y plato viejo | Cantidad: 1 ');
  });
  it('«quítale la mampara» no borra la partida de 900 €: pregunta entera o renombrar', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, nPres11, { quitar: ['mampara'] }, { aplicar: true });
    expect(r).toMatchObject({ ok: false, necesita_aclaracion: true });
    expect((r as { candidatos: unknown[] }).candidatos).toHaveLength(2);
    expect(db.updates).toHaveLength(0);
  });
  it('quitarle algo a una partida = cambiarle el nombre y el precio', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await modificarPartidasPresupuesto(
      db.client, NEGOCIO_A, nPres11,
      { cambiar: [{ partida: 'plato de ducha con mampara', nuevo_concepto: 'Plato de ducha', precio_unitario: 600 }] },
      { aplicar: true }
    );
    expect(r).toMatchObject({ ok: true, total_nuevo: 1.21 * (150 + 720 + 600) });
    const texto = String(db.tablas.presupuestos.find((p) => p.id === nPres11)!.presupuesto_generado);
    expect(texto).toContain('Plato de ducha | Cantidad: 1');
    expect(texto).not.toMatch(/mampara/i);
  });
  it('si solo existe la partida de retirada, «alicatado» pregunta en vez de adivinar', async () => {
    const base = crearBaseSimulada();
    const fila = base.presupuestos.find((p) => p.id === nPres11)!;
    fila.presupuesto_generado = String(fila.presupuesto_generado).replace(/\n2\. Alicatar[^\n]*/, '');
    const db = crearFakeDb(base);
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, nPres11, { cambiar: [{ partida: 'alicatado', sumar_cantidad: 2 }] }, { aplicar: true });
    expect(r).toMatchObject({ ok: false, necesita_aclaracion: true });
    expect(db.updates).toHaveLength(0);
  });
  it('dos partidas que encajan → pregunta con las dos', async () => {
    const base = crearBaseSimulada();
    const fila = base.presupuestos.find((p) => p.id === nPres11)!;
    fila.presupuesto_generado = String(fila.presupuesto_generado).replace('Plato de ducha con mampara', 'Alicatar zócalo');
    const db = crearFakeDb(base);
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, nPres11, { cambiar: [{ partida: 'alicatar', cantidad: 5 }] }, { aplicar: true });
    expect(r).toMatchObject({ ok: false, necesita_aclaracion: true });
  });
});

describe('ronda 3: NIF del cliente antes del «sí»', () => {
  const deps = (db: ReturnType<typeof crearFakeDb>) => ({
    supabase: db.client,
    businessId: NEGOCIO_A,
    runTool: async () => ({}),
    mensajeUsuario: 'factúralo',
  });

  it('facturar a un cliente sin NIF lo pregunta ANTES de pedir el «sí» y no escribe', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('convertir_presupuesto_a_factura', { numero: 11 }, deps(db));
    expect(r.tipo).toBe('resultado');
    expect(JSON.stringify((r as { result: unknown }).result)).toMatch(/me falta el NIF/);
    expect(db.inserts).toHaveLength(0);
  });
  it('actualizar_cliente pide confirmación con el dato real y luego lo guarda; después ya se puede facturar', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('actualizar_cliente', { cliente_nombre: 'Ainhoa Etxeberria', nif: '44444444b', direccion: 'Calle Ainhoa 4' }, deps(db));
    expect(prep.tipo).toBe('pendiente');
    const accion = (prep as { accion: { tool: string; args: Record<string, unknown>; resumen: string } }).accion;
    expect(accion.args.cliente_id).toBe(IDS.clienteAinhoaEtxeberria);
    expect(accion.resumen).toContain('Ainhoa Etxeberria');
    expect(db.updates).toHaveLength(0); // todavía nada guardado

    const { handleObrasClientesAgent } = await import('@/lib/agente/modules/obras-clientes');
    const r = await handleObrasClientesAgent(accion.tool, accion.args, NEGOCIO_A, USUARIO, db.client as never);
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.clientes.find((c) => c.id === IDS.clienteAinhoaEtxeberria)).toMatchObject({ nif: '44444444B', direccion: 'Calle Ainhoa 4' });

    const otra = await prepararAccionPendiente('convertir_presupuesto_a_factura', { numero: 11 }, deps(db));
    expect(otra.tipo).toBe('pendiente');
  });
  it('actualizar_cliente no toca a un cliente de otro negocio', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const { handleObrasClientesAgent } = await import('@/lib/agente/modules/obras-clientes');
    const r = await handleObrasClientesAgent('actualizar_cliente', { cliente_id: 'cli-b-lola', nif: '99999999R' }, NEGOCIO_A, USUARIO, db.client as never);
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.clientes.find((c) => c.id === 'cli-b-lola')!.nif).toBe('B99999999');
  });
});

describe('ronda 3: mover una cita avisa del choque', () => {
  it('a una hora ocupada, la vista previa avisa (y no escribe)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await agenda(db, 'modificar_evento_agenda', { evento_id: 'ev-mikel', nueva_fecha: '2026-10-14', solo_vista_previa: true })) as { mensaje: string };
    expect(r.mensaje).toContain('choca con «Visita obra Olabide»');
    expect(db.updates).toHaveLength(0);
  });
  it('a una hora libre no avisa', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await agenda(db, 'modificar_evento_agenda', { evento_id: 'ev-mikel', nueva_fecha: '2026-10-14', nueva_hora: '16:00', solo_vista_previa: true })) as { mensaje: string };
    expect(r.mensaje).not.toContain('choca');
  });
  it('el motivo no va al título: el título lleva el cliente', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    await agenda(db, 'crear_recordatorio', { titulo: 'Cita', fecha: '2026-10-20', hora: '09:00', cliente: 'Mikel Etxeberria', notas: 'ver azulejos' });
    const fila = db.tablas.agenda.find((a) => a.fecha === '2026-10-20')!;
    expect(fila.titulo).toBe('Cita con Mikel Etxeberria');
    expect(String(fila.description)).toContain('ver azulejos');
  });
});

describe('ronda 3: operarios, PDF y mensajes', () => {
  it('si no encuentra al operario, lista los que hay', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const { ejecutarConsultarHorasOperario } = await import('@/lib/agente/modules/operarios');
    const r = (await ejecutarConsultarHorasOperario(db.client as never, NEGOCIO_A, { operario_nombre: 'Zacarías' })) as { error?: string };
    expect(r.error).toMatch(/Iker Etxeberria/);
    expect(r.error).toMatch(/Mikel Goñi/);
  });
  it('cambiar el estado devuelve un mensaje con datos reales', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'cambiar_estado_presupuesto', { numero: 10, estado: 'aceptado' })) as { mensaje?: string };
    expect(r.mensaje).toBe('Presupuesto nº 10 de Mikel Etxeberria marcado como aceptado.');
  });
  it('el PDF de un presupuesto en borrador se da, avisando de que es borrador', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    jest.doMock('@/lib/pdf/presupuesto-render', () => ({
      PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre',
      nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
      renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
    }));
    const { handleEnlacesPdf } = await import('@/lib/agente/modules/enlaces-pdf');
    const r = (await handleEnlacesPdf('obtener_enlace_pdf_presupuesto', { numero: 'el 10' }, NEGOCIO_A, USUARIO, db.client)) as { ok?: boolean; mensaje?: string };
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain('BORRADOR');
  });
});

// ───────────────────────────── Ronda 4: control de obra ─────────────────────────────
import { handleGastosAgent } from '@/lib/agente/modules/gastos';
import { handleDiario } from '@/lib/agente/modules/diario';
import { handleDocumentosAgent } from '@/lib/agente/modules/documentos';
import { handleObrasClientesAgent } from '@/lib/agente/modules/obras-clientes';
import { ejecutarRegistrarJornada } from '@/lib/agente/modules/operarios';
import { parseFechaNatural, ymdHoyMadrid } from '@/lib/fechas-madrid';

jest.mock('@/lib/dictado-presupuesto', () => ({
  ...jest.requireActual('@/lib/dictado-presupuesto'),
  estructurarDictadoEnPartidas: jest.fn(async () => [
    { descripcion: 'Alicatado de baño', cantidad: 12, unidad: 'm2', precio_unitario: 40, total: 480, categoria: 'alicatado' },
  ]),
}));

const SOLO_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;
const relojEn = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: [...SOLO_DATE] });
afterEach(() => jest.useRealTimers());

type Db = ReturnType<typeof crearFakeDb>;
const gastos = (db: Db, args: Record<string, unknown>, mensaje = '') =>
  handleGastosAgent('registrar_gasto_ticket', args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: mensaje });
const depsPrep = (db: Db, mensaje: string) => ({
  supabase: db.client,
  businessId: NEGOCIO_A,
  mensajeUsuario: mensaje,
  runTool: (tool: string, args: Record<string, unknown>) => {
    if (tool === 'registrar_gasto_ticket') return gastos(db, args, mensaje);
    if (tool === 'crear_recordatorio') return handleAgenda(tool, args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: mensaje });
    if (tool === 'registrar_jornada') return ejecutarRegistrarJornada(db.client, NEGOCIO_A, args, mensaje);
    if (tool === 'generar_presupuesto_por_dictado') return handleDocumentosAgent(tool, args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: mensaje, mensaje });
    throw new Error(`tool ${tool}`);
  },
});
const GASTO_LEIRE = { proveedor: 'Saltoki', importe: 100, iva: 21, importe_total: 121, fecha: '2026-10-06', categoria: 'material', descripcion: 'cable y mecanismos' };
const MENSAJE_LEIRE = '121 con IVA en Saltoki para lo de Leire, cable y mecanismos de la cocina';

describe('ronda 4: lo que se guarda es EXACTAMENTE lo que se enseñó', () => {
  it('gasto confirmado con botón (sin mensaje): queda con obra, cliente, descripción y proveedor', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    // El modelo manda el id del CLIENTE como obra_id.
    const prep = await prepararAccionPendiente('registrar_gasto_ticket', { ...GASTO_LEIRE, obra_id: IDS.clienteLeire }, depsPrep(db, MENSAJE_LEIRE));
    expect(prep.tipo).toBe('pendiente');
    const accion = (prep as { accion: { args: Record<string, unknown>; resumen: string } }).accion;
    expect(accion.resumen).toContain('Reforma cocina Leire Ugarte'); // la obra de Leire, no «Cocina Zarautz»
    expect(db.inserts.filter((i) => i.tabla === 'gastos')).toHaveLength(0);

    // Al confirmar con el botón NO hay mensaje del usuario.
    const r = await gastos(db, accion.args, '');
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.gastos[0]).toMatchObject({
      obra_id: IDS.obraLeire,
      cliente_id: IDS.clienteLeire,
      proveedor: 'Saltoki',
      proveedor_id: IDS.proveedorSaltoki,
      descripcion: 'cable y mecanismos',
      importe_total: 121,
    });
  });
  it('el concepto llega aunque el modelo lo ponga en «concepto»', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const { descripcion: _d, ...sin } = GASTO_LEIRE;
    void _d;
    await gastos(db, { ...sin, concepto: 'cable y mecanismos', obra_nombre: 'Leire' }, '');
    expect(db.tablas.gastos[0]).toMatchObject({ descripcion: 'cable y mecanismos', obra_id: IDS.obraLeire });
  });
  it('un obra_id que no existe en el negocio da error claro y no guarda nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await gastos(db, { ...GASTO_LEIRE, obra_id: 'obra-inventada' }, MENSAJE_LEIRE)) as { error?: string; mensaje?: string };
    expect(`${r.error ?? ''}${r.mensaje ?? ''}`).toMatch(/obra_id no existe/);
    expect(db.tablas.gastos).toHaveLength(0);
  });
  it('un obra_id de OTRO negocio tampoco vale', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await gastos(db, { ...GASTO_LEIRE, obra_id: IDS.obraPaquiAjena }, '')) as { error?: string };
    expect(r.error).toMatch(/obra_id no existe/);
    expect(db.tablas.gastos).toHaveLength(0);
  });
  it('un cliente_id que no existe da error y no guarda sin vínculo', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await gastos(db, { ...GASTO_LEIRE, cliente_id: 'cli-fantasma' }, MENSAJE_LEIRE)) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(db.tablas.gastos).toHaveLength(0);
  });
  it('con el cliente nombrado («Leire») gana su obra y no la palabra suelta «cocina»', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await gastos(db, GASTO_LEIRE, MENSAJE_LEIRE)) as { mensaje?: string };
    expect(r.mensaje).toContain('Reforma cocina Leire Ugarte');
  });
  it('proveedor que no está dado de alta: se guarda como texto y se pregunta si darlo de alta', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await gastos(db, { ...GASTO_LEIRE, proveedor: 'Bricomart', obra_id: IDS.obraLeire }, '')) as { ok?: boolean; mensaje?: string };
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/Bricomart.*no está dado de alta.*¿quieres que lo dé de alta\?/);
    expect(db.tablas.gastos[0]).toMatchObject({ proveedor: 'Bricomart' });
    expect(db.tablas.gastos[0].proveedor_id).toBeUndefined();
  });
  it('crear_proveedor da de alta (y no duplica)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const alta = await handleGastosAgent('crear_proveedor', { nombre: 'Bricomart', nif: 'a12345678' }, NEGOCIO_A, USUARIO, db.client, {} as never, {});
    expect(alta).toMatchObject({ ok: true });
    expect(db.tablas.proveedores.find((p) => p.nombre === 'Bricomart')).toMatchObject({ business_id: NEGOCIO_A, nif: 'A12345678' });
    const otra = await handleGastosAgent('crear_proveedor', { nombre: 'saltoki' }, NEGOCIO_A, USUARIO, db.client, {} as never, {});
    expect(otra).toMatchObject({ ok: true, existente: true });
    expect(db.tablas.proveedores).toHaveLength(2);
  });
  it('cita: «el jueves» queda como fecha concreta en la acción confirmada (aunque pase la medianoche)', async () => {
    relojEn('2026-10-06T10:00:00Z');
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('crear_recordatorio', { titulo: 'Cita', fecha_relativa: 'jueves', hora: '10:30', cliente: 'Mikel Etxeberria' }, depsPrep(db, 'ponme cita con Mikel el jueves'));
    expect(prep.tipo).toBe('pendiente');
    const args = (prep as { accion: { args: Record<string, unknown> } }).accion.args;
    expect(args).toMatchObject({ fecha: '2026-10-08', cliente_id: IDS.clienteMikelEtxeberria, obra_id: IDS.obraMikelEtxeberria });
    expect(args.fecha_relativa).toBeUndefined();
    // Confirma 2 días después, sin mensaje: sigue siendo el MISMO jueves.
    relojEn('2026-10-08T21:00:00Z');
    const r = await handleAgenda('crear_recordatorio', args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '' });
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.agenda.find((a) => a.titulo === 'Cita con Mikel Etxeberria' && a.fecha === '2026-10-08')).toMatchObject({ cliente_id: IDS.clienteMikelEtxeberria });
  });
  it('horas: la obra y el operario que se enseñaron son los que se guardan', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('registrar_jornada', { operario_nombre: 'Iker', horas: 8, obra_nombre: 'Leire' }, depsPrep(db, 'ponle 8 horas a Iker en lo de Leire'));
    expect(prep.tipo).toBe('pendiente');
    const args = (prep as { accion: { args: Record<string, unknown> } }).accion.args;
    expect(args).toMatchObject({ obra_id: IDS.obraLeire, operario_nombre: 'Iker Etxeberria', horas_reales: 8 });
    const r = await ejecutarRegistrarJornada(db.client, NEGOCIO_A, args, '');
    expect(r).toMatchObject({ mensaje: expect.stringContaining('Registrado') });
    expect(db.tablas.registros_jornada[0]).toMatchObject({ obra_id: IDS.obraLeire, operario_id: IDS.operarioIker });
  });
  it('dictado: se guardan las MISMAS partidas que se enseñaron (no se vuelve a llamar al modelo)', async () => {
    const { estructurarDictadoEnPartidas } = await import('@/lib/dictado-presupuesto');
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('generar_presupuesto_por_dictado', { dictado: 'alicatar el baño 12 metros a 40', cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria }, depsPrep(db, 'hazle un presupuesto a Mikel'));
    expect(prep.tipo).toBe('pendiente');
    const args = (prep as { accion: { args: Record<string, unknown> } }).accion.args;
    expect(args.partidas_resueltas).toBeDefined();
    (estructurarDictadoEnPartidas as jest.Mock).mockClear();
    (estructurarDictadoEnPartidas as jest.Mock).mockResolvedValueOnce([{ descripcion: 'OTRA COSA', cantidad: 1, unidad: 'ud', precio_unitario: 999, total: 999, categoria: 'x' }]);
    const r = (await handleDocumentosAgent('generar_presupuesto_por_dictado', args, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '', mensaje: '' })) as Record<string, unknown>;
    expect(estructurarDictadoEnPartidas).not.toHaveBeenCalled();
    await (estructurarDictadoEnPartidas as jest.Mock)('', []); // consume el «una vez» que no se usó
    expect(String(r.mensaje)).toContain('Alicatado de baño');
    expect(r.importe_total).toBe(580.8);
  });
});

describe('ronda 4: «ese presu» justo después del dictado', () => {
  it('la respuesta lleva número e id para el mensaje siguiente', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleDocumentosAgent('generar_presupuesto_por_dictado', { dictado: 'alicatar el baño', cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '', mensaje: '' })) as {
      ok?: boolean; numero_presupuesto?: number; presupuesto_id?: string; mensaje: string;
    };
    expect(r.ok).toBe(true);
    expect(r.numero_presupuesto).toBe(12); // 10 y 11 ya existen
    expect(r.presupuesto_id).toBeTruthy();
    expect(r.mensaje).toContain('nº 12');
    // Y «ese presu» (sin número) por id/número resuelve a ese presupuesto, no a otro.
    const pdf = await presupuestos(db, 'buscar_presupuesto', { numero: 12 });
    expect(JSON.stringify(pdf)).toContain(String(r.presupuesto_id));
  });
});

describe('ronda 4: fechas en hora de Madrid (a las 00:30 todavía es «hoy» de Madrid)', () => {
  // 22:30 UTC del 6/10 = 00:30 del 7/10 en Madrid (verano, UTC+2).
  const MEDIANOCHE = '2026-10-06T22:30:00Z';
  it('hoy es el 7, no el 6', () => {
    relojEn(MEDIANOCHE);
    expect(ymdHoyMadrid()).toBe('2026-10-07');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-06'); // lo que hacía antes (mal)
  });
  it('«ayer», «el lunes», «el 3», «3 de octubre»', () => {
    relojEn(MEDIANOCHE);
    expect(parseFechaNatural('ayer')).toEqual({ ok: true, ymd: '2026-10-06' });
    expect(parseFechaNatural('anteayer')).toEqual({ ok: true, ymd: '2026-10-05' });
    expect(parseFechaNatural('el lunes')).toEqual({ ok: true, ymd: '2026-10-05' });
    expect(parseFechaNatural('el miércoles')).toEqual({ ok: true, ymd: '2026-10-07' }); // hoy es miércoles
    expect(parseFechaNatural('el 3')).toEqual({ ok: true, ymd: '2026-10-03' });
    expect(parseFechaNatural('el 25')).toEqual({ ok: true, ymd: '2026-09-25' }); // aún no ha llegado: el del mes pasado
    expect(parseFechaNatural('3 de octubre')).toEqual({ ok: true, ymd: '2026-10-03' });
    expect(parseFechaNatural('2026-10-01')).toEqual({ ok: true, ymd: '2026-10-01' });
  });
  it('no admite fechas futuras ni inventadas', () => {
    relojEn(MEDIANOCHE);
    expect(parseFechaNatural('2026-10-20')).toMatchObject({ ok: false });
    expect(parseFechaNatural('31 de febrero')).toMatchObject({ ok: false });
    expect(parseFechaNatural('pasado mañana')).toMatchObject({ ok: false });
  });
  it('horas sin fecha: se apuntan en el día de Madrid', async () => {
    relojEn(MEDIANOCHE);
    const db = crearFakeDb(crearBaseSimulada());
    await ejecutarRegistrarJornada(db.client, NEGOCIO_A, { operario_nombre: 'Iker', horas: 2, obra_id: IDS.obraLeire }, '');
    expect(db.tablas.registros_jornada[0].fecha).toBe('2026-10-07');
  });
  it('el presupuesto del dictado lleva la fecha de Madrid', async () => {
    relojEn(MEDIANOCHE);
    const db = crearFakeDb(crearBaseSimulada());
    await handleDocumentosAgent('generar_presupuesto_por_dictado', { dictado: 'x', cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '', mensaje: '' });
    expect(db.tablas.presupuestos.find((p) => p.numero_presupuesto === 12)!.fecha).toBe('2026-10-07');
  });
});

describe('ronda 4: diario con fecha', () => {
  const diario = (db: Db, args: Record<string, unknown>) =>
    handleDiario('crear_entrada_diario', { obra_nombre: 'Reforma cocina Leire Ugarte', texto: 'Desmontamos los muebles', ...args }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '' });

  it('«ayer desmontamos los muebles» se guarda con la fecha de ayer (Madrid)', async () => {
    relojEn('2026-10-06T22:30:00Z'); // 00:30 del 7 en Madrid
    const db = crearFakeDb(crearBaseSimulada());
    const r = await diario(db, { fecha: 'ayer' });
    expect(r).toMatchObject({ id: expect.anything() });
    const fila = db.tablas.diario_obra.find((d) => d.texto === 'Desmontamos los muebles')!;
    expect(String(fila.fecha).slice(0, 10)).toBe('2026-10-06');
  });
  it('sin fecha, se queda la de ahora', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    await diario(db, {});
    const fila = db.tablas.diario_obra.find((d) => d.texto === 'Desmontamos los muebles')!;
    expect(fila.fecha).toBeUndefined();
  });
  it('una fecha futura se rechaza y no se guarda', async () => {
    relojEn('2026-10-06T10:00:00Z');
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await diario(db, { fecha: '2026-12-01' })) as { error?: string };
    expect(r.error).toMatch(/futura/);
    expect(db.tablas.diario_obra.filter((d) => d.texto === 'Desmontamos los muebles')).toHaveLength(0);
  });
});

describe('ronda 4: obras cerradas — se consultan, no se escriben, y nunca se responde con otra', () => {
  const ficha = (db: Db, args: Record<string, unknown>) => handleObrasClientesAgent('ver_ficha_obra', args, NEGOCIO_A, USUARIO, db.client);

  it('la ficha de una obra cerrada se ve (y dice que está cerrada)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await ficha(db, { obra_nombre: 'Amaia' })) as { mensaje?: string; obra_id?: string };
    expect(r.obra_id).toBe(IDS.obraTerrazaAmaia);
    expect(r.mensaje).toContain('Reforma terraza Amaia');
    expect(r.mensaje).toContain('obra cerrada');
  });
  it('por el nombre del cliente también (la obra de Amaia Etxeberria)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await ficha(db, { obra_nombre: 'Amaia Etxeberria' })) as { obra_id?: string };
    expect(r.obra_id).toBe(IDS.obraTerrazaAmaia);
  });
  it('si la obra pedida no existe lo dice y NO contesta con la de otro cliente', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await ficha(db, { obra_nombre: 'Zorionak Garmendia' })) as { ok?: boolean; error?: string; obra_id?: string };
    expect(r.ok).toBe(false);
    expect(r.obra_id).toBeUndefined();
    expect(r.error).toMatch(/No he encontrado ninguna obra/);
  });
  it('un obra_id de otro negocio no se ve', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await ficha(db, { obra_id: IDS.obraPaquiAjena })) as { ok?: boolean; obra_id?: string };
    expect(r.ok).toBe(false);
    expect(r.obra_id).toBeUndefined();
  });
  it('buscar_obra por el nombre del cliente incluye la cerrada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleObrasClientesAgent('buscar_obra', { query: 'Amaia' }, NEGOCIO_A, USUARIO, db.client)) as { items: Array<{ id: string; estado: string }> };
    expect(r.items.map((i) => i.id)).toContain(IDS.obraTerrazaAmaia);
  });
  it('para ESCRIBIR una obra cerrada no vale: el diario no se anota en ella', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleDiario('crear_entrada_diario', { obra_id: IDS.obraTerrazaAmaia, texto: 'x' }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '' })) as { error?: string; mensaje?: string };
    expect(`${r.error ?? ''}${r.mensaje ?? ''}`).toMatch(/cerrada/);
    expect(db.tablas.diario_obra.filter((d) => d.texto === 'x')).toHaveLength(0);
  });
  it('las horas de una obra cerrada se consultan', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const { ejecutarConsultarHorasObra } = await import('@/lib/agente/modules/operarios');
    const r = (await ejecutarConsultarHorasObra(db.client, NEGOCIO_A, { obra_nombre: 'Amaia' }, '')) as { error?: string };
    expect(r.error ?? '').not.toMatch(/Indica la obra|cerrada/);
  });
});

describe('ronda 4: la confirmación de cerrar obra dice el nombre', () => {
  it('«Voy a cerrar la obra «Reforma cocina Leire Ugarte»»', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('actualizar_obra', { obra_nombre: 'Leire', estado: 'cerrada' }, depsPrep(db, 'cierra la obra de Leire'));
    expect(prep.tipo).toBe('pendiente');
    expect((prep as { accion: { resumen: string; args: Record<string, unknown> } }).accion.resumen).toBe('Voy a cerrar la obra «Reforma cocina Leire Ugarte».');
    expect((prep as { accion: { args: Record<string, unknown> } }).accion.args.obra_id).toBe(IDS.obraLeire);
  });
});

// ───────────────────────────── Ronda 5 ─────────────────────────────
import { corregirPartidasConDictado, validarPartidasContraDictado, numerosDelDictado } from '@/lib/dictado-presupuesto';
import { fechaDichaEnMensaje } from '@/lib/fechas-madrid';
import { corregirImportesSegunMensaje, descripcionDelMensaje, modoIvaDelMensaje } from '@/lib/gastos-iva';
import { completarNombreDesdeMensaje, datosExtraProveedor } from '@/lib/agente/confirmacion';
import { inyectarUltimoPresupuesto, leerUltimoPresupuestoDeHistorial, marcaUltimoPresupuesto, ultimoPresupuestoDeResultados } from '@/lib/agente/orquestacion';
import { pideBorrar, quitarToolsDestructivasSiNoPideBorrar, TOOLS_DESTRUCTIVAS } from '@/lib/agente/router';
import { GASTOS_AGENT_TOOLS } from '@/lib/agente/modules/gastos';

const partida = (descripcion: string, cantidad: number, precio: number) => ({
  descripcion, cantidad, unidad: 'm2', precio_unitario: precio, total: Math.round(cantidad * precio * 100) / 100, categoria: 'alicatado',
});

describe('ronda 5.1: el dictado respeta los números dichos', () => {
  it('«alicatar 16 metros a 34»: si el modelo pone 35 (la tarifa), se corrige a 34', () => {
    const r = corregirPartidasConDictado('alicatar 16 metros a 34', [partida('Alicatado de azulejo', 16, 35)]);
    expect(r[0]).toMatchObject({ cantidad: 16, precio_unitario: 34, total: 544 });
  });
  it('varias partidas: cada número va a SU partida', () => {
    const r = corregirPartidasConDictado('alicatar 16 metros a 34, solar 20 m2 a 41', [partida('Alicatado de azulejo', 16, 35), { ...partida('Solado de gres', 20, 38), categoria: 'suelo' }]);
    expect(r.map((p) => [p.cantidad, p.precio_unitario])).toEqual([[16, 34], [20, 41]]);
  });
  it('al corregir («no, a 34») sigue siendo 34, no vuelve a la tarifa', () => {
    const r = corregirPartidasConDictado('alicatar 16 m2 a 34 euros el metro', [partida('Alicatado', 16, 35)]);
    expect(r[0].precio_unitario).toBe(34);
  });
  it('valida: cada número dicho debe aparecer en las partidas; si no, pregunta', () => {
    expect(validarPartidasContraDictado('alicatar 16 metros a 34', [partida('Alicatado', 16, 34)])).toBeNull();
    const msg = validarPartidasContraDictado('alicatar 16 metros a 34', [partida('Alicatado', 16, 35)]);
    expect(msg).toMatch(/34/);
    expect(msg).toMatch(/No he guardado nada/);
  });
  it('un importe cerrado («colocar material, 942 euros») cuenta como dicho', () => {
    expect(validarPartidasContraDictado('colocar material, 942 euros', [{ ...partida('Colocar material', 1, 942) }])).toBeNull();
  });
  it('números con coma, miles y unidades pegadas', () => {
    expect(numerosDelDictado('alicatar 12,5 m2 a 40 y pintar 1.250 euros, 21%')).toEqual([12.5, 2 === 2 ? 40 : 0, 1250].filter((n) => n !== 2));
  });
  it('el servidor lo aplica: el modelo devuelve 35 y se guarda 34 (y lo enseñado = lo guardado)', async () => {
    const { estructurarDictadoEnPartidas } = await import('@/lib/dictado-presupuesto');
    (estructurarDictadoEnPartidas as jest.Mock).mockResolvedValueOnce([partida('Alicatado de azulejo', 16, 35)]);
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleDocumentosAgent('generar_presupuesto_por_dictado', { dictado: 'alicatar 16 metros a 34', cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria, solo_vista_previa: true }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '', mensaje: '' })) as { importe_total: number; partidas: Array<{ precio_unitario: number }> };
    expect(r.partidas[0].precio_unitario).toBe(34);
    expect(r.importe_total).toBe(658.24); // 16 × 34 = 544 + 21 % IVA
  });
  it('si el modelo no cuadra con lo dicho y no se puede corregir, se pregunta y no se guarda', async () => {
    const { estructurarDictadoEnPartidas } = await import('@/lib/dictado-presupuesto');
    (estructurarDictadoEnPartidas as jest.Mock).mockResolvedValueOnce([{ ...partida('Cosa rara', 7, 99), categoria: 'varios' }]);
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleDocumentosAgent('generar_presupuesto_por_dictado', { dictado: 'alicatar 16 metros a 34', cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '', mensaje: '' })) as { ok?: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No he guardado nada/);
    expect(db.tablas.presupuestos.find((p) => p.cliente_nombre === 'Mikel Etxeberria' && p.numero_presupuesto === 12)).toBeUndefined();
  });
});

describe('ronda 5.2: días de la semana calculados por el servidor (hora de Madrid)', () => {
  // 6/10/2026 es martes. Las horas son del mediodía de Madrid.
  const en = (iso: string) => new Date(iso);
  it.each([
    ['2026-10-05T10:00:00Z', 'lunes', 'ponme cita el lunes', '2026-10-05'], // hoy lunes: «el lunes» es hoy
    ['2026-10-06T10:00:00Z', 'martes', 'cita el lunes a las 10', '2026-10-12'],
    ['2026-10-06T10:00:00Z', 'martes', 'cita el jueves a las 10 y media', '2026-10-08'],
    ['2026-10-07T10:00:00Z', 'miércoles', 'cita el jueves', '2026-10-08'],
    ['2026-10-08T10:00:00Z', 'jueves', 'cita el jueves', '2026-10-08'],
    ['2026-10-08T10:00:00Z', 'jueves', 'cita el jueves que viene', '2026-10-15'],
    ['2026-10-09T10:00:00Z', 'viernes', 'cita el lunes', '2026-10-12'],
    ['2026-10-10T10:00:00Z', 'sábado', 'cita el lunes', '2026-10-12'],
    ['2026-10-11T10:00:00Z', 'domingo', 'cita el lunes', '2026-10-12'],
    ['2026-10-06T10:00:00Z', 'martes', 'cita el lunes que viene', '2026-10-12'],
    ['2026-10-05T10:00:00Z', 'lunes', 'cita el lunes que viene', '2026-10-12'],
    ['2026-10-09T10:00:00Z', 'viernes', 'cita el lunes de la semana que viene', '2026-10-12'],
    ['2026-10-06T10:00:00Z', 'martes', 'cita el miércoles de la semana que viene', '2026-10-14'],
    ['2026-10-06T10:00:00Z', 'martes', 'cita mañana', '2026-10-07'],
    ['2026-10-06T10:00:00Z', 'martes', 'cita pasado mañana', '2026-10-08'],
    ['2026-10-06T10:00:00Z', 'martes', 'ponme cita hoy a las 5', '2026-10-06'],
    ['2026-10-06T22:30:00Z', 'martes (00:30 del miércoles en Madrid)', 'cita mañana', '2026-10-08'],
    ['2026-10-06T22:30:00Z', 'martes (00:30 del miércoles en Madrid)', 'cita el miércoles', '2026-10-07'],
  ])('%s (%s): «%s» → %s', (iso, _dia, mensaje, esperado) => {
    expect(fechaDichaEnMensaje(mensaje, en(iso))).toBe(esperado);
  });
  it('«por la mañana» no es «mañana»', () => {
    expect(fechaDichaEnMensaje('cita el jueves por la mañana', en('2026-10-06T10:00:00Z'))).toBe('2026-10-08');
  });
  it('dos fechas distintas: al crear no decide; al mover coge la última («del lunes al viernes»)', () => {
    const ahora = en('2026-10-06T10:00:00Z');
    expect(fechaDichaEnMensaje('cita el lunes y el jueves', ahora)).toBeNull();
    expect(fechaDichaEnMensaje('pasa lo del lunes al viernes', ahora, 'mover')).toBe('2026-10-09');
  });
  it('sin fecha dicha: null (manda lo que diga el modelo)', () => {
    expect(fechaDichaEnMensaje('apúntame una visita a Olabide', en('2026-10-06T10:00:00Z'))).toBeNull();
  });
  it('crear cita: el servidor manda sobre un fecha_relativa/fecha equivocados del modelo', async () => {
    relojEn('2026-10-06T10:00:00Z');
    const db = crearFakeDb(crearBaseSimulada());
    const llamar = (args: Record<string, unknown>, mensaje: string) => handleAgenda('crear_recordatorio', { solo_vista_previa: true, ...args }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: mensaje });
    const lunes = (await llamar({ titulo: 'Cita con Paqui', fecha: '2026-10-10', hora: '10:00' }, 'ponme cita con Paqui el lunes a las 10')) as { vista: { fecha: string } };
    expect(lunes.vista.fecha).toBe('2026-10-12'); // el modelo dijo el sábado 10
    const jueves = (await llamar({ titulo: 'Cita con Paqui', fecha_relativa: 'martes', hora: '11:00' }, 'ponme cita con Paqui el jueves a las 11')) as { vista: { fecha: string } };
    expect(jueves.vista.fecha).toBe('2026-10-08'); // el modelo dijo el martes 13
  });
  it('mover cita: «al viernes» (o fecha_relativa) se calcula en el servidor', async () => {
    relojEn('2026-10-06T10:00:00Z');
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleAgenda('modificar_evento_agenda', { evento_id: 'ev-mikel', nueva_fecha: '2026-10-17', solo_vista_previa: true }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: 'pasa lo de Mikel al viernes' })) as { mensaje: string };
    expect(r.mensaje).toContain('2026-10-09');
    const r2 = (await handleAgenda('modificar_evento_agenda', { evento_id: 'ev-mikel', fecha_relativa: 'viernes', solo_vista_previa: true }, NEGOCIO_A, USUARIO, db.client, {} as never, { mensajeTrim: '' })) as { mensaje: string };
    expect(r2.mensaje).toContain('2026-10-09');
  });
});

describe('ronda 5.3: obras cerradas y obra_id que no cuadra con el cliente', () => {
  it('un obra_id que no cuadra con el cliente nombrado se rechaza (no se contesta con la obra de otro)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleObrasClientesAgent('ver_ficha_obra', { obra_id: IDS.obraMikelEtxeberria, obra_nombre: 'Ane Zubiri' }, NEGOCIO_A, USUARIO, db.client)) as { ok?: boolean; mensaje?: string; error?: string; obra_id?: string };
    expect(r.obra_id).toBeUndefined();
    expect(`${r.mensaje ?? ''}${r.error ?? ''}`).toMatch(/no cuadra/);
  });
  it('un obra_id que sí cuadra con el nombre dicho se acepta (cliente o nombre de obra)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await handleObrasClientesAgent('ver_ficha_obra', { obra_id: IDS.obraTerrazaAmaia, obra_nombre: 'Amaia' }, NEGOCIO_A, USUARIO, db.client)) as { obra_id?: string };
    expect(r.obra_id).toBe(IDS.obraTerrazaAmaia);
  });
});

describe('ronda 5.4: «ese presu»', () => {
  const id = IDS.presupuestoMikelBorrador;
  it('la marca viaja en el historial y se lee (la última gana)', () => {
    const hist = [
      { role: 'assistant', content: `Presupuesto nº 9.${marcaUltimoPresupuesto({ id: 'aaaaaaaa-0000-4000-8000-000000000009', numero: 9 })}` },
      { role: 'user', content: 'gracias' },
      { role: 'assistant', content: `Presupuesto nº 10.${marcaUltimoPresupuesto({ id, numero: 10 })}` },
    ];
    expect(leerUltimoPresupuestoDeHistorial(hist)).toEqual({ id, numero: 10 });
    expect(leerUltimoPresupuestoDeHistorial([{ role: 'assistant', content: 'hola' }])).toBeNull();
    expect(leerUltimoPresupuestoDeHistorial([{ role: 'assistant', content: 'x <!--presupuesto:{"id":"mal formado"-->' }])).toBeNull();
  });
  it('se saca del resultado de la tool', () => {
    expect(ultimoPresupuestoDeResultados([{ ok: true, presupuesto_id: id, numero_presupuesto: 10 }])).toEqual({ id, numero: 10 });
    expect(ultimoPresupuestoDeResultados([{ ok: false, error: 'x', presupuesto_id: id }])).toBeNull();
    expect(ultimoPresupuestoDeResultados([{ mensaje: 'hola' }])).toBeNull();
  });
  it('«ese/este/el último» pisa el id inventado por el modelo; con número explícito se respeta', () => {
    const plan = [{ tool: 'cambiar_estado_presupuesto', args: { presupuesto_id: 'inventado-123', estado: 'aceptado', numero: 3 } }];
    const r = inyectarUltimoPresupuesto(plan, 'márcalo aceptado en ese presu', { id, numero: 10 });
    expect(r[0].args).toMatchObject({ presupuesto_id: id, id, estado: 'aceptado' });
    expect(r[0].args.numero).toBeUndefined();
    expect(inyectarUltimoPresupuesto(plan, 'marca el 3 aceptado', { id, numero: 10 })).toBe(plan);
    expect(inyectarUltimoPresupuesto(plan, 'márcalo', { id, numero: 10 })).toBe(plan); // sin «ese»: no se toca
    expect(inyectarUltimoPresupuesto(plan, 'ese presu', null)).toBe(plan);
    const otra = [{ tool: 'buscar_obra', args: { query: 'x' } }];
    expect(inyectarUltimoPresupuesto(otra, 'ese presu', { id, numero: 10 })[0].args).toEqual({ query: 'x' });
  });
  it('resolverIdPresupuestoExistente no acepta un id inventado', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = (await presupuestos(db, 'cambiar_estado_presupuesto', { presupuesto_id: 'inventado-123', estado: 'aceptado' })) as { ok?: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No se encontró/);
    expect(db.updates).toHaveLength(0);
  });
});

describe('ronda 5.5: listar_gastos (solo lectura) y herramientas de borrar', () => {
  const lg = (db: Db, args: Record<string, unknown>) => handleGastosAgent('listar_gastos', args, NEGOCIO_A, USUARIO, db.client, {} as never, {});
  const base = () => {
    const b = crearBaseSimulada();
    b.gastos = [
      { id: 'g1', business_id: NEGOCIO_A, proveedor: 'Saltoki', fecha: '2026-10-01', importe: 100, iva: 21, importe_total: 121, categoria: 'material', obra_id: IDS.obraLeire, cliente_id: IDS.clienteLeire, descripcion: 'Cable' },
      { id: 'g2', business_id: NEGOCIO_A, proveedor: 'Saltoki', fecha: '2026-09-20', importe: 50, iva: 10.5, importe_total: 60.5, categoria: 'material', obra_id: null, cliente_id: null, descripcion: 'Tornillos' },
      { id: 'g3', business_id: NEGOCIO_A, proveedor: 'Bricomart', fecha: '2026-10-02', importe: 200, iva: 42, importe_total: 242, categoria: 'material', obra_id: IDS.obraMikelEtxeberria, cliente_id: IDS.clienteMikelEtxeberria, descripcion: 'Pintura' },
      { id: 'g4', business_id: NEGOCIO_B, proveedor: 'Saltoki', fecha: '2026-10-01', importe: 999, iva: 0, importe_total: 999, categoria: 'material', obra_id: null, cliente_id: null, descripcion: 'AJENO' },
    ];
    return b;
  };
  it('suma base, IVA y total de un proveedor, solo del negocio', async () => {
    const db = crearFakeDb(base());
    const r = (await lg(db, { proveedor: 'Saltoki' })) as { n: number; base_imponible: number; iva: number; total: number; mensaje: string; solo_lectura: boolean };
    expect(r).toMatchObject({ ok: true, solo_lectura: true, n: 2, base_imponible: 150, iva: 31.5, total: 181.5 });
    expect(r.mensaje).toContain('181,50 €');
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });
  it('filtra por obra, por cliente, por fechas y por periodo', async () => {
    const db = crearFakeDb(base());
    expect(await lg(db, { obra_nombre: 'Leire' })).toMatchObject({ n: 1, total: 121 });
    expect(await lg(db, { cliente_nombre: 'Mikel Etxeberria' })).toMatchObject({ n: 1, total: 242 });
    expect(await lg(db, { desde: '2026-10-01', hasta: '2026-10-01' })).toMatchObject({ n: 1, total: 121 });
    relojEn('2026-10-06T10:00:00Z');
    expect(await lg(db, { periodo: 'este_mes' })).toMatchObject({ n: 2, total: 363 });
    expect(await lg(db, { periodo: 'mes_pasado' })).toMatchObject({ n: 1, total: 60.5 });
  });
  it('una obra que no existe se dice, no se contesta con otra', async () => {
    const db = crearFakeDb(base());
    const r = (await lg(db, { obra_nombre: 'Zorionak Garmendia' })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No he encontrado ninguna obra/);
  });
  it('sin gastos: lo dice', async () => {
    const db = crearFakeDb(base());
    expect(await lg(db, { proveedor: 'Inexistente' })).toMatchObject({ n: 0, total: 0, mensaje: expect.stringContaining('No hay gastos') });
  });
  it('listar_gastos está en el grupo de gastos y NO es una herramienta que borre', () => {
    expect(GASTOS_AGENT_TOOLS.map((t) => (t.type === 'function' ? t.function.name : ''))).toContain('listar_gastos');
    expect(TOOLS_DESTRUCTIVAS.has('listar_gastos')).toBe(false);
  });
  it.each([
    '¿cuánto me he gastado en Saltoki?',
    'cuánto llevo gastado en material este mes',
    'dime los gastos de la obra de Leire',
    'qué gastos tengo con Bricomart',
    'enséñame lo de Saltoki',
    'total de gastos',
  ])('consulta «%s»: no pide borrar y se quitan todas las tools de borrar', (msg) => {
    expect(pideBorrar(msg)).toBe(false);
    const todas = [...TOOLS_DESTRUCTIVAS, 'listar_gastos'].map((name) => ({ type: 'function' as const, function: { name, parameters: {} } }));
    const quedan = quitarToolsDestructivasSiNoPideBorrar(todas, msg).map((t) => (t.type === 'function' ? t.function.name : ''));
    expect(quedan).toEqual(['listar_gastos']);
  });
  it.each(['borra el gasto de Saltoki', 'elimina ese gasto', 'quita el gasto de ayer', 'anula el ticket de Bricomart'])('«%s» sí pide borrar', (msg) => {
    expect(pideBorrar(msg)).toBe(true);
  });
  it('contestar «el segundo» a un «¿cuál borro?» cuenta; una consulta nueva no', () => {
    expect(pideBorrar('el segundo', 'Hay dos gastos. ¿Cuál quieres borrar?')).toBe(true);
    expect(pideBorrar('¿y cuánto es en total?', 'Hay dos gastos. ¿Cuál quieres borrar?')).toBe(false);
  });
});

describe('ronda 5.6: IVA, descripción y proveedor en gastos', () => {
  it.each([
    ['250 más IVA en Saltoki', 'base'],
    ['250 + IVA', 'base'],
    ['250 mas iva', 'base'],
    ['250 sin IVA', 'sin_iva'],
    ['250 con IVA', 'total'],
    ['250 IVA incluido', 'total'],
    ['250 euros', null],
  ])('«%s» → %s', (msg, modo) => expect(modoIvaDelMensaje(msg)).toBe(modo));

  it('«250 más IVA» es la BASE: el modelo lo puso como total y se corrige (250 + 52,50 = 302,50)', () => {
    const r = corregirImportesSegunMensaje('apunta 250 más IVA en Saltoki, plato de ducha', { importe: 206.61, iva: 43.39, importe_total: 250 });
    expect(r.datos).toEqual({ importe: 250, iva: 52.5, importe_total: 302.5 });
    expect(r.corregido).toBe(true);
  });
  it('«250 con IVA» es el TOTAL (250 = 206,61 + 43,39)', () => {
    const r = corregirImportesSegunMensaje('250 con IVA en Saltoki', { importe: 250, iva: 52.5, importe_total: 302.5 });
    expect(r.datos).toEqual({ importe: 206.61, iva: 43.39, importe_total: 250 });
  });
  it('«250 sin IVA»: sin IVA', () => {
    expect(corregirImportesSegunMensaje('250 sin IVA', { importe: 206.61, iva: 43.39, importe_total: 250 }).datos).toEqual({ importe: 250, iva: 0, importe_total: 250 });
  });
  it('respeta el tipo de IVA dicho (10 %) y no toca lo que ya está bien ni lo ambiguo', () => {
    expect(corregirImportesSegunMensaje('100 más 10% de IVA', { importe: 100, iva: 10, importe_total: 100 }).datos).toEqual({ importe: 100, iva: 10, importe_total: 110 });
    expect(corregirImportesSegunMensaje('250 más IVA', { importe: 250, iva: 52.5, importe_total: 302.5 }).corregido).toBe(false);
    expect(corregirImportesSegunMensaje('85 de material', { importe: 70.25, iva: 14.75, importe_total: 85 }).corregido).toBe(false);
  });
  it('el servidor lo aplica al guardar: «250 más IVA» queda base 250 / total 302,50', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    await gastos(db, { proveedor: 'Saltoki', importe: 206.61, iva: 43.39, importe_total: 250, fecha: '2026-10-06', categoria: 'material' }, '250 más IVA en Saltoki');
    expect(db.tablas.gastos[0]).toMatchObject({ importe: 250, iva: 52.5, importe_total: 302.5 });
  });
  it('la descripción sale del mensaje si el modelo no la manda', async () => {
    expect(descripcionDelMensaje('apunta 250 más IVA en Saltoki, plato de ducha y grifería', 'Saltoki')).toBe('Plato de ducha y grifería');
    expect(descripcionDelMensaje('121 con IVA en Saltoki para lo de Leire, cable y mecanismos', 'Saltoki')).toBe('Cable y mecanismos');
    expect(descripcionDelMensaje('250', 'Saltoki')).toBe('');
    const db = crearFakeDb(crearBaseSimulada());
    await gastos(db, { proveedor: 'Saltoki', importe: 250, iva: 52.5, importe_total: 302.5, fecha: '2026-10-06', categoria: 'material' }, 'apunta 250 más IVA en Saltoki, plato de ducha y grifería');
    expect(db.tablas.gastos[0].descripcion).toBe('Plato de ducha y grifería');
  });
  it('proveedor existente → proveedor_id; inexistente → pregunta y NO lo da de alta solo', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    await gastos(db, { proveedor: 'saltoki', importe: 100, iva: 21, importe_total: 121, fecha: '2026-10-06', categoria: 'material' }, '');
    expect(db.tablas.gastos[0]).toMatchObject({ proveedor: 'Saltoki', proveedor_id: IDS.proveedorSaltoki });
    const r = (await gastos(db, { proveedor: 'Ferretería Nueva', importe: 10, iva: 2.1, importe_total: 12.1, fecha: '2026-10-06', categoria: 'material' }, '')) as { mensaje: string };
    expect(r.mensaje).toMatch(/¿quieres que lo dé de alta\?/);
    expect(db.tablas.proveedores).toHaveLength(1); // no se creó
  });
});

describe('ronda 5.6d: un «sí» suelto', () => {
  it('detecta afirmaciones sueltas y las preguntas previas', async () => {
    const { esAfirmacionSuelta, asistentePreguntoAlgo } = await import('@/lib/agente/orquestacion');
    for (const t of ['sí', 'Sí.', 'vale', 'ok', 'hazlo', 'adelante!', 'dale', 'confirmo']) expect(esAfirmacionSuelta(t)).toBe(true);
    for (const t of ['sí, pero con 21', 'vale, factura el 3', 'ponme cita', 'no']) expect(esAfirmacionSuelta(t)).toBe(false);
    expect(asistentePreguntoAlgo('Gasto guardado. ¿quieres que lo dé de alta?')).toBe(true);
    expect(asistentePreguntoAlgo('Hecho: factura creada.')).toBe(false);
    expect(asistentePreguntoAlgo('Hecho. <!--presupuesto:{"id":"x"}-->')).toBe(false);
  });
});

describe('ronda 5.7: crear obra respeta el nombre y avisa si ya existe', () => {
  const deps = (db: Db, mensaje: string) => ({ supabase: db.client, businessId: NEGOCIO_A, mensajeUsuario: mensaje, runTool: async () => ({}) });
  it('completa «Hondarribia» si el modelo la recortó', () => {
    expect(completarNombreDesdeMensaje('Reforma baño Ane', 'crea la obra Reforma baño Ane Hondarribia para Ane', 'Ane Zubiri')).toBe('Reforma baño Ane Hondarribia');
    expect(completarNombreDesdeMensaje('Reforma baño Ane', 'crea la obra Reforma baño Ane para Ane Zubiri', 'Ane Zubiri')).toBe('Reforma baño Ane');
    expect(completarNombreDesdeMensaje('Obra X', 'otra cosa distinta', '')).toBe('Obra X');
  });
  it('la confirmación lleva el nombre completo', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('crear_obra', { nombre: 'Reforma baño Ane', cliente_nombre: 'Ane Zubiri' }, deps(db, 'crea la obra Reforma baño Ane Hondarribia para Ane Zubiri'));
    expect(prep.tipo).toBe('pendiente');
    const a = (prep as { accion: { args: Record<string, unknown>; resumen: string } }).accion;
    expect(a.args.nombre).toBe('Reforma baño Ane Hondarribia');
    expect(a.resumen).toContain('«Reforma baño Ane Hondarribia»');
  });
  it('si ya existe una obra con ese nombre, avisa y no crea nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('crear_obra', { nombre: 'reforma cocina leire ugarte' }, deps(db, 'crea la obra reforma cocina leire ugarte'));
    expect(prep.tipo).toBe('resultado');
    expect(JSON.stringify((prep as { result: unknown }).result)).toMatch(/Ya existe una obra llamada «Reforma cocina Leire Ugarte»/);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('ronda 5.8: alta de proveedor guarda la población en notas', () => {
  const deps = (db: Db, mensaje: string) => ({ supabase: db.client, businessId: NEGOCIO_A, mensajeUsuario: mensaje, runTool: async () => ({}) });
  it('«Bricomart de Irún» → notas «Población: Irún»', async () => {
    expect(datosExtraProveedor('Bricomart', 'da de alta a Bricomart de Irún')).toBe('Población: Irún');
    expect(datosExtraProveedor('Bricomart', 'da de alta a Bricomart')).toBe('');
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('crear_proveedor', { nombre: 'Bricomart' }, deps(db, 'da de alta a Bricomart de Irún'));
    const a = (prep as { accion: { args: Record<string, unknown>; resumen: string } }).accion;
    expect(a.args.notas).toBe('Población: Irún');
    const r = await handleGastosAgent('crear_proveedor', a.args, NEGOCIO_A, USUARIO, db.client, {} as never, {});
    expect(r).toMatchObject({ ok: true });
    expect(db.tablas.proveedores.find((p) => p.nombre === 'Bricomart')).toMatchObject({ notas: 'Población: Irún' });
  });
  it('conserva las notas que ya mandara el modelo', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const prep = await prepararAccionPendiente('crear_proveedor', { nombre: 'Bricomart', notas: 'Descuento 5 %' }, deps(db, 'da de alta a Bricomart de Irún'));
    expect((prep as { accion: { args: Record<string, unknown> } }).accion.args.notas).toBe('Descuento 5 % · Población: Irún');
  });
});
