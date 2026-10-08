/**
 * BLOQUE DE PARÁFRASIS (ronda 9): lo mismo que ya se probó, dicho de otra forma.
 *
 * Las frases de aquí NO aparecen en el código ni en los prompts del producto (ni en los de los tests simulados): miden si
 * el sistema ENTIENDE, no si recuerda una lista. Son conversaciones cortas sobre la base simulada con cinco familias:
 * cancelar, confirmar, corregir, varias órdenes, respuestas cortas a una pregunta, proveedor frente a cliente y dudas
 * (ante la duda nunca se guarda). Se corren con el traductor y el clasificador REALES en `npm run eval:jev-real` (su
 * porcentaje sale aparte) y con modelos SIMULADOS en `__tests__/jev.parafrasis.test.ts` (cada paso lleva `orden`/`intencion`).
 */
import type { EscenarioR8, PasoR8 } from './ronda8';
import type { Intencion } from '@/lib/jev/intencion';

type Db = Parameters<NonNullable<EscenarioR8['final']>>[0];
type Fila = Record<string, unknown>;
const tabla = (db: Db, t: string) => (db.tablas as Record<string, Fila[]>)[t] ?? [];
const esperar = (cond: unknown, problema: string): string[] => (cond ? [] : [problema]);
const escrituras = (db: Db) => db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;
type R = Parameters<NonNullable<Extract<PasoR8, { mensaje: string }>['ok']>>[0];
const contiene = (r: R, ...trozos: string[]) => trozos.flatMap((t) => esperar(r.respuesta.includes(t), `la respuesta no contiene «${t}»: «${r.respuesta.replace(/\n/g, ' ').slice(0, 200)}»`));

