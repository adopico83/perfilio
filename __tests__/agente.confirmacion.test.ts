import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  TOOLS_CON_VISTA_PREVIA,
  TOOLS_EXENTAS_CONFIRMACION,
  TOOLS_REQUIEREN_CONFIRMACION,
  describirAccionGenerica,
  limpiarTextoVistaPrevia,
  preguntaConfirmacion,
  prepararAccionPendiente,
  requiereConfirmacion,
  validarAccionConfirmada,
} from '@/lib/agente/confirmacion';
import { DOCUMENTOS_AGENT_TOOLS } from '@/lib/agente/modules/documentos';
import { OBRAS_CLIENTES_AGENT_TOOLS } from '@/lib/agente/modules/obras-clientes';
import { CORREO_AGENT_TOOLS } from '@/lib/agente/modules/correo';
import { AGENDA_AGENT_TOOLS } from '@/lib/agente/modules/agenda';
import { GASTOS_AGENT_TOOLS } from '@/lib/agente/modules/gastos';
import { DIARIO_AGENT_TOOLS } from '@/lib/agente/modules/diario';
import { OPERARIOS_AGENT_TOOLS } from '@/lib/agente/modules/operarios';
import { PRESUPUESTOS_AGENT_TOOLS } from '@/lib/agente/modules/presupuestos';
import { ENLACES_PDF_AGENT_TOOLS } from '@/lib/agente/modules/enlaces-pdf';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

const TODAS = [
  ...DOCUMENTOS_AGENT_TOOLS,
  ...OBRAS_CLIENTES_AGENT_TOOLS,
  ...CORREO_AGENT_TOOLS,
  ...AGENDA_AGENT_TOOLS,
  ...GASTOS_AGENT_TOOLS,
  ...DIARIO_AGENT_TOOLS,
  ...OPERARIOS_AGENT_TOOLS,
  ...PRESUPUESTOS_AGENT_TOOLS,
  ...ENLACES_PDF_AGENT_TOOLS,
];
// Las dos de memoria están definidas dentro de route.ts.
const NOMBRES = new Set([...TODAS.map((t) => (t.type === 'function' ? t.function.name : '')), 'guardar_memoria', 'eliminar_memoria']);

const PREFIJOS_LECTURA = /^(listar_|obtener_|buscar_|ver_|consultar_|leer_|mostrar_|calcular_|get_|resumen_)/; // resumen_del_dia: solo lectura
const OTRAS_LECTURAS = new Set(['albaranes_sin_facturar', 'generar_pdf_diario']);

describe('lista de tools con confirmación', () => {
  it('toda tool que escribe está en la lista de confirmación o en la de excepciones justificadas', () => {
    const sinClasificar = [...NOMBRES].filter(
      (n) =>
        n &&
        !PREFIJOS_LECTURA.test(n) &&
        !OTRAS_LECTURAS.has(n) &&
        !TOOLS_REQUIEREN_CONFIRMACION.has(n) &&
        !(n in TOOLS_EXENTAS_CONFIRMACION)
    );
    expect(sinClasificar).toEqual([]);
  });

  it('no hay tools en las dos listas a la vez ni nombres que no existen', () => {
    for (const n of TOOLS_REQUIEREN_CONFIRMACION) {
      expect(n in TOOLS_EXENTAS_CONFIRMACION).toBe(false);
      expect(NOMBRES.has(n)).toBe(true);
    }
    for (const n of Object.keys(TOOLS_EXENTAS_CONFIRMACION)) expect(NOMBRES.has(n)).toBe(true);
    for (const n of TOOLS_CON_VISTA_PREVIA) expect(TOOLS_REQUIEREN_CONFIRMACION.has(n)).toBe(true);
  });

  it('cada excepción lleva su motivo', () => {
    for (const motivo of Object.values(TOOLS_EXENTAS_CONFIRMACION)) expect(motivo.length).toBeGreaterThan(15);
  });
});

