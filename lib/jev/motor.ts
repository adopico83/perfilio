/**
 * Motor .jev de UN turno de chat: mensaje → (traductor) → orden → (ejecutor) → pregunta / orden pendiente /
 * respuesta. Y la confirmación: «Sí, hazlo» → se carga la orden pendiente DEL SERVIDOR y se ejecuta exactamente
 * lo guardado. Sin dependencias de Next: lo usan la ruta del chat y los tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { completarOrden, etiquetaOrden, expandirOrden, type OrdenCruda, type OrdenJev } from '@/lib/jev/ordenes';
import { esRespuestaCorta, marcaOrden, ordenIdDelUltimoAsistente } from '@/lib/jev/dialogo';
import { clasificarIntencion, type EntradaIntencion, type Intencion, type SalidaIntencion } from '@/lib/jev/intencion';
import { horasEnTexto, numerosDelMensaje } from '@/lib/jev/fechas';
import { logJev } from '@/lib/jev/log';
import { comprobarCoherencia } from '@/lib/jev/coherencia';
import { normalizarCrudo } from '@/lib/jev/normalizar';
import { prepararOrden, type CtxEjecutor } from '@/lib/jev/ejecutor';
import {
  cancelarPendiente,
  cargarPendiente,
  cargarTareaEnCurso,
  cerrarTarea,
  crearPendiente,
  guardarTarea,
  marcarConfirmada,
  pendienteVivaDelUsuario,
  type EstadoTarea,
  type Tarea,
} from '@/lib/jev/pendientes';
import { modoIvaDelMensaje } from '@/lib/gastos-iva';
import { validarPlan } from '@/lib/jev/roles';
import { planInicial, siguienteDeLaCola, sinRepetidas, claveOrden } from '@/lib/jev/cola';
import { datosSinUsar } from '@/lib/jev/sin-usar';
import { traducirMensaje, type EntradaTraductor, type SalidaTraductor } from '@/lib/jev/traductor';
import { preguntaConfirmacion } from '@/lib/agente/confirmacion';
import { MENSAJE_NADA_PENDIENTE } from '@/lib/agente/orquestacion';

export type OpcionUI = { n: number; id: string; etiqueta: string };

export type SalidaMotor = {
  respuesta: string;
  /** Botones «Sí, hazlo / No»: solo el id de la orden pendiente (los args se quedan en el servidor). */
  accionPendiente?: { orden_id: string; tool: string; resumen: string };
  opciones?: OpcionUI[];
  /** Resultado de la tool (para la ficha de obra, el PDF…). */
  resultado?: Record<string, unknown>;
  /** El mensaje es charla sin acción: la ruta contesta con el modelo, sin herramientas. */
  charla?: boolean;
  /** true si se ejecutó una acción (confirmación). */
  ejecutado?: boolean;
  /** Avisos para el usuario (algo que no se ha preparado, una orden repetida que se salta…). La respuesta ya los lleva escritos; este campo es la fuente. */
  avisos?: string[];
};

export type EntradaMotor = {
  supabase: SupabaseClient;
  businessId: string;
  userId: string;
  mensaje: string;
  categoria: string;
  hoyTexto: string;
  ultimoAsistente?: string;
  ultimoPresupuestoId?: string | null;
  ultimaFacturaId?: string | null;
  /** Última cita creada o movida en la conversación («pásala al viernes»). */
  ultimoEventoId?: string | null;
  ahora?: Date;
  runTool: CtxEjecutor['runTool'];
  validar?: (accion: { tool: string; args: Record<string, unknown> }) => string | null;
  /** Fotos del diario ya subidas al almacenamiento (rutas) que acompañan al mensaje. */
  fotosAdjuntas?: string[];
  /** Para tests: traductor simulado. */
  traducir?: (e: EntradaTraductor) => Promise<SalidaTraductor>;
  /** Para tests: clasificador de intención simulado. */
  clasificar?: (e: EntradaIntencion) => Promise<SalidaIntencion>;
};

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Elige una opción de una lista: por número («2», «la 2», «la segunda») o por PALABRAS (sin artículos ni acentos, todas las palabras
 * dentro de UNA sola etiqueta: «la Zubizarreta», «Ane Lasa», «el de Hernani»). 'ninguna' si dice que ninguna; null si no encaja.
 */
