/**
 * Ronda 8: escenarios de VARIOS turnos (la prueba e2e estricta en producción) con su resultado esperado.
 *
 * Cada escenario es una pequeña conversación sobre la base simulada. Los mismos escenarios se usan en:
 *  - `__tests__/jev.ronda8-escenarios.test.ts`: el traductor está SIMULADO (cada paso lleva la orden `orden` que debería salir);
 *  - `evals/jev-real.eval.ts` (`npm run eval:jev-real`): el traductor REAL (GPT-4o mini) ignora `orden` y traduce `mensaje`.
 * `ok` devuelve los problemas encontrados (lista vacía = bien). Todo lo que se comprueba es lo GUARDADO o lo MOSTRADO.
 */
import { crearFakeDb } from '../__tests__/helpers/fake-db';
import { baseRonda5 } from '../__tests__/helpers/jev-sesion';
import { IDS, NEGOCIO_A, USUARIO } from './base-simulada';
import { crearRunToolJev } from '@/lib/jev/despacho';
import { confirmarOrdenJev, procesarMensajeJev, type SalidaMotor } from '@/lib/jev/motor';
import type { EntradaTraductor, SalidaTraductor } from '@/lib/jev/traductor';
import { MENSAJE_NADA_PENDIENTE } from '@/lib/agente/orquestacion';

type Db = ReturnType<typeof crearFakeDb>;
type Fila = Record<string, unknown>;

export type PasoR8 =
  | {
      /** Lo que escribe el usuario. */
      mensaje: string;
      /** Solo en el modo simulado: la orden que debería salir del traductor. */
      orden?: Record<string, unknown>;
      continua?: boolean;
      otras?: Array<Record<string, unknown>>;
      /** Categoría del router de intención. */
      categoria?: string;
      ok?: (r: SalidaMotor, db: Db) => string[];
    }
  | {
      /** Pulsar «Sí, hazlo» en la última orden que enseñó el asistente. */
      confirmar: true;
      ok?: (r: SalidaMotor, db: Db) => string[];
    };

export type EscenarioR8 = {
  nombre: string;
  preparar?: (base: ReturnType<typeof baseRonda5>) => void;
  pasos: PasoR8[];
  /** Comprobación final sobre lo guardado. */
  final?: (db: Db) => string[];
  /** Presupuesto/cita «recordados» al empezar (como las marcas del historial del chat). */
  contexto?: { ultimoPresupuestoId?: string; ultimoEventoId?: string };
};

const esperar = (cond: unknown, problema: string): string[] => (cond ? [] : [problema]);
const contiene = (r: SalidaMotor, ...trozos: string[]) => trozos.flatMap((t) => esperar(r.respuesta.includes(t), `la respuesta no contiene «${t}»: «${r.respuesta.replace(/\n/g, ' ').slice(0, 200)}»`));
const tabla = (db: Db, t: string) => (db.tablas as Record<string, Fila[]>)[t] ?? [];
const escrituras = (db: Db) => db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;