describe('requiereConfirmacion', () => {
  it('las de escritura piden confirmación; las de lectura y las exentas, no', () => {
    expect(requiereConfirmacion('crear_cliente', { nombre: 'X' })).toBe(true);
    expect(requiereConfirmacion('convertir_presupuesto_a_factura', { numero: 7 })).toBe(true);
    expect(requiereConfirmacion('listar_presupuestos', {})).toBe(false);
    expect(requiereConfirmacion('agregar_partida_borrador', {})).toBe(false);
    expect(requiereConfirmacion('confirmar_borrador', {})).toBe(false);
    expect(requiereConfirmacion('enviar_email', {})).toBe(false);
  });
  it('pedir la vista previa no escribe: se ejecuta', () => {
    expect(requiereConfirmacion('registrar_jornada', { solo_vista_previa: true })).toBe(false);
    expect(requiereConfirmacion('registrar_jornada', { solo_vista_previa: false })).toBe(true);
    expect(requiereConfirmacion('registrar_jornada', {})).toBe(true);
    // crear_cliente no tiene vista previa: el parámetro no la salta.
    expect(requiereConfirmacion('crear_cliente', { solo_vista_previa: true })).toBe(true);
  });
  it('listar tarifas es lectura; añadir/borrar no', () => {
    expect(requiereConfirmacion('gestionar_tarifas', { accion: 'listar' })).toBe(false);
    expect(requiereConfirmacion('gestionar_tarifas', { accion: 'eliminar' })).toBe(true);
  });
  it('AGENTE_CONFIRMACION=off apaga la barrera (interruptor de emergencia)', () => {
    process.env.AGENTE_CONFIRMACION = 'off';
    expect(requiereConfirmacion('crear_cliente', {})).toBe(false);
    delete process.env.AGENTE_CONFIRMACION;
    expect(requiereConfirmacion('crear_cliente', {})).toBe(true);
  });
});

describe('validarAccionConfirmada (lo que llega del navegador)', () => {
  it('acepta una tool de la lista con sus argumentos', () => {
    expect(validarAccionConfirmada({ tool: 'crear_cliente', args: { nombre: 'X' } })).toEqual({
      ok: true,
      tool: 'crear_cliente',
      args: { nombre: 'X' },
    });
  });
  it.each([
    [null],
    ['crear_cliente'],
    [[]],
    [{ tool: 'listar_presupuestos', args: {} }], // lectura: no se confirma
    [{ tool: 'agregar_partida_borrador', args: {} }], // exenta
    [{ tool: 'tool_inventada', args: {} }],
    [{ args: {} }],
  ])('rechaza %j', (raw) => {
    expect(validarAccionConfirmada(raw).ok).toBe(false);
  });
  it('args que no son un objeto se convierten en {}', () => {
    expect(validarAccionConfirmada({ tool: 'crear_obra', args: 'x' })).toMatchObject({ ok: true, args: {} });
  });
});

describe('textos', () => {
  it('describirAccionGenerica enseña los datos reales sin volcar JSON', () => {
    const t = describirAccionGenerica('crear_recordatorio', { titulo: 'Visita con Ane', fecha: '2026-10-07', hora: '10:00', extra: { x: 1 } });
    expect(t).toBe('Voy a crear un recordatorio en la agenda (título: Visita con Ane, fecha: 2026-10-07, hora: 10:00).');
    expect(describirAccionGenerica('crear_cliente', {})).toBe('Voy a crear un cliente.');
  });
  it('limpia las instrucciones para el modelo de las vistas previas', () => {
    const sucio = 'Resumen de jornada:\n• Operario: Iker\n• Horas: 8\nPide confirmación explícita al usuario antes de guardar.\nSi el usuario confirma, vuelve a llamar a registrar_jornada con solo_vista_previa false.';
    expect(limpiarTextoVistaPrevia(sucio)).toBe('Resumen de jornada:\n• Operario: Iker\n• Horas: 8');
  });
  it('preguntaConfirmacion no duplica la pregunta', () => {
    expect(preguntaConfirmacion('Voy a crear X.')).toBe('Voy a crear X. ¿Lo hago?');
    expect(preguntaConfirmacion('¿Eliminar esta entrada?')).toBe('¿Eliminar esta entrada?');
  });
});