export function elegirOpcion(mensaje: string, opciones: Array<{ n: number; id: string; etiqueta: string }>): { n: number; id: string; etiqueta: string } | 'ninguna' | null {
  const t = norm(mensaje).replace(/[.!¡¿?,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:ninguna?|ninguno|sin obra)$/.test(t)) return 'ninguna';
  const ordinales: Record<string, number> = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
  const m = t.match(/^(?:la |el |opcion |la opcion |numero |la numero )?(\d{1,2})$/);
  const n = m ? Number(m[1]) : ordinales[t.replace(/^(la |el )/, '')];
  if (n) return opciones.find((o) => o.n === n) ?? null;
  const vacias = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'lo', 'al', 'es', 'ese', 'esa', 'esta', 'este', 'pues', 'pa', 'para', 'con', 'y', 'que', 'sera', 'seria', 'creo', 'diria', 'digo']);
  const pals = t.split(' ').filter((w) => w && !vacias.has(w));
  if (pals.length === 0) return null;
  const coinciden = opciones.filter((o) => {
    const et = norm(o.etiqueta).split(/[^a-z0-9ñ]+/).filter(Boolean);
    return pals.every((w) => et.some((x) => x === w || (w.length >= 3 && x.startsWith(w))));
  });
  if (coinciden.length === 1) return coinciden[0]!;
  // «Mendia, la otra no»: sobran palabras de relleno, pero SOLO una opción tiene alguna de las palabras dichas.
  const relleno = new Set(['otra', 'otro', 'no', 'tampoco', 'solo', 'nada', 'sino', 'ya', 'seguro', 'justo', 'exacto']);
  const util = pals.filter((w) => !relleno.has(w));
  if (util.length === 0 || util.length === pals.length) return null;
  const alguna = opciones.filter((o) => {
    const et = norm(o.etiqueta).split(/[^a-z0-9ñ]+/).filter(Boolean);
    return util.every((w) => et.some((x) => x === w || (w.length >= 3 && x.startsWith(w))));
  });
  return alguna.length === 1 ? alguna[0]! : null;
}

/** Une la corrección con la orden anterior: solo cambian los datos que el usuario ha vuelto a decir. */
export function fusionarOrden(previa: OrdenCruda | OrdenJev, nueva: OrdenCruda | OrdenJev): OrdenCruda {
  const p = normalizarCrudo(previa);
  const n = normalizarCrudo(nueva);
  if (p.accion !== n.accion) return n as OrdenCruda;
  // normalizarCrudo ya quitó los null / "" / "N/A": lo que queda en `n` lo ha dicho el usuario.
  return { ...p, ...n } as OrdenCruda;
}

export { datosSinUsar };

const RE_NIF = /\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[A-HJNPQRSUVW]\d{7}[0-9A-J])\b/i;


/** Aviso cuando una orden de la cola se salta porque ya está hecha o ya se enseñó (nada se descarta sin decirlo). */
const avisoRepetida = (o: unknown) => `Me salto «${etiquetaOrden(o as Record<string, unknown>)}» porque ya lo tengo hecho o preparado: no lo repito.`;

/** Frase corta que cuenta qué se hace después (varias órdenes en un mensaje). */
const despues = (siguientes: OrdenCruda[]) =>
  siguientes.length ? `\n\nDespués te pregunto por: ${siguientes.map((o) => etiquetaOrden(o as Record<string, unknown>)).join('; ')}.` : '';

/** Frase del aviso cuando una orden pendiente se deja sin hacer. */
const AVISO_DESCARTADA = 'He dejado sin hacer lo que tenía pendiente. ';

/**
 * Un turno del chat. La IA ENTIENDE (clasificador de intención + traductor); este código DECIDE: solo se ejecuta lo que el
 * servidor tiene guardado como pendiente, con la intención CONFIRMA y si el último mensaje del asistente fue la pregunta
 * de ESA orden. Ante cualquier duda, no se hace nada y se vuelve a preguntar.
 */
type SalidaInterna = SalidaMotor & { _meta?: { ordenes: Array<Record<string, unknown>>; varias: boolean; avisos: string[] } };

export async function procesarMensajeJev(ent: EntradaMotor): Promise<SalidaMotor> {
  const { _meta, ...salida } = await procesarInterno(ent);
  return _meta ? guardianFinal(ent.mensaje.trim(), salida, _meta.ordenes, _meta.varias, _meta.avisos) : salida;
}

/** Escribe los avisos en la respuesta (siempre por aquí, antes de la marca de la orden) y los deja también en `avisos`. */
export function conAvisos(salida: SalidaMotor, avisos: string[]): SalidaMotor {
  const nuevos = avisos.filter((a) => a && !(salida.avisos ?? []).includes(a));
  if (!nuevos.length) return salida;
  const texto = nuevos.map((a) => `⚠️ ${a}`).join('\n');
  const respuesta = salida.respuesta.replace(/(\n?<!--orden:[\w-]+-->)?$/, `\n\n${texto}$1`);
  return { ...salida, respuesta, avisos: [...(salida.avisos ?? []), ...nuevos] };
}

/**
 * GUARDIÁN FINAL: único punto de salida de una petición traducida. Perder algo EN SILENCIO tiene que ser imposible: si el mensaje trae
 * una cifra (con su unidad) o un nombre que ninguna orden recoge, o pedía varias cosas y no se dice qué pasa con las demás, se avisa y se
 * pregunta. Los avisos van en `avisos[]` (y escritos en la respuesta). Preguntar de más no es un fallo; callar sí.
 */
