import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';
import { handleAgenda } from '@/lib/agente/modules/agenda';
import { parseNumeroDocumento, scoreNombreMatch, resolverClientesPorNombre } from '@/lib/agente/modules/grounding';
import { parseEstadoPresupuesto } from '@/lib/presupuestos/estado';
import { modificarPartidasPresupuesto } from '@/lib/presupuestos/editar-partidas';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

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
    expect(db.tablas.agenda.find((a) => a.titulo === 'Visita')).toMatchObject({ cliente_id: IDS.clienteAinhoaEtxeberria });
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