describe('prepararAccionPendiente', () => {
  const deps = (db: ReturnType<typeof crearFakeDb>, mensajeUsuario = '') => ({
    supabase: db.client,
    businessId: NEGOCIO_A,
    runTool: jest.fn(),
    mensajeUsuario,
  });

  it('presupuesto por número: args con su id exacto y resumen con nº, cliente e importe', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('convertir_presupuesto_a_factura', { numero: 7 }, deps(db));
    expect(r).toMatchObject({
      tipo: 'pendiente',
      accion: { tool: 'convertir_presupuesto_a_factura', args: { presupuesto_id: IDS.presupuesto7 } },
    });
    expect((r as { accion: { args: Record<string, unknown>; resumen: string } }).accion.args.numero).toBeUndefined();
    expect((r as { accion: { resumen: string } }).accion.resumen).toBe('Voy a crear la factura del presupuesto nº 7 de Paqui (8871 €).');
  });
  it('presupuesto por nombre con varios: devuelve aclaración con candidatos (no adivina)', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('convertir_presupuesto_a_factura', { query: 'García' }, deps(db));
    expect(r.tipo).toBe('resultado');
    const res = (r as { result: { necesita_aclaracion?: boolean; candidatos?: Array<{ etiqueta: string }> } }).result;
    expect(res.necesita_aclaracion).toBe(true);
    expect(res.candidatos?.map((c) => c.etiqueta).join('|')).toMatch(/nº 8 · García Norte.*\|nº 9 · García Sur|nº 9 · García Sur.*\|nº 8 · García Norte/);
  });
  it('presupuesto inexistente: error sin crear nada', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('cambiar_estado_presupuesto', { numero: 99, estado: 'aceptado' }, deps(db));
    expect(r.tipo).toBe('resultado');
  });
  it('tool con vista previa propia: usa su resumen limpio y la ejecuta con solo_vista_previa true', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const d = deps(db);
    d.runTool.mockResolvedValue({
      pendiente_confirmacion: true,
      mensaje: 'Resumen de jornada:\n• Operario: Iker\nSi el usuario confirma, vuelve a llamar a registrar_jornada con solo_vista_previa false.',
    });
    const r = await prepararAccionPendiente('registrar_jornada', { operario_nombre: 'Iker', horas: 8 }, d);
    expect(d.runTool).toHaveBeenCalledWith('registrar_jornada', { operario_nombre: 'Iker', horas: 8, solo_vista_previa: true });
    expect(r).toEqual({
      tipo: 'pendiente',
      accion: {
        tool: 'registrar_jornada',
        args: { operario_nombre: 'Iker', horas: 8, solo_vista_previa: false },
        resumen: 'Resumen de jornada:\n• Operario: Iker',
      },
    });
  });
  it('si la vista previa no es pendiente (aclaración o error) se devuelve tal cual, sin acción', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const d = deps(db);
    d.runTool.mockResolvedValue({ ok: false, error: 'Solape en agenda' });
    const r = await prepararAccionPendiente('crear_recordatorio', { titulo: 'X' }, d);
    expect(r).toEqual({ tipo: 'resultado', result: { ok: false, error: 'Solape en agenda' } });
  });
  it('diario por obra_nombre: resuelve la obra del negocio y deja su id en los args', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('crear_entrada_diario', { obra_nombre: 'Reforma Paqui', texto: 'Se ha picado' }, deps(db));
    expect(r).toMatchObject({ tipo: 'pendiente', accion: { args: { obra_id: IDS.obraPaqui } } });
    expect((r as { accion: { resumen: string } }).accion.resumen).toBe('Voy a anotar en el diario de «Reforma Paqui»: «Se ha picado».');
  });
  it('resto: resumen genérico con los argumentos', async () => {
    const db = crearFakeDb(crearBaseSimulada());
    const r = await prepararAccionPendiente('crear_cliente', { nombre: 'Lola' }, deps(db));
    expect(r).toEqual({
      tipo: 'pendiente',
      accion: { tool: 'crear_cliente', args: { nombre: 'Lola' }, resumen: 'Voy a crear un cliente (nombre: Lola).' },
    });
  });
});