export function guardianFinal(mensaje: string, salida: SalidaMotor, ordenes: Array<Record<string, unknown>>, varias: boolean, previos: string[] = []): SalidaMotor {
  const avisos = [...previos];
  const sinUsar = datosSinUsar(mensaje, ordenes);
  const yaExplicado = previos.some((a) => /proveedor tuyo/.test(a));
  if (sinUsar && !yaExplicado) {
    logJev('datos_sin_usar', { dato: sinUsar });
    avisos.push(`También me has dicho «${sinUsar}» y eso no lo he preparado. ¿Lo apunto después? Dímelo cuando acabemos con esto.`);
  } else if (ordenes.length > 1 && !yaExplicado && !/Después te pregunto|Después te preparo/.test(salida.respuesta)) {
    avisos.push(`Después te preparo: ${ordenes.slice(1).map((o) => etiquetaOrden(o)).join('; ')}.`);
  } else if (varias && ordenes.length === 1 && !yaExplicado) {
    logJev('datos_sin_usar', { dato: 'varias órdenes, solo una preparada' });
    avisos.push('Me has pedido más de una cosa y solo he preparado esta. ¿Qué más querías? Dímelo cuando acabemos con esto.');
  }
  return conAvisos(salida, avisos);
}

async function procesarInterno(ent: EntradaMotor): Promise<SalidaInterna> {
  const { supabase, businessId, userId } = ent;
  const ahora = ent.ahora ?? new Date();
  const mensaje = ent.mensaje.trim();
  const viva = await pendienteVivaDelUsuario(supabase, businessId, userId);
  const tarea = await cargarTareaEnCurso(supabase, businessId, userId);
  const pq = !viva ? tarea?.estado.pregunta ?? null : null;

  // 0) ¿Qué quiere decir el usuario? Lo decide el clasificador (no listas de frases). Sin nada pendiente ni pregunta abierta y con un
  //    mensaje largo solo puede ser una orden nueva: se ahorra la llamada.
  const palabras = mensaje.split(/\s+/).filter(Boolean).length;
  let intencion: Intencion = 'NUEVA';
  let segura = true;
  if (viva || tarea || palabras <= 8) {
    const clasificar = ent.clasificar ?? clasificarIntencion;
    const c = await clasificar({
      mensaje,
      resumenPendiente: viva?.resumen ?? null,
      preguntaAbierta: pq?.texto ?? null,
      ultimoAsistente: ent.ultimoAsistente ?? null,
    });
    intencion = c.intencion;
    segura = c.segura;
  }
  // Sin orden pendiente ni tarea en curso no hay a qué cancelar, corregir ni responder: un asentimiento (CONFIRMA) o una negativa (CANCELA) sueltos se atienden
  // aparte sin tocar nada; responder o corregir es, en realidad, una petición nueva para el traductor.
  if (!viva && !tarea && (intencion === 'RESPUESTA' || intencion === 'CORRIGE' || intencion === 'VARIAS')) intencion = 'NUEVA';
  // Con algo pendiente, una clasificación dudosa NUNCA ejecuta ni descarta: se vuelve a preguntar.
  if (viva && !segura && intencion !== 'CORRIGE') {
    logJev('si_sin_confirmacion', { motivo: 'intención dudosa con una orden pendiente', intencion });
    return {
      respuesta: `No estoy seguro de si quieres que lo haga. Tengo preparado esto:\n${viva.resumen}\n¿Lo hago o lo dejamos?${marcaOrden(viva.id)}`,
      accionPendiente: { orden_id: viva.id, tool: viva.accion.tool, resumen: viva.resumen },
    };
  }

  // 1) CANCELA: se cancela la pendiente y se cierra la tarea. No se propone NADA nuevo en este turno.
  if (intencion === 'CANCELA') {
    if (viva) await cancelarPendiente(supabase, viva.id, businessId, userId);
    if (tarea) await cerrarTarea(supabase, businessId, userId);
    return { respuesta: viva || tarea ? 'Vale, no hago nada.' : 'Vale.' };
  }

  // 2) CONFIRMA: solo ejecuta la orden pendiente real, y solo si el último mensaje del asistente fue la pregunta de ESA orden.
  if (intencion === 'CONFIRMA') {
    if (viva) {
      if (ordenIdDelUltimoAsistente(ent.ultimoAsistente) === viva.id) {
        return confirmarOrdenJev({ supabase, businessId, userId, ordenId: viva.id, runTool: ent.runTool, validar: ent.validar, ahora });
      }
      logJev('si_sin_confirmacion', { motivo: 'el último mensaje no era la confirmación de la orden pendiente' });
      return {
        respuesta: `${preguntaConfirmacion(viva.resumen)}${marcaOrden(viva.id)}`,
        accionPendiente: { orden_id: viva.id, tool: viva.accion.tool, resumen: viva.resumen },
      };
    }
    // «¿Apunto el gasto de Saltoki y también las 6 horas de Jon?» → «sí»: se prepara el plan entero (una orden por turno, cada una con su «Sí»).
    if (!viva && tarea?.estado.pregunta?.slot === 'plan') {
      return ejecutarYResponder(ent, tarea.orden, { ...tarea.estado, pregunta: null }, ahora);
    }
    // «¿Lo doy de alta o es otro nombre?» → «sí»: se da de alta y después se retoma la orden original.
    if (tarea?.estado.pregunta?.alta && tarea.estado.pregunta.slot === 'cliente' && tarea.estado.pregunta.texto_slot) {
      const estado: EstadoTarea = {
        resueltos: {},
        mensajes: [...tarea.estado.mensajes, mensaje],
        pregunta: null,
        siguientes: [tarea.orden as OrdenCruda, ...(tarea.estado.siguientes ?? [])],
      };
      return ejecutarYResponder(ent, { accion: 'CREAR_CLIENTE', nombre_texto: tarea.estado.pregunta.texto_slot } as OrdenCruda, estado, ahora);
    }
    // Nada que confirmar: un asentimiento suelto («vale») no hace nada. Pero un mensaje con contenido que solo CONTIENE un «sí»
    // («el cliente ha dicho que sí, márcalo aceptado») es una orden nueva: pasa por el traductor (que solo prepara, no guarda).
    if (!tarea && palabras > 4) intencion = 'NUEVA';
    else return { respuesta: MENSAJE_NADA_PENDIENTE };
  }

  // 3) RESPUESTA a una pregunta abierta de la tarea en curso: se rellena el hueco SIN inventar nada.
  if (!viva && tarea && pq && (intencion === 'RESPUESTA' || intencion === 'CORRIGE')) {
    const r = await responderPregunta(ent, tarea, pq, mensaje, ahora);
    if (r) return r;
  }

  // 4) Hay una orden pendiente y el usuario quiere CORREGIRLA (se fusiona con ella y se vuelve a enseñar) u otra cosa (se descarta).
  const traducir = ent.traducir ?? traducirMensaje;
  const corrige = Boolean(viva) && (intencion === 'CORRIGE' || intencion === 'RESPUESTA');
  const continuaTarea = !viva && Boolean(tarea) && (intencion === 'RESPUESTA' || intencion === 'CORRIGE');
  const previa = (corrige ? viva!.orden : continuaTarea ? tarea!.orden : null) as OrdenCruda | null;
  const salida = await traducir({
    mensaje,
    categoria: ent.categoria,
    hoyTexto: ent.hoyTexto,
    tarea: previa,
    pendiente: corrige,
    ultimoAsistente: ent.ultimoAsistente,
    dobleLectura: true,
  });
  // Dos lecturas que no coinciden (una ve dos órdenes y la otra una, o cifras distintas): no se guarda la mitad, se pregunta.
  if (salida.desacuerdo) {
    if (viva) await cancelarPendiente(supabase, viva.id, businessId, userId);
    const plan = salida.desacuerdo.ordenes.flatMap((o) => expandirOrden(normalizarCrudo(o) as OrdenCruda));
    const [p1, ...resto] = plan;
    if (p1) {
      await guardarTarea(supabase, {
        businessId,
        userId,
        orden: p1,
        estado: { resueltos: {}, mensajes: [mensaje], pregunta: { slot: 'plan', texto_slot: '', texto: salida.desacuerdo.pregunta, opciones: [] }, siguientes: resto, plan: planInicial(p1, resto) },
      });
      logJev('si_sin_confirmacion', { motivo: 'lecturas distintas: se pregunta antes de preparar' });
      return { respuesta: `${viva ? AVISO_DESCARTADA : ''}${salida.desacuerdo.pregunta}` };
    }
  }
  let cruda = normalizarCrudo(salida.orden) as OrdenCruda;
  // Una cita PENDIENTE aún no existe: «ponla el miércoles» la corrige (CITA_CREAR), no mueve ninguna cita guardada.
  if (corrige && viva && normalizarCrudo(viva.orden).accion === 'CITA_CREAR' && cruda.accion === 'CITA_MOVER') {
    const { evento_texto: _ignorado, ...resto } = cruda as Record<string, unknown>;
    void _ignorado;
    cruda = { ...resto, accion: 'CITA_CREAR' } as unknown as OrdenCruda;
  }
  // Una orden «igual» a otra del mismo mensaje (misma clave: tipo + datos, escritos como se escriban) es una copia del modelo, no otra
  // petición: nunca se prepara ni se guarda dos veces.
  const clavePrimera = claveOrden(cruda);
  const otras = sinRepetidas((salida.otras ?? []).map((o) => normalizarCrudo(o) as OrdenCruda).filter((o) => o.accion)).ordenes.filter((o) => claveOrden(o) !== clavePrimera);

  let aviso = '';
  let base: { orden: OrdenCruda | OrdenJev; estado: EstadoTarea } | null = null;
  let correccionDePendiente = false;
  let presupuestoDeLaDescartada: string | null = null;
  if (viva) {
    await cancelarPendiente(supabase, viva.id, businessId, userId);
    presupuestoDeLaDescartada = typeof viva.accion.args?.presupuesto_id === 'string' ? (viva.accion.args.presupuesto_id as string) : null;
    if (corrige && normalizarCrudo(viva.orden).accion === cruda.accion) {
      correccionDePendiente = true;
      const { [claveOrden(viva.orden)]: _vieja, ...planSinLaCorregida } = viva.accion.plan ?? {};
      void _vieja;
      base = { orden: viva.orden, estado: { resueltos: {}, mensajes: viva.accion.mensajes ?? [], pregunta: null, siguientes: viva.accion.siguientes, plan: planSinLaCorregida } };
    } else {
      aviso = AVISO_DESCARTADA;
    }
  } else if (tarea) {
    if (continuaTarea && normalizarCrudo(tarea.orden).accion === cruda.accion) {
      base = { orden: tarea.orden, estado: { resueltos: { ...tarea.estado.resueltos }, mensajes: tarea.estado.mensajes, pregunta: null, siguientes: tarea.estado.siguientes } };
    } else {
      await cerrarTarea(supabase, businessId, userId);
    }
  }

  if (cruda.accion === 'CHARLA') {
    if (viva || tarea) await cerrarTarea(supabase, businessId, userId);
    return viva ? { respuesta: 'Vale, no hago nada.' } : { respuesta: '', charla: true };
  }

  const ordenBase = base ? fusionarOrden(base.orden, cruda) : cruda;
  const plan = await validarPlan(supabase, businessId, mensaje, [ordenBase, ...otras].flatMap((o) => expandirOrden(o)));
  const todas = plan.ordenes;
  if (todas.length === 0) {
    if (viva || tarea) await cerrarTarea(supabase, businessId, userId);
    return { respuesta: `${aviso}${plan.avisos.map((a) => `⚠️ ${a}`).join('\n')}`, avisos: plan.avisos };
  }
  const [primera, ...resto] = todas;
  const siguientesTodas = [...resto, ...(base?.estado.siguientes ?? [])];
  const estado: EstadoTarea = {
    resueltos: base?.estado.resueltos ?? {},
    mensajes: [...(base?.estado.mensajes ?? []), mensaje],
    pregunta: null,
    siguientes: siguientesTodas,
    plan: planInicial(primera, siguientesTodas, base?.estado.plan),
  };
  const entFinal = presupuestoDeLaDescartada ? { ...ent, ultimoPresupuestoId: presupuestoDeLaDescartada } : ent;
  const r = await ejecutarYResponder(entFinal, primera!, estado, ahora, correccionDePendiente);

  // Corregir sin cambiar nada no vuelve a proponer la misma orden idéntica.
  if (corrige && viva && r.accionPendiente && r.accionPendiente.resumen === viva.resumen) {
    await cancelarPendiente(supabase, r.accionPendiente.orden_id, businessId, userId);
    return { respuesta: `No veo qué dato cambiar respecto a lo que tenía preparado. Dime qué quieres que cambie (o lo dejamos).` };
  }

  // El aviso de lo que no se ha preparado lo pone el guardián final (`guardianFinal`), por un único camino.
  const respuesta = `${aviso}${r.respuesta}`;
  if (r.charla || intencion === 'RESPUESTA') return { ...r, respuesta };
  return { ...r, respuesta, _meta: { ordenes: todas as Array<Record<string, unknown>>, varias: intencion === 'VARIAS' || otras.length > 0 || salida.rescate === true, avisos: plan.avisos } };
}

