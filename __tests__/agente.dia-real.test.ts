import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';
import { handleAgenda } from '@/lib/agente/modules/agenda';
import { parseNumeroDocumento, scoreNombreMatch, resolverClientesPorNombre } from '@/lib/agente/modules/grounding';
import { parseEstadoPresupuesto } from '@/lib/presupuestos/estado';
import { modificarPartidasPresupuesto } from '@/lib/presupuestos/editar-partidas';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
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