describe('POST /api/agente con la barrera activa', () => {
  let db: ReturnType<typeof crearFakeDb>;
  beforeEach(() => {
    db = crearFakeDb(crearBaseSimulada());
    (createServiceClient as jest.Mock).mockReturnValue(db.client);
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) },
    });
    delete process.env.JEV_API_KEY;
    delete process.env.AGENTE_CONFIRMACION;
    process.env.OPENAI_API_KEY = 'k';
    createMock.mockReset();
  });
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/agente/route');
    const res = await POST(
      new NextRequest('http://localhost/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], ...body }),
      })
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const llamada = (name: string, args: object, id = 'c1') => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const modeloLlama = (...calls: ReturnType<typeof llamada>[]) =>
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: calls } }] });

  it('crear_cliente NO se ejecuta: devuelve accion_pendiente con resumen y no inserta nada', async () => {
    modeloLlama(llamada('crear_cliente', { nombre: 'Lola Nueva' }));
    const { json } = await post({ mensaje: 'crea el cliente Lola Nueva' });
    expect(json.accion_pendiente).toEqual({
      tool: 'crear_cliente',
      args: { nombre: 'Lola Nueva' },
      resumen: 'Voy a crear un cliente (nombre: Lola Nueva).',
    });
    expect(json.respuesta).toBe('Voy a crear un cliente (nombre: Lola Nueva). ¿Lo hago?');
    expect(db.inserts).toHaveLength(0);
    expect(createMock).toHaveBeenCalledTimes(1); // y sin segunda llamada al modelo para la prosa
  });

  it('con confirmar_accion se ejecuta, sin pasar por el modelo, y se responde con el resultado real', async () => {
    const { status, json } = await post({ confirmar_accion: { tool: 'crear_cliente', args: { nombre: 'Lola Nueva' } } });
    expect(status).toBe(200);
    expect(createMock).not.toHaveBeenCalled();
    expect(db.inserts.some((i) => i.tabla === 'clientes' && i.fila.nombre === 'Lola Nueva' && i.fila.business_id === NEGOCIO_A)).toBe(true);
    expect(String(json.respuesta)).not.toMatch(/error/i);
  });

  it('confirmar_accion con una tool que no es confirmable → 400 y no ejecuta nada', async () => {
    for (const tool of ['listar_presupuestos', 'agregar_partida_borrador', 'tool_inventada']) {
      const { status } = await post({ confirmar_accion: { tool, args: {} } });
      expect(status).toBe(400);
    }
    expect(db.inserts).toHaveLength(0);
  });

  it('confirmar_accion respeta el control de acceso al negocio', async () => {
    const { assertUserOwnsBusiness } = jest.requireMock('@/lib/supabase/assert-user-owns-business') as { assertUserOwnsBusiness: jest.Mock };
    assertUserOwnsBusiness.mockResolvedValueOnce(false);
    const { status } = await post({ confirmar_accion: { tool: 'crear_cliente', args: { nombre: 'X' } } });
    expect(status).toBe(403);
    expect(db.inserts).toHaveLength(0);
  });

  it('confirmar_accion pasa por los guardarraíles: no factura un presupuesto marcado «facturado»', async () => {
    const { json } = await post({
      confirmar_accion: { tool: 'convertir_presupuesto_a_factura', args: { presupuesto_id: IDS.presupuesto7, estado: 'facturado' } },
    });
    expect(String(json.respuesta)).toMatch(/ya está en estado «facturado»/);
    expect(db.tablas.facturas).toHaveLength(2);
  });

  it('varias acciones en un turno: solo una queda pendiente («una cosa cada vez»)', async () => {
    modeloLlama(llamada('crear_cliente', { nombre: 'A Nuevo' }, 'c1'), llamada('crear_obra', { nombre: 'Obra Nueva' }, 'c2'));
    const { json } = await post({ mensaje: 'crea el cliente A Nuevo y la obra Obra Nueva' });
    expect((json.accion_pendiente as { tool: string }).tool).toBe('crear_cliente');
    expect(String(json.respuesta)).toMatch(/Una cosa cada vez/);
    expect(db.inserts).toHaveLength(0);
  });

  it('una tool de lectura se ejecuta en el momento (sin pedir confirmación)', async () => {
    modeloLlama(llamada('obtener_facturas_pendientes', {}));
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: 'Tienes 1 factura pendiente.' } }] });
    const { json } = await post({ mensaje: 'qué facturas tengo pendientes' });
    expect(json.accion_pendiente).toBeUndefined();
    expect(json.respuesta).toBe('Tienes 1 factura pendiente.');
  });

  it('las claves de siempre de la respuesta no cambian cuando no hay acción pendiente', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: 'Aupa.' } }] });
    const { json } = await post({ mensaje: 'hola' });
    expect(Object.keys(json).sort()).toEqual(['canvas', 'email_pendiente', 'obra_modal', 'respuesta']);
  });
});