/** Slot de una pregunta del ejecutor → campo de la orden que rellena la respuesta. */
const SLOT_A_CAMPO: Record<string, string> = {
  cliente: 'cliente_texto',
  obra: 'obra_texto',
  presupuesto: 'presupuesto_texto',
  factura: 'factura_texto',
  albaran: 'albaran_texto',
  operario: 'operario_texto',
  evento: 'evento_texto',
  proveedor: 'proveedor_texto',
  horas: 'horas_texto',
  hora: 'hora_texto',
  fecha: 'fecha_texto',
  importe: 'importe_texto',
};

const limpiarRespuestaDeHueco = (m: string) => m.trim().replace(/^(?:pues |es |ser[ií]a |con |a |para |de |el |la |lo de |lo del )+/i, '').replace(/[.!]+$/, '').trim();

/**
 * Contesta a la pregunta abierta de la tarea: elegir una opción (por número o por palabras), o rellenar el hueco de la orden con
 * lo que dijo. Si no encaja, se REPREGUNTA (nunca va al traductor como orden nueva). null = sigue por el traductor
 * (preguntas de partidas, IVA, etc., donde la respuesta es parte de una lista).
 */
async function responderPregunta(ent: EntradaMotor, tarea: Tarea, pq: NonNullable<EstadoTarea['pregunta']>, mensaje: string, ahora: Date): Promise<SalidaMotor | null> {
  const { supabase, businessId, userId } = ent;
  const orden = tarea.orden as Record<string, unknown>;
  // Dato de la ficha del cliente que se pidió para seguir (NIF, dirección): se guarda y la orden se retoma sola.
  if (pq.retomar) {
    const r = datosDeFicha(mensaje, pq.retomar.faltan?.length ? pq.retomar.faltan : [pq.retomar.campo]);
    if (!r.nif && !r.direccion) return null;
    const ordenDato = {
      accion: 'ACTUALIZAR_CLIENTE',
      cliente_texto: pq.retomar.cliente,
      ...(r.nif ? { nif_texto: r.nif } : {}),
      ...(r.direccion ? { direccion_texto: r.direccion } : {}),
    } as OrdenCruda;
    const estado: EstadoTarea = {
      resueltos: { cliente: { id: pq.retomar.cliente_id, etiqueta: pq.retomar.cliente, texto: pq.retomar.cliente } },
      // Los mensajes de la orden original viajan con el dato: al retomarla, sus importes siguen siendo «dichos».
      mensajes: [...tarea.estado.mensajes, mensaje],
      pregunta: null,
      siguientes: [tarea.orden as OrdenCruda, ...(tarea.estado.siguientes ?? [])],
    };
    return ejecutarYResponder(ent, ordenDato, estado, ahora);
  }
  if (pq.opciones.length) {
    const op = elegirOpcion(mensaje, pq.opciones);
    if (op === 'ninguna' && pq.slot === 'obra') {
      const o = { ...orden, obra_texto: undefined, sin_obra: 'si' } as unknown as OrdenCruda;
      return ejecutarYResponder(ent, o, { ...tarea.estado, resueltos: { ...tarea.estado.resueltos }, mensajes: [...tarea.estado.mensajes, mensaje], pregunta: null }, ahora);
    }
    if (op && op !== 'ninguna') {
      const estado: EstadoTarea = {
        ...tarea.estado,
        resueltos: { ...tarea.estado.resueltos, [pq.slot]: { id: op.id, etiqueta: op.etiqueta.replace(/\s*\(.*$/, ''), texto: pq.texto_slot } },
        mensajes: [...tarea.estado.mensajes, mensaje],
        pregunta: null,
      };
      return ejecutarYResponder(ent, tarea.orden, estado, ahora);
    }
    // No encaja con ninguna opción: se repregunta con la misma lista. Nada se interpreta como orden nueva.
    const lista = pq.opciones.map((o) => `${o.n}. ${o.etiqueta}`).join('\n');
    return { respuesta: `No sé cuál de estas es «${mensaje.slice(0, 60)}». Dime el número o parte del nombre:\n${lista}`, opciones: pq.opciones };
  }
  // Un hueco de la orden («horas_texto», «hora_texto», «fecha_texto»…) se rellena con la respuesta corta: «6 y media», «4», «a las 7 y media».
  const campo = SLOT_A_CAMPO[pq.slot] ?? (/_texto$|^texto$/.test(pq.slot) ? pq.slot : undefined);
  if (campo && (pq.texto_slot || pq.slot !== 'dato')) {
    const resueltos = { ...tarea.estado.resueltos };
    delete resueltos[pq.slot];
    const nueva = { ...orden, [campo]: limpiarRespuestaDeHueco(mensaje) } as OrdenCruda;
    return ejecutarYResponder(ent, nueva, { ...tarea.estado, resueltos, mensajes: [...tarea.estado.mensajes, mensaje], pregunta: null }, ahora);
  }
  // IVA y demás: la respuesta se suma a los mensajes de la tarea y se vuelve a preparar la misma orden.
  if (pq.slot === 'iva') {
    // «Súmale el IVA encima», «lo que has dicho, entero»: si no es una forma de IVA que el parser de datos reconoce, lo entiende el traductor.
    if (modoIvaDelMensaje(mensaje) == null && !/\bexent[oa]s?\b/i.test(mensaje)) return null;
    return ejecutarYResponder(ent, tarea.orden, { ...tarea.estado, mensajes: [...tarea.estado.mensajes, mensaje], pregunta: null }, ahora);
  }
  return null;
}

/** NIF y dirección que trae una respuesta («44556677-L», «su NIF es … y vive en …»). Parsers de DATOS, no de frases. */
export function datosDeFicha(mensaje: string, faltan: Array<'nif' | 'direccion'>): { nif?: string; direccion?: string } {
  const out: { nif?: string; direccion?: string } = {};
  const compacto = mensaje.replace(/(\d{7,8})[\s.-]+([A-Za-z])\b/g, '$1$2');
  const nif = faltan.includes('nif') ? compacto.match(RE_NIF)?.[0] : undefined;
  if (nif) out.nif = nif.toUpperCase();
  if (faltan.includes('direccion')) {
    const resto = compacto
      .replace(RE_NIF, ' ')
      .replace(/\b(?:su|el|la|mi)?\s*(?:nif|cif|dni)\b\s*(?:es|:)?/gi, ' ')
      .replace(/^[\s,.;:y]+/i, '')
      .replace(/^(?:y\s+)?(?:vive(?:n)?\s+en|est[aá]\s+en|su\s+direcci[oó]n\s+es|la\s+direcci[oó]n\s+es|direcci[oó]n\s*(?:es|:)?|en)\b[\s,:]*/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[.]+$/, '')
      .trim();
    if (resto.length >= 5 && esRespuestaCorta(resto, 16)) out.direccion = resto;
  }
  return out;
}

/** Prepara UNA orden: pendiente de confirmación, pregunta, error o respuesta. Las órdenes que quedan por detrás se conservan. */
async function ejecutarYResponder(ent: EntradaMotor, cruda: OrdenCruda | OrdenJev, estado: EstadoTarea, ahora: Date, esCorreccion = false): Promise<SalidaMotor> {
  const { supabase, businessId, userId } = ent;
  const siguientes = estado.siguientes ?? [];
  // Puerta única de validación: orden completa → se ejecuta; faltan datos → se guarda lo bueno y se pregunta solo lo que falta.
  const c = completarOrden(cruda);
  if (c.estado === 'aclarar') {
    await cerrarTarea(supabase, businessId, userId);
    return { respuesta: c.pregunta };
  }
  if (c.estado === 'faltan') {
    await guardarTarea(supabase, {
      businessId,
      userId,
      orden: c.cruda,
      estado: { ...estado, pregunta: { slot: c.faltantes[0]!, texto_slot: '', texto: c.pregunta, opciones: [] } },
    });
    return { respuesta: c.pregunta };
  }
  const orden = c.orden;
  if (orden.accion === 'CHARLA') return { respuesta: '', charla: true };
  if (orden.accion === 'ACLARAR') return { respuesta: orden.pregunta };

  const r = await prepararOrden(orden, {
    supabase,
    businessId,
    userId,
    ahora,
    mensajes: estado.mensajes,
    resueltos: estado.resueltos,
    ultimoPresupuestoId: ent.ultimoPresupuestoId ?? null,
    ultimaFacturaId: ent.ultimaFacturaId ?? null,
    ultimoEventoId: ent.ultimoEventoId ?? null,
    esCorreccion,
    fotosAdjuntas: ent.fotosAdjuntas,
    runTool: ent.runTool,
  });

  if (r.tipo === 'pendiente') {
    // Lo que se va a escribir tiene que ser lo que se enseña: si no coincide, no se propone.
    const incoherente = comprobarCoherencia(r.accion.tool, r.accion.args, r.resumen);
    if (incoherente) {
      logJev('incoherencia', { tool: r.accion.tool, motivo: incoherente });
      return { respuesta: `No preparo la acción: ${incoherente} No he guardado nada.` };
    }
    const p = await crearPendiente(supabase, { businessId, userId, orden, accion: { ...r.accion, mensajes: estado.mensajes, ...(siguientes.length ? { siguientes } : {}), plan: planInicial(orden, siguientes, estado.plan) }, resumen: r.resumen });
    if (!p.ok) return { respuesta: `No he podido preparar la acción: ${p.error}` };
    await cerrarTarea(supabase, businessId, userId);
    return {
      respuesta: `${preguntaConfirmacion(r.resumen)}${despues(siguientes)}${marcaOrden(p.id)}`,
      accionPendiente: { orden_id: p.id, tool: r.accion.tool, resumen: r.resumen },
    };
  }
  if (r.tipo === 'pregunta') {
    const opciones: OpcionUI[] = r.opciones.slice(0, 8).map((o, i) => ({ n: i + 1, id: o.id, etiqueta: o.etiqueta }));
    await guardarTarea(supabase, {
      businessId,
      userId,
      orden,
      estado: {
        ...estado,
        pregunta: { slot: r.slot, texto_slot: r.textoSlot, texto: r.texto, opciones, ...(r.alta ? { alta: true } : {}), ...(r.retomar ? { retomar: r.retomar } : {}) },
      },
    });
    return { respuesta: `${r.texto}${despues(siguientes)}`, ...(opciones.length ? { opciones } : {}) };
  }
  if (r.tipo === 'error') {
    // La tarea sigue viva: «no, con Iker PRUEBA» corrige solo lo que falla.
    await guardarTarea(supabase, { businessId, userId, orden, estado: { ...estado, pregunta: null } });
    return { respuesta: r.texto };
  }
  await cerrarTarea(supabase, businessId, userId);
  const salida: SalidaMotor = { respuesta: r.texto, ...(r.extra ? { resultado: r.extra } : {}) };
  // Era una consulta y quedaban más órdenes en la misma frase: se sigue con la siguiente.
  const plan = { ...(estado.plan ?? {}), [claveOrden(orden)]: 'hecha' as const };
  const cola = siguienteDeLaCola(siguientes, plan);
  if (cola.sig) {
    const s2 = await ejecutarYResponder(ent, cola.sig, { resueltos: {}, mensajes: estado.mensajes, pregunta: null, siguientes: cola.resto, plan }, ahora);
    return conAvisos({ ...s2, respuesta: `${salida.respuesta}\n\n${s2.respuesta}`, resultado: salida.resultado ?? s2.resultado }, cola.saltadas.map((o) => avisoRepetida(o)));
  }
  return conAvisos(salida, cola.saltadas.map((o) => avisoRepetida(o)));
}

/** «Sí, hazlo»: el servidor carga la orden pendiente y ejecuta EXACTAMENTE lo guardado (y mostrado). */
export async function confirmarOrdenJev(p: {
  supabase: SupabaseClient;
  businessId: string;
  userId: string;
  ordenId: string;
  runTool: CtxEjecutor['runTool'];
  /** Última comprobación (guardarraíles) sobre la acción guardada; devuelve el motivo si no debe ejecutarse. */
  validar?: (accion: { tool: string; args: Record<string, unknown> }) => string | null;
  ahora?: Date;
}): Promise<SalidaMotor> {
  const c = await cargarPendiente(p.supabase, p.ordenId, p.businessId, p.userId);
  if (!c.ok) {
    return {
      respuesta:
        c.motivo === 'caducada'
          ? 'Esa propuesta ha caducado. Dime otra vez qué quieres hacer y la preparo de nuevo.'
          : c.motivo === 'usada'
            ? 'Esa propuesta ya se ha usado o se ha cancelado. No hago nada.'
            : 'No encuentro esa propuesta. No hago nada.',
    };
  }
  // Una orden de la cola solo se confirma si ya se ENSEÑÓ (y una ya hecha no se repite).
  const estadoCola = c.pendiente.accion.plan?.[claveOrden(c.pendiente.orden)];
  if (estadoCola && estadoCola !== 'enseñada') {
    logJev('si_sin_confirmacion', { motivo: `orden en estado ${estadoCola}` });
    return { respuesta: 'Esa orden todavía no te la he enseñado (o ya está hecha). No hago nada.' };
  }
  const motivo = p.validar?.(c.pendiente.accion) ?? null;
  if (motivo) return { respuesta: motivo };
  // Última barrera: lo guardado en el servidor tiene que seguir diciendo lo mismo que el resumen que se enseñó.
  const esLegacy = (c.pendiente.orden as { accion?: unknown } | null)?.accion === 'LEGACY'; // propuestas del camino antiguo: su resumen tiene otro formato
  const incoherente = esLegacy ? null : comprobarCoherencia(c.pendiente.accion.tool, c.pendiente.accion.args, c.pendiente.resumen);
  if (incoherente) {
    logJev('incoherencia', { tool: c.pendiente.accion.tool, motivo: incoherente, momento: 'confirmar' });
    return { respuesta: `No lo ejecuto: ${incoherente} No he guardado nada.` };
  }
  // Atómico: solo una confirmación puede ganar (doble clic, dos pestañas).
  const ganada = await marcarConfirmada(p.supabase, c.pendiente.id, p.businessId, p.userId);
  if (!ganada) return { respuesta: 'Esa propuesta ya se ha usado. No hago nada.' };

  let resultado: unknown;
  try {
    resultado = await p.runTool(c.pendiente.accion.tool, c.pendiente.accion.args);
  } catch (e) {
    return { respuesta: `No se ha podido hacer: ${e instanceof Error ? e.message : 'error inesperado'}.`, ejecutado: false };
  }
  const o = (resultado && typeof resultado === 'object' ? resultado : {}) as Record<string, unknown>;
  const fallo = typeof o.error === 'string' || o.ok === false;
  const texto =
    typeof o.mensaje === 'string' && o.mensaje.trim()
      ? o.mensaje
      : fallo
        ? `No se ha podido hacer: ${String(o.error ?? 'error')}`
        : `Hecho. ${c.pendiente.resumen.replace(/^Voy a /, '')}`;
  const respuesta = fallo && typeof o.error === 'string' && typeof o.mensaje !== 'string' ? `No se ha podido hacer: ${o.error}` : texto;
  // La cita creada o movida se recuerda en la conversación («pásala al viernes» = esa cita).
  const tocoCita = c.pendiente.accion.tool === 'crear_recordatorio' || c.pendiente.accion.tool === 'modificar_evento_agenda';
  const eventoId = tocoCita ? (typeof o.id === 'string' ? o.id : typeof c.pendiente.accion.args.evento_id === 'string' ? (c.pendiente.accion.args.evento_id as string) : '') : '';
  const salida: SalidaMotor = { respuesta, resultado: eventoId && !fallo ? { ...o, evento_id: eventoId } : o, ejecutado: !fallo };

  // Lo que se pidió en la misma frase (otra persona en horas, retomar la factura tras guardar el NIF…): se prepara ahora.
  // La cola sabe qué está hecho y qué ya se enseñó: una orden repetida NO se vuelve a preparar ni a guardar.
  const siguientes = c.pendiente.accion.siguientes ?? [];
  const plan = { ...(c.pendiente.accion.plan ?? {}), [claveOrden(c.pendiente.orden)]: fallo ? ('en_cola' as const) : ('hecha' as const) };
  if (!fallo && siguientes.length) {
    const cola = siguienteDeLaCola(siguientes, plan);
    const avisosCola = cola.saltadas.map((o) => avisoRepetida(o));
    if (!cola.sig) return conAvisos(salida, avisosCola);
    const ent = {
      supabase: p.supabase,
      businessId: p.businessId,
      userId: p.userId,
      mensaje: '',
      categoria: 'general',
      hoyTexto: '',
      runTool: p.runTool,
    } satisfies EntradaMotor;
    const s2 = await ejecutarYResponder(ent, cola.sig, { resueltos: {}, mensajes: c.pendiente.accion.mensajes ?? [], pregunta: null, siguientes: cola.resto, plan }, p.ahora ?? new Date());
    return conAvisos({ ...salida, respuesta: `${salida.respuesta}\n\n---\nSiguiente: ${s2.respuesta}`, accionPendiente: s2.accionPendiente, opciones: s2.opciones }, avisosCola);
  }
  if (fallo && siguientes.length) {
    salida.respuesta += `\n\nComo esto no se ha hecho, no sigo con lo demás (${siguientes.map((x) => etiquetaOrden(x as Record<string, unknown>)).join('; ')}). Dímelo otra vez cuando quieras.`;
  }
  return salida;
}

export async function cancelarOrdenJev(p: { supabase: SupabaseClient; businessId: string; userId: string; ordenId: string }): Promise<SalidaMotor> {
  await cancelarPendiente(p.supabase, p.ordenId, p.businessId, p.userId);
  return { respuesta: 'Vale, no hago nada.' };
}

export type { Tarea };