const GASTO = { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' };
const MSG_GASTO = 'apunta un gasto de 87,40 en Saltoki para lo de Leire';
const HORAS = { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '7', obra_texto: 'Paqui' };
const MSG_HORAS = 'ponle 7 horas a Iker en lo de Paqui';
const CITA = { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes', hora_texto: '10' };
const MSG_CITA = 'apunta una cita con Paqui el lunes a las 10';

const pendienteGasto = (): PasoR8 => ({ mensaje: MSG_GASTO, orden: GASTO, categoria: 'gastos', ok: (r) => esperar(r.accionPendiente, 'no quedó pendiente el gasto') });
const pendienteHoras = (): PasoR8 => ({ mensaje: MSG_HORAS, orden: HORAS, categoria: 'operarios', ok: (r) => esperar(r.accionPendiente, 'no quedó pendiente la hora') });
const pendienteCita = (): PasoR8 => ({ mensaje: MSG_CITA, orden: CITA, categoria: 'agenda', ok: (r) => esperar(r.accionPendiente, 'no quedó pendiente la cita') });

const cancelaGasto = (frase: string): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · cancelar] «${frase}» con un gasto pendiente → no se guarda`,
  pasos: [pendienteGasto(), { mensaje: frase, intencion: 'CANCELA', ok: (r) => esperar(!r.accionPendiente, `dejó una orden pendiente: «${r.respuesta.slice(0, 120)}»`) }],
  final: (db) => [...esperar(tabla(db, 'gastos').length === 0, 'se guardó un gasto que se canceló'), ...esperar(escrituras(db) === 0, 'escribió algo')],
});
const cancelaHoras = (frase: string): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · cancelar] «${frase}» con horas pendientes → no se guardan`,
  pasos: [pendienteHoras(), { mensaje: frase, intencion: 'CANCELA', ok: (r) => esperar(!r.accionPendiente, `dejó una orden pendiente: «${r.respuesta.slice(0, 120)}»`) }],
  final: (db) => esperar(tabla(db, 'registros_jornada').length === 0 && escrituras(db) === 0, 'se guardaron horas que se cancelaron'),
});
const confirmaGasto = (frase: string): EscenarioR8 => ({
  maxEscrituras: { gastos: 1 },
  nombre: `[paráfrasis · confirmar] «${frase}» con un gasto pendiente → se guarda`,
  pasos: [pendienteGasto(), { mensaje: frase, intencion: 'CONFIRMA' }],
  final: (db) => esperar(tabla(db, 'gastos').length === 1 && tabla(db, 'gastos')[0]!.importe_total === 87.4, `gastos guardados: ${JSON.stringify(tabla(db, 'gastos').map((g) => g.importe_total))}`),
});
const confirmaHoras = (frase: string): EscenarioR8 => ({
  maxEscrituras: { registros_jornada: 1 },
  nombre: `[paráfrasis · confirmar] «${frase}» con horas pendientes → se guardan`,
  pasos: [pendienteHoras(), { mensaje: frase, intencion: 'CONFIRMA' }],
  final: (db) => esperar(tabla(db, 'registros_jornada').length === 1 && tabla(db, 'registros_jornada')[0]!.horas_reales === 7, `horas guardadas: ${JSON.stringify(tabla(db, 'registros_jornada').map((x) => x.horas_reales))}`),
});
const corrigeHoras = (frase: string, orden: Record<string, unknown>, enseña: string, guardado: { horas: number; operario?: string }): EscenarioR8 => ({
  maxEscrituras: { registros_jornada: 1 },
  nombre: `[paráfrasis · corregir] «${frase}» → vuelve a enseñar «${enseña}» y guarda lo corregido`,
  pasos: [
    pendienteHoras(),
    { mensaje: frase, intencion: 'CORRIGE', orden: { ...HORAS, ...orden }, continua: true, categoria: 'operarios', ok: (r) => [...contiene(r, enseña), ...esperar(r.accionPendiente, 'no volvió a pedir confirmación')] },
    { confirmar: true },
  ],
  final: (db) => {
    const f = tabla(db, 'registros_jornada');
    return esperar(f.length === 1 && f[0]!.horas_reales === guardado.horas && (!guardado.operario || f[0]!.operario_id === guardado.operario), `guardado: ${JSON.stringify(f.map((x) => [x.operario_id, x.horas_reales]))}`);
  },
});
const corrigeCita = (frase: string, orden: Record<string, unknown>, enseña: string): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · corregir] «${frase}» con una cita pendiente → nuevo resumen con «${enseña}»`,
  pasos: [pendienteCita(), { mensaje: frase, intencion: 'CORRIGE', orden: { ...CITA, ...orden }, continua: true, categoria: 'agenda', ok: (r) => [...contiene(r, enseña), ...esperar(r.accionPendiente, 'no volvió a pedir confirmación')] }],
  final: (db) => esperar(tabla(db, 'agenda').length === 3, 'guardó la cita sin confirmación'),
});
const horaCorta = (frase: string, hora: string): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · respuesta corta] cita sin hora, «${frase}» → ${hora}`,
  pasos: [
    { mensaje: 'cita con Paqui el lunes', orden: { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes' }, categoria: 'agenda', ok: (r) => esperar(/hora/i.test(r.respuesta) && !r.accionPendiente, 'no preguntó la hora') },
    { mensaje: frase, intencion: 'RESPUESTA', ok: (r) => [...contiene(r, hora, 'Paqui'), ...esperar(r.accionPendiente, 'no preparó la cita')] },
  ],
});
const clienteCorto = (frase: string): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · respuesta corta] «factura a Ane por 200», «${frase}» → Ane Mendia`,
  pasos: [
    { mensaje: 'factura a Ane por 200', orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Ane', importe_texto: '200' }, categoria: 'documentos', ok: (r) => esperar((r.opciones?.length ?? 0) === 2 && !r.accionPendiente, 'no preguntó cuál Ane') },
    { mensaje: frase, intencion: 'RESPUESTA', ok: (r) => esperar(!r.accionPendiente && /IVA/.test(r.respuesta), `no siguió con el IVA: «${r.respuesta.slice(0, 160)}»`) },
    { mensaje: 'súmale el IVA encima', intencion: 'RESPUESTA', orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Ane', importe_texto: '200', iva_modo: 'mas' }, continua: true, categoria: 'documentos', ok: (r) => [...contiene(r, 'Ane Mendia', '242,00 €'), ...esperar(r.accionPendiente, 'no preparó la factura')] },
  ],
  final: (db) => esperar(!tabla(db, 'facturas').some((f) => /Ane/.test(String(f.cliente_nombre))), 'creó la factura sin confirmación'),
});
const proveedorGasto = (frase: string, orden: Record<string, unknown>, total: string): EscenarioR8 => ({
  maxEscrituras: { gastos: 1 },
  nombre: `[paráfrasis · proveedor frente a cliente] «${frase}» → gasto de Maderas Oria (${total})`,
  pasos: [
    { mensaje: frase, orden: { accion: 'GASTO', proveedor_texto: 'Maderas Oria', ...orden }, categoria: 'gastos', ok: (r) => [...contiene(r, 'Maderas Oria', total), ...esperar(r.accionPendiente && !/dar de alta/i.test(r.respuesta), 'no preparó el gasto o ofreció dar de alta')] },
    { confirmar: true },
  ],
  final: (db) => esperar(tabla(db, 'gastos').length === 1 && !tabla(db, 'facturas').some((f) => /Maderas/.test(String(f.cliente_nombre))), `gastos ${tabla(db, 'gastos').length}, facturas a Maderas ${tabla(db, 'facturas').filter((f) => /Maderas/.test(String(f.cliente_nombre))).length}`),
});
const proveedorCita = (frase: string, orden: Record<string, unknown>): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · proveedor frente a cliente] «${frase}» → cita con Maderas Oria, sin alta de cliente`,
  pasos: [{ mensaje: frase, orden: { accion: 'CITA_CREAR', ...orden }, categoria: 'agenda', ok: (r) => [...contiene(r, 'Maderas Oria'), ...esperar(r.accionPendiente && !/alta/i.test(r.respuesta), 'ofreció dar de alta o no preparó la cita')] }],
  final: (db) => esperar(escrituras(db) === 0, 'escribió antes del «Sí»'),
});
const duda = (frase: string, intencion: Intencion = 'CANCELA'): EscenarioR8 => ({
  maxEscrituras: {},
  nombre: `[paráfrasis · duda] «${frase}» con un gasto pendiente → NO se guarda`,
  pasos: [pendienteGasto(), { mensaje: frase, intencion, orden: { accion: 'ACLARAR', pregunta: '¿Qué necesitas?' }, ok: (r) => esperar(!/Hecho|apuntado|guardado/i.test(r.respuesta), `parece que lo hizo: «${r.respuesta.slice(0, 120)}»`) }],
  final: (db) => esperar(tabla(db, 'gastos').length === 0 && escrituras(db) === 0, 'guardó algo ante una duda'),
});
// El orden en que el asistente enseña las órdenes no importa: lo que importa es que ninguna se pierda y que ambas se guarden.
const variasHoras = (frase: string, orden: Record<string, unknown>, otras?: Array<Record<string, unknown>>): EscenarioR8 => ({
  varias: true,
  maxEscrituras: { gastos: 0, registros_jornada: 2 },
  nombre: `[paráfrasis · varias órdenes] «${frase}» → las dos órdenes, ninguna perdida`,
  pasos: [
    { mensaje: frase, intencion: 'VARIAS', orden, ...(otras ? { otras } : {}), categoria: 'operarios', ok: (r) => esperar(r.accionPendiente && /Aitor|Jon/.test(r.respuesta) && /Después te pregunto|Jon|Aitor/.test(r.respuesta), 'no preparó una y avisó de la otra') },
    { confirmar: true, ok: (r) => esperar(r.accionPendiente, 'no preparó la segunda') },
    { confirmar: true },
  ],
  final: (db) => esperar(JSON.stringify(tabla(db, 'registros_jornada').map((x) => x.horas_reales).sort()) === JSON.stringify([6, 7.5]), `horas guardadas: ${JSON.stringify(tabla(db, 'registros_jornada').map((x) => x.horas_reales))}`),
});
const variasMixtas = (frase: string): EscenarioR8 => ({
  varias: true,
  maxEscrituras: { gastos: 1, registros_jornada: 1 },
  nombre: `[paráfrasis · varias órdenes] «${frase}» → gasto y horas, ninguno perdido`,
  pasos: [
    {
      mensaje: frase,
      intencion: 'VARIAS',
      orden: GASTO,
      otras: [{ accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' }],
      categoria: 'gastos',
      ok: (r) => esperar(r.accionPendiente && /Después te pregunto/.test(r.respuesta), `no avisó de la otra orden: «${r.respuesta.replace(/\n/g, ' ').slice(0, 160)}»`),
    },
    { confirmar: true, ok: (r) => esperar(r.accionPendiente, 'no preparó la segunda') },
    { confirmar: true },
  ],
  final: (db) => esperar(tabla(db, 'gastos').length === 1 && tabla(db, 'registros_jornada').length === 1, `gastos ${tabla(db, 'gastos').length}, jornadas ${tabla(db, 'registros_jornada').length}`),
});


// Varias órdenes de TIPOS DISTINTOS, en cualquier orden y con otras palabras: nada se pierde sin aviso y cada una se guarda una vez.
type OrdenSim = Record<string, unknown>;
const G = (importe: string, obra = 'Leire'): OrdenSim => ({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: importe, iva_modo: 'incluido', obra_texto: obra });
const GM = (importe: string): OrdenSim => ({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: importe, iva_modo: 'mas', obra_texto: 'Leire' });
const H = (op: string, horas: string): OrdenSim => ({ accion: 'HORAS', operario_texto: op, horas_texto: horas, obra_texto: 'Paqui' });
const C = (fecha: string, hora: string): OrdenSim => ({ accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: fecha, hora_texto: hora });
const D = (texto: string): OrdenSim => ({ accion: 'DIARIO', obra_texto: 'Paqui', texto });
const mezcla = (frase: string, ordenes: OrdenSim[], esperado: Record<string, number>, categoria = 'general'): EscenarioR8 => ({
  nombre: `[paráfrasis · varias de distinto tipo] «${frase}» → ${ordenes.map((o) => String(o.accion)).join(' + ')}, ninguna perdida`,
  varias: true,
  maxEscrituras: esperado,
  pasos: [
    { mensaje: frase, intencion: 'VARIAS', orden: ordenes[0]!, otras: ordenes.slice(1), categoria, ok: (r) => esperar(r.accionPendiente, 'no preparó la primera') },
    ...ordenes.slice(1).map((): PasoR8 => ({ confirmar: true, ok: (r) => esperar(r.accionPendiente, 'no preparó la siguiente') })),
    { confirmar: true },
  ],
  final: (db) => Object.entries(esperado).flatMap(([t, n]) => esperar(tabla(db, t).length >= n && escriturasPorTablaN(db, t) === n, `«${t}»: ${escriturasPorTablaN(db, t)} guardadas en vez de ${n}`)),
});
const escriturasPorTablaN = (db: Db, t: string) => db.inserts.filter((i) => i.tabla === t).length;

export const PARAFRASIS_VARIAS: EscenarioR8[] = [
  mezcla('Saltoki me ha cobrado 87,40 con IVA por lo de Leire, y Jon hizo 6 horas ayer en lo de Paqui', [G('87,40'), H('Jon', '6')], { gastos: 1, registros_jornada: 1 }),
  mezcla('Iker ha echado 5 horas en lo de Paqui y el jueves a las 9 tengo visita con Paqui', [H('Iker', '5'), C('el jueves', 'a las 9')], { registros_jornada: 1, agenda: 1 }),
  mezcla('metí 45 con IVA de tornillos en Saltoki para lo de Leire; en el diario de Paqui pon que hoy se ha picado el baño', [G('45'), D('hoy se ha picado el baño')], { gastos: 1, diario_obra: 1 }),
  mezcla('anota en el diario de Paqui que se ha pintado el techo y que Aitor hizo 8 horas', [D('se ha pintado el techo'), H('Aitor', '8')], { diario_obra: 1, registros_jornada: 1 }),
  mezcla('mañana a las 10 reunión con Paqui, ah y apunta un ticket de Saltoki de 20 con IVA para Leire', [C('mañana', 'a las 10'), G('20')], { agenda: 1, gastos: 1 }),
  mezcla('Aitor 4 y media en lo de Paqui; también la factura de Saltoki de 120 más IVA de lo de Leire', [H('Aitor', '4 y media'), GM('120')], { registros_jornada: 1, gastos: 1 }),
  mezcla('pon en el diario de Paqui que llovió y apúntame visita con Paqui el viernes a las 11', [D('llovió'), C('el viernes', 'a las 11')], { diario_obra: 1, agenda: 1 }),
  mezcla('gasto de 33 con IVA en Saltoki para Leire, Jon 6 horas en lo de Paqui y visita con Paqui el lunes a las 8', [G('33'), H('Jon', '6'), C('el lunes', 'a las 8')], { gastos: 1, registros_jornada: 1, agenda: 1 }),
  mezcla('visita con Paqui el lunes a las 8 y anota en el diario que se acabó el alicatado', [C('el lunes', 'a las 8'), D('se acabó el alicatado')], { agenda: 1, diario_obra: 1 }),
  mezcla('Jon hizo 7 horas en lo de Paqui y Saltoki me pasó 61 más IVA para lo de Leire', [H('Jon', '7'), GM('61')], { registros_jornada: 1, gastos: 1 }),
];

export const PARAFRASIS_R9: EscenarioR8[] = [
  // CANCELAR (15)
  ...[
    'uy, déjalo, que eso lo pasa mi mujer luego',
    'quita quita, no lo guardes',
    'mejor lo dejamos para mañana',
    'no hombre no, olvida ese gasto',
    'espera espera, me he liado de ticket',
    'no lo metas todavía, tengo que mirar una cosa',
    'anda, tíralo, ya lo tenía puesto',
    'ni lo toques, que me equivoqué de proveedor',
    'paso de apuntarlo, gracias',
    'no no, eso no era para hoy',
  ].map(cancelaGasto),
  ...['no, esas horas no eran, anula', 'retira eso, por favor', 'descártalo', 'borra lo que ibas a poner', 'no las pongas'].map(cancelaHoras),
  // CONFIRMAR (10)
  ...['dale', 'venga, guárdalo', 'adelante con ello', 'perfecto, así está bien', 'correcto, apúntalo', 'sí señor, mételo'].map(confirmaGasto),
  ...['tal cual, para adelante', 'eso es, regístralas', 'me parece bien, guárdalas', 'pues sí, anótalas'].map(confirmaHoras),
  // CORREGIR (10)
  corrigeHoras('pues en realidad fueron siete horas y media', { horas_texto: 'siete horas y media' }, '7,5 h', { horas: 7.5 }),
  corrigeHoras('perdona, me columpié: fueron 8', { horas_texto: '8' }, '8 h', { horas: 8 }),
  corrigeHoras('que sean seis y cuarto mejor', { horas_texto: 'seis y cuarto' }, '6,25 h', { horas: 6.25 }),
  corrigeHoras('mmm eran ocho justas, no siete', { horas_texto: '8' }, '8 h', { horas: 8 }),
  corrigeHoras('no eran de Iker, eran de Jon', { operario_texto: 'Jon' }, 'Jon Arrieta', { horas: 7 }),
  corrigeCita('mejor a las once', { hora_texto: 'a las once' }, '11:00'),
  corrigeCita('que sea por la tarde, a las cinco', { hora_texto: 'a las 5 de la tarde' }, '17:00'),
  corrigeCita('ponla el miércoles mejor', { fecha_texto: 'el miércoles' }, '2026-10-07'),
  corrigeCita('pasa la hora a las nueve y media', { hora_texto: 'las nueve y media' }, '09:30'),
  corrigeCita('en vez de a las diez, a las doce', { hora_texto: 'a las doce' }, '12:00'),
  // VARIAS ÓRDENES (4)
  variasHoras('Aitor siete y media y Jon seis, los dos en lo de Paqui', { accion: 'HORAS', operario_texto: 'Aitor', horas_texto: 'siete y media', obra_texto: 'Paqui', mas_operarios: [{ operario_texto: 'Jon', horas_texto: 'seis' }] }),
  variasHoras('hoy Jon ha hecho 6 y Aitor 7 y media en lo de Paqui', { accion: 'HORAS', operario_texto: 'Aitor', horas_texto: '7 y media', obra_texto: 'Paqui', mas_operarios: [{ operario_texto: 'Jon', horas_texto: '6' }] }),
  variasMixtas('apunta 87,40 de Saltoki para lo de Leire y de paso ponle 6 horas a Jon en lo de Paqui'),
  variasMixtas('dos cosas: Jon 6 horas en lo de Paqui, y el ticket de Saltoki de 87,40 con IVA para Leire'),
  // RESPUESTAS CORTAS (9)
  horaCorta('a las nueve y media', '09:30'),
  horaCorta('a las 4 de la tarde', '16:00'),
  horaCorta('las ocho y cuarto', '08:15'),
  horaCorta('al mediodía', '12:00'),
  horaCorta('diez y media', '10:30'),
  clienteCorto('la de Mendia'),
  clienteCorto('Mendia, la otra no'),
  clienteCorto('Ane Mendia'),
  clienteCorto('pues la Mendia'),
  // PROVEEDOR FRENTE A CLIENTE (6)
  proveedorGasto('Maderas Oria me ha pasado una factura de 240 con IVA incluido para lo de Paqui', { importe_texto: '240', iva_modo: 'incluido', obra_texto: 'Paqui' }, '240,00 €'),
  proveedorGasto('apunta lo que le debo a Maderas Oria: 150 más IVA, de lo de Paqui', { importe_texto: '150', iva_modo: 'mas', obra_texto: 'Paqui' }, '181,50 €'),
  proveedorGasto('me llegó el albarán de Maderas Oria, 100 más IVA, va a la obra de Paqui', { importe_texto: '100', iva_modo: 'mas', obra_texto: 'Paqui' }, '121,00 €'),
  proveedorCita('el jueves a las 9 me paso por Maderas Oria', { proveedor_texto: 'Maderas Oria', fecha_texto: 'el jueves', hora_texto: 'a las 9' }),
  proveedorCita('quedo con los de Maderas Oria el viernes a las 11', { proveedor_texto: 'Maderas Oria', fecha_texto: 'el viernes', hora_texto: 'a las 11' }),
  proveedorCita('el lunes temprano, a las 8, reunión en Maderas Oria', { proveedor_texto: 'Maderas Oria', fecha_texto: 'el lunes', hora_texto: 'a las 8' }),
  // VARIAS DE DISTINTO TIPO (10)
  ...PARAFRASIS_VARIAS,
  // DUDAS: ante la duda NUNCA se guarda (6)
  duda('mmm, no sé, déjame pensarlo'),
  duda('¿tú crees?'),
  duda('espera que miro el ticket'),
  duda('a ver, ¿qué proveedor era?', 'NUEVA'),
  duda('hum… ¿y eso con IVA o sin IVA?', 'NUEVA'),
  duda('no sé yo, igual mejor lo miro luego'),
];