const GASTO = { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' };
const MSG_GASTO = 'apunta un gasto de 87,40 en Saltoki para lo de Leire';

const conFontaneria = (b: ReturnType<typeof baseRonda5>) => {
  b.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.presupuesto_generado =
    'CAPÍTULO BAÑO\n1. Fontanería | Cantidad: 1 | Precio: 300,00 € | Importe: 300,00 €\n2. Mampara de ducha | Cantidad: 1 | Precio: 350,00 € | Importe: 350,00 €\nTOTAL BAÑO: 650,00 €\nBASE IMPONIBLE: 650,00 € | IVA (21%): 136,50 € | TOTAL: 786,50 €';
};
const P10 = { ultimoPresupuestoId: IDS.presupuestoMikelBorrador };

export const ESCENARIOS_RONDA8: EscenarioR8[] = [
  ...['no, mejor no', 'no, ese ya lo apunté yo'].map(
    (rechazo): EscenarioR8 => ({
      nombre: `«${rechazo}» con una orden pendiente → cancelada; después «vale» no ejecuta nada`,
      pasos: [
        { mensaje: MSG_GASTO, orden: GASTO, categoria: 'gastos', ok: (r) => esperar(r.accionPendiente, 'no quedó pendiente el gasto') },
        { mensaje: rechazo, ok: (r) => esperar(/no hago nada/i.test(r.respuesta) && !r.accionPendiente, `no canceló: «${r.respuesta.slice(0, 120)}»`) },
        { mensaje: 'vale', ok: (r) => esperar(r.respuesta === MENSAJE_NADA_PENDIENTE, `el «vale» hizo algo: «${r.respuesta.slice(0, 120)}»`) },
      ],
      final: (db) => esperar(tabla(db, 'gastos').length === 0, 'se guardó un gasto rechazado'),
    })
  ),
  {
    nombre: '«olvídalo» / «cancela» con una tarea a medias → tarea cerrada, sin borrar nada',
    pasos: [
      { mensaje: 'cita con Paqui el lunes', orden: { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes' }, categoria: 'agenda', ok: (r) => esperar(/hora/i.test(r.respuesta), 'no preguntó la hora') },
      { mensaje: 'olvídalo', ok: (r) => esperar(/no hago nada/i.test(r.respuesta), 'no cerró la tarea') },
      { mensaje: 'cancela', ok: (r) => esperar(!r.accionPendiente, 'preparó una acción con «cancela»') },
    ],
    final: (db) => esperar(tabla(db, 'agenda').length === 3, 'se tocó la agenda'),
  },
  {
    nombre: '«Aitor el pintor 7 y media y Jon el carpintero 6» → 7,5 h y 6 h (dos órdenes, ninguna perdida)',
    pasos: [
      {
        mensaje: 'Aitor el pintor 7 y media y Jon el carpintero 6 en lo de Paqui',
        orden: { accion: 'HORAS', operario_texto: 'Aitor el pintor', horas_texto: '7 y media', obra_texto: 'Paqui', mas_operarios: [{ operario_texto: 'Jon el carpintero', horas_texto: '6' }] },
        categoria: 'operarios',
        ok: (r) => [...contiene(r, 'Aitor Gómez', '7,5 h'), ...esperar(/Jon/.test(r.respuesta), 'no avisó de que queda Jon')],
      },
      { confirmar: true, ok: (r) => [...contiene(r, 'Jon Arrieta', '6 h'), ...esperar(r.accionPendiente, 'no preparó la de Jon')] },
      { confirmar: true },
    ],
    final: (db) => esperar(JSON.stringify(tabla(db, 'registros_jornada').map((x) => [x.operario_id, x.horas_reales])) === JSON.stringify([[IDS.operarioAitor, 7.5], [IDS.operarioJon, 6]]), `horas guardadas: ${JSON.stringify(tabla(db, 'registros_jornada').map((x) => [x.operario_id, x.horas_reales]))}`),
  },
  {
    nombre: '«no, son 7 y media no 7» → 7,5',
    pasos: [
      { mensaje: 'ponle 7 horas a Iker en lo de Paqui', orden: { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '7', obra_texto: 'Paqui' }, categoria: 'operarios', ok: (r) => contiene(r, '7 h') },
      { mensaje: 'no, son 7 y media no 7', orden: { accion: 'HORAS', horas_texto: '7 y media' }, continua: true, categoria: 'operarios', ok: (r) => [...contiene(r, '7,5 h'), ...esperar(r.accionPendiente, 'no volvió a pedir confirmación')] },
      { confirmar: true },
    ],
    final: (db) => esperar(tabla(db, 'registros_jornada').length === 1 && tabla(db, 'registros_jornada')[0]!.horas_reales === 7.5, 'no se guardaron 7,5 h'),
  },
  {
    nombre: '«añádele dos enchufes a 35» → 2 × 35',
    preparar: conFontaneria,
    contexto: P10,
    pasos: [{ mensaje: 'añádele dos enchufes a 35', orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'ese', anadir: [{ concepto_texto: 'enchufes', cantidad_texto: 'dos', precio_texto: '35' }] }, categoria: 'presupuesto', ok: (r) => [...contiene(r, 'nchufes'), ...esperar(/2 × 35/.test(r.respuesta), 'no es 2 × 35')] }],
  },
  {
    nombre: '«añádele colocar campana extractora 120 y quítale la fontanería» → +1 × 120 y −fontanería',
    preparar: conFontaneria,
    contexto: P10,
    pasos: [
      {
        mensaje: 'añádele colocar campana extractora 120 y quítale la fontanería',
        orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'ese', quitar_texto: ['fontanería'], anadir: [{ concepto_texto: 'colocar campana extractora', cantidad_texto: '120' }] },
        categoria: 'presupuesto',
        ok: (r) => [...esperar(/campana/i.test(r.respuesta) && /1 × 120/.test(r.respuesta), 'falta +1 × 120'), ...esperar(/fontaner/i.test(r.respuesta), 'se perdió quitar la fontanería')],
      },
    ],
  },
  {
    nombre: '«ponle 500» → pregunta a qué partida (no elige)',
    preparar: conFontaneria,
    contexto: P10,
    pasos: [{ mensaje: 'ponle 500', orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'ese', cambiar: [{ precio_texto: '500' }] }, categoria: 'presupuesto', ok: (r) => esperar(!r.accionPendiente && /qué partida/i.test(r.respuesta), `no preguntó: «${r.respuesta.slice(0, 160)}»`) }],
    final: (db) => esperar(escrituras(db) === 0, 'escribió algo'),
  },
  {
    nombre: '«espera, la encimera ponla a 230» con el dictado pendiente → nuevo resumen con 230',
    pasos: [
      {
        mensaje: 'presu para Paqui: encimera 210 y fregadero 120',
        orden: { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'encimera', cantidad_texto: '1', precio_texto: '210' }, { concepto_texto: 'fregadero', cantidad_texto: '1', precio_texto: '120' }] },
        categoria: 'presupuesto',
        ok: (r) => contiene(r, '210,00 €'),
      },
      {
        mensaje: 'espera, la encimera ponla a 230',
        orden: { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'encimera', cantidad_texto: '1', precio_texto: '230' }, { concepto_texto: 'fregadero', cantidad_texto: '1', precio_texto: '120' }] },
        continua: true,
        categoria: 'presupuesto',
        ok: (r) => [...contiene(r, '230,00 €'), ...esperar(!r.respuesta.includes('210,00 €') && r.accionPendiente, 'no es un resumen nuevo con 230')],
      },
      { confirmar: true },
    ],
    final: (db) => esperar(tabla(db, 'presupuestos').filter((p) => p.cliente_nombre === 'Paqui' && p.estado === 'borrador').length === 1 && tabla(db, 'presupuestos').some((p) => p.importe_total === 423.5), 'el presupuesto guardado no es el de 230 + 120'),
  },
  {
    nombre: '«presu pa Mikel Urkiola: …» con el cliente «Mikel PRUEBA Urkiola» → lo encuentra',
    pasos: [
      {
        mensaje: 'presu pa Mikel Urkiola: alicatar el baño 12 metros a 40',
        orden: { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Mikel Urkiola', partidas: [{ concepto_texto: 'alicatar el baño', cantidad_texto: '12', unidad_texto: 'metros', precio_texto: '40' }] },
        categoria: 'presupuesto',
        ok: (r) => [...contiene(r, 'Mikel PRUEBA Urkiola'), ...esperar(r.accionPendiente, 'no lo encontró')],
      },
    ],
  },
  {
    nombre: '«factura suelta a <cliente con la obra cerrada> por 85 más IVA» → sin obra, con NIF, dirección y línea',
    pasos: [
      { mensaje: 'factura suelta a Amaia por 85 más IVA', orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Amaia', importe_texto: '85', iva_modo: 'mas', sin_obra: 'si' }, categoria: 'documentos', ok: (r) => [...contiene(r, 'Base 85,00 € + IVA 21 % 17,85 € = Total 102,85 €'), ...esperar(r.accionPendiente, 'no quedó pendiente')] },
      { confirmar: true },
    ],
    final: (db) => {
      const f = tabla(db, 'facturas').at(-1)!;
      return [
        ...esperar(f.cliente_nif === '55555555C' && f.cliente_direccion === 'Calle Amaia 5', 'faltan NIF o dirección en la factura'),
        ...esperar(Array.isArray(f.lineas) && (f.lineas as unknown[]).length === 1, 'sin línea de concepto'),
        ...esperar(Boolean(f.fecha_vencimiento), 'sin vencimiento'),
        ...esperar(!f.obra_id, 'se ligó a una obra'),
        ...esperar(f.total === 102.85, `total ${String(f.total)}`),
      ];
    },
  },
  {
    nombre: '«factura a Ane por 200» → pregunta cuál Ane y si es con o más IVA',
    pasos: [
      { mensaje: 'factura a Ane por 200', orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Ane', importe_texto: '200' }, categoria: 'documentos', ok: (r) => esperar((r.opciones?.length ?? 0) === 2 && !r.accionPendiente, 'no preguntó cuál Ane') },
      { mensaje: '2', ok: (r) => esperar(!r.accionPendiente && /IVA/.test(r.respuesta) && /incluido|sumar/i.test(r.respuesta), `no preguntó por el IVA: «${r.respuesta.slice(0, 160)}»`) },
    ],
    final: (db) => esperar(escrituras(db) === 0, 'escribió algo'),
  },
  {
    nombre: '«gasto 87,40 sin IVA» → pregunta',
    pasos: [{ mensaje: 'gasto 87,40 sin IVA en Saltoki', orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }, categoria: 'gastos', ok: (r) => esperar(!r.accionPendiente && /Sin IVA/i.test(r.respuesta), `no preguntó: «${r.respuesta.slice(0, 160)}»`) }],
  },
  {
    nombre: '«la visita con Ane Lasa pásala al jueves de la semana que viene» → la de Ane directamente, 15 oct',
    pasos: [{ mensaje: 'la visita con Ane Lasa pásala al jueves de la semana que viene', orden: { accion: 'CITA_MOVER', evento_texto: 'Ane Lasa', fecha_texto: 'el jueves de la semana que viene' }, categoria: 'agenda', ok: (r) => [...contiene(r, '2026-10-15', 'Ane Lasa'), ...esperar(r.accionPendiente, 'no preparó el cambio')] }],
  },
  {
    nombre: '«pásala al viernes» después de crear una cita → esa cita',
    pasos: [
      { mensaje: 'apunta una cita con Paqui el lunes a las 10', orden: { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes', hora_texto: '10' }, categoria: 'agenda', ok: (r) => esperar(r.accionPendiente, 'no preparó la cita') },
      { confirmar: true },
      { mensaje: 'pásala al viernes', orden: { accion: 'CITA_MOVER', evento_texto: 'ella', fecha_texto: 'al viernes' }, categoria: 'agenda', ok: (r) => [...contiene(r, 'Cita con Paqui'), ...esperar(r.accionPendiente, 'no la movió')] },
    ],
  },
  {
    nombre: '«hazme la factura del presu 7 de Mikel» → el nº 7 sin preguntar',
    pasos: [{ mensaje: 'hazme la factura del presu 7 de Mikel', orden: { accion: 'FACTURAR', presupuesto_texto: '7' }, categoria: 'documentos', ok: (r) => [...contiene(r, 'nº 7'), ...esperar(r.accionPendiente && !r.opciones?.length, 'preguntó en vez de usar el nº 7')] }],
  },
  {
    nombre: '«visita con el de Maderas Oria el lunes a las 8» → cita, sin alta de cliente',
    pasos: [
      { mensaje: 'visita con el de Maderas Oria el lunes a las 8', orden: { accion: 'CITA_CREAR', cliente_texto: 'el de Maderas Oria', fecha_texto: 'el lunes', hora_texto: 'a las 8' }, categoria: 'agenda', ok: (r) => [...contiene(r, 'Maderas Oria'), ...esperar(r.accionPendiente && !/alta/i.test(r.respuesta), 'ofreció dar de alta o no preparó la cita')] },
    ],
  },
];

/** Corre un escenario completo. `traductor` real o simulado; devuelve los problemas (vacío = bien). */
export async function ejecutarEscenario(
  esc: EscenarioR8,
  traductor: (e: EntradaTraductor, paso: Extract<PasoR8, { mensaje: string }>) => Promise<SalidaTraductor>
): Promise<{ problemas: string[]; db: Db }> {
  const base = baseRonda5();
  esc.preparar?.(base);
  const db = crearFakeDb(base);
  const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
  const problemas: string[] = [];
  let ultimoAsistente: string | undefined;
  let ultimaOrdenId: string | null = null;
  let ultimoEventoId = esc.contexto?.ultimoEventoId ?? null;
  const ultimoPresupuestoId = esc.contexto?.ultimoPresupuestoId ?? null;
  const ahora = new Date('2026-10-06T10:00:00Z');
  const hoyTexto = 'martes, 6 de octubre de 2026';
  for (const [i, paso] of esc.pasos.entries()) {
    let r: SalidaMotor;
    if ('confirmar' in paso) {
      if (!ultimaOrdenId) {
        problemas.push(`paso ${i + 1}: no había nada que confirmar`);
        break;
      }
      r = await confirmarOrdenJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, ordenId: ultimaOrdenId, runTool, ahora });
    } else {
      r = await procesarMensajeJev({
        supabase: db.client,
        businessId: NEGOCIO_A,
        userId: USUARIO,
        mensaje: paso.mensaje,
        categoria: paso.categoria ?? 'general',
        hoyTexto,
        ahora,
        ultimoAsistente,
        ultimoPresupuestoId,
        ultimoEventoId,
        runTool,
        traducir: (e) => traductor(e, paso),
      });
    }
    ultimoAsistente = r.respuesta;
    ultimaOrdenId = r.accionPendiente?.orden_id ?? null;
    const ev = (r.resultado as { evento_id?: unknown } | undefined)?.evento_id;
    if (typeof ev === 'string') ultimoEventoId = ev;
    const nombrePaso = 'confirmar' in paso ? 'confirmar' : `«${paso.mensaje}»`;
    for (const p of paso.ok?.(r, db) ?? []) problemas.push(`paso ${i + 1} ${nombrePaso}: ${p}`);
  }
  for (const p of esc.final?.(db) ?? []) problemas.push(`final: ${p}`);
  return { problemas, db };
}
