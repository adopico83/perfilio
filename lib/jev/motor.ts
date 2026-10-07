/**
 * Motor .jev de UN turno de chat: mensaje → (traductor) → orden → (ejecutor) → pregunta / orden pendiente /
 * respuesta. Y la confirmación: «Sí, hazlo» → se carga la orden pendiente DEL SERVIDOR y se ejecuta exactamente
 * lo guardado. Sin dependencias de Next: lo usan la ruta del chat y los tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrdenJev } from '@/lib/jev/ordenes';
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
import { traducirMensaje, type EntradaTraductor, type SalidaTraductor } from '@/lib/jev/traductor';
import { preguntaConfirmacion } from '@/lib/agente/confirmacion';
import { esAfirmacionSuelta, MENSAJE_NADA_PENDIENTE } from '@/lib/agente/orquestacion';

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
  ahora?: Date;
  runTool: CtxEjecutor['runTool'];
  validar?: (accion: { tool: string; args: Record<string, unknown> }) => string | null;
  /** Fotos del diario ya subidas al almacenamiento (rutas) que acompañan al mensaje. */
  fotosAdjuntas?: string[];
  /** Para tests: traductor simulado. */
  traducir?: (e: EntradaTraductor) => Promise<SalidaTraductor>;
};

const RE_NEGACION = /^\s*(?:no|nop|cancela(?:r|lo|la)?|d[eé]jalo|olv[ií]dalo|mejor no|anula(?:r|lo|la)?)[\s.!]*$/i;
export const esNegacionSuelta = (m: string) => RE_NEGACION.test(String(m ?? ''));

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** «2», «la 2», «la segunda», o el texto de una etiqueta → la opción elegida (con ids que salieron del resolvedor). */
export function elegirOpcion(mensaje: string, opciones: Array<{ n: number; id: string; etiqueta: string }>): { n: number; id: string; etiqueta: string } | null {
  const t = norm(mensaje).replace(/[.!¡¿?]/g, '').trim();
  const ordinales: Record<string, number> = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
  const m = t.match(/^(?:la |el |opcion |la opcion |numero )?(\d{1,2})$/);
  const n = m ? Number(m[1]) : ordinales[t.replace(/^(la |el )/, '')];
  if (n) return opciones.find((o) => o.n === n) ?? null;
  const porTexto = opciones.filter((o) => t.length >= 3 && norm(o.etiqueta).includes(t));
  return porTexto.length === 1 ? porTexto[0]! : null;
}

/** Une la corrección con la orden anterior: solo cambian los datos que el usuario ha vuelto a decir. */
export function fusionarOrden(previa: OrdenJev, nueva: OrdenJev): OrdenJev {
  if (previa.accion !== nueva.accion) return nueva;
  const out: Record<string, unknown> = { ...(previa as Record<string, unknown>) };
  for (const [k, v] of Object.entries(nueva as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as OrdenJev;
}

export async function procesarMensajeJev(ent: EntradaMotor): Promise<SalidaMotor> {
  const { supabase, businessId, userId } = ent;
  const ahora = ent.ahora ?? new Date();
  const mensaje = ent.mensaje.trim();

  // 1) Un «sí» / «no» escrito: solo actúa sobre la orden pendiente REAL del servidor.
  if (esAfirmacionSuelta(mensaje)) {
    const viva = await pendienteVivaDelUsuario(supabase, businessId, userId);
    if (viva) return confirmarOrdenJev({ supabase, businessId, userId, ordenId: viva.id, runTool: ent.runTool, validar: ent.validar });
  } else if (esNegacionSuelta(mensaje)) {
    const viva = await pendienteVivaDelUsuario(supabase, businessId, userId);
    if (viva) {
      await cancelarPendiente(supabase, viva.id, businessId, userId);
      return { respuesta: 'Vale, no hago nada.' };
    }
  }

  const tarea = await cargarTareaEnCurso(supabase, businessId, userId);

  // 2) Contesta a una pregunta con opciones («la 2»): se rellena el hueco SIN modelo y con el id del resolvedor.
  if (tarea?.estado.pregunta?.opciones.length) {
    const op = elegirOpcion(mensaje, tarea.estado.pregunta.opciones);
    if (op) {
      const estado: EstadoTarea = {
        ...tarea.estado,
        resueltos: { ...tarea.estado.resueltos, [tarea.estado.pregunta.slot]: { id: op.id, etiqueta: op.etiqueta.replace(/\s*\(.*$/, ''), texto: tarea.estado.pregunta.texto_slot } },
        mensajes: [...tarea.estado.mensajes, mensaje],
        pregunta: null,
      };
      return ejecutarYResponder(ent, tarea.orden, estado, ahora);
    }
  }

  // 3) Traducir el mensaje a una orden cerrada.
  if (esAfirmacionSuelta(mensaje) && !tarea) {
    // Un «sí» sin orden pendiente ni tarea: no se hace nada (a no ser que conteste a una pregunta del asistente).
    const pregunto = /\?\s*$/.test(String(ent.ultimoAsistente ?? '').replace(/<!--[\s\S]*?-->/g, '').trim());
    if (!pregunto) return { respuesta: MENSAJE_NADA_PENDIENTE };
  }
  const traducir = ent.traducir ?? traducirMensaje;
  const salida = await traducir({
    mensaje,
    categoria: ent.categoria,
    hoyTexto: ent.hoyTexto,
    tarea: tarea?.orden ?? null,
    ultimoAsistente: ent.ultimoAsistente,
  });
  const orden = salida.orden;
  if (orden.accion === 'CHARLA') return { respuesta: '', charla: true };
  if (orden.accion === 'ACLARAR') return { respuesta: orden.pregunta };

  const continua = Boolean(tarea) && salida.continuaTarea && tarea!.orden.accion === orden.accion;
  const ordenFinal = continua ? fusionarOrden(tarea!.orden, orden) : orden;
  const estado: EstadoTarea = continua
    ? { resueltos: { ...tarea!.estado.resueltos }, mensajes: [...tarea!.estado.mensajes, mensaje], pregunta: null }
    : { resueltos: {}, mensajes: [mensaje], pregunta: null };
  return ejecutarYResponder(ent, ordenFinal, estado, ahora);
}

async function ejecutarYResponder(ent: EntradaMotor, orden: OrdenJev, estado: EstadoTarea, ahora: Date): Promise<SalidaMotor> {
  const { supabase, businessId, userId } = ent;
  const r = await prepararOrden(orden, {
    supabase,
    businessId,
    userId,
    ahora,
    mensajes: estado.mensajes,
    resueltos: estado.resueltos,
    ultimoPresupuestoId: ent.ultimoPresupuestoId ?? null,
    ultimaFacturaId: ent.ultimaFacturaId ?? null,
    fotosAdjuntas: ent.fotosAdjuntas,
    runTool: ent.runTool,
  });

  if (r.tipo === 'pendiente') {
    const p = await crearPendiente(supabase, { businessId, userId, orden, accion: r.accion, resumen: r.resumen });
    if (!p.ok) return { respuesta: `No he podido preparar la acción: ${p.error}` };
    await cerrarTarea(supabase, businessId, userId);
    return {
      respuesta: preguntaConfirmacion(r.resumen),
      accionPendiente: { orden_id: p.id, tool: r.accion.tool, resumen: r.resumen },
    };
  }
  if (r.tipo === 'pregunta') {
    const opciones: OpcionUI[] = r.opciones.slice(0, 8).map((o, i) => ({ n: i + 1, id: o.id, etiqueta: o.etiqueta }));
    await guardarTarea(supabase, {
      businessId,
      userId,
      orden,
      estado: { ...estado, pregunta: { slot: r.slot, texto_slot: r.textoSlot, texto: r.texto, opciones } },
    });
    return { respuesta: r.texto, ...(opciones.length ? { opciones } : {}) };
  }
  if (r.tipo === 'error') {
    // La tarea sigue viva: «no, con Iker PRUEBA» corrige solo lo que falla.
    await guardarTarea(supabase, { businessId, userId, orden, estado: { ...estado, pregunta: null } });
    return { respuesta: r.texto };
  }
  await cerrarTarea(supabase, businessId, userId);
  return { respuesta: r.texto, ...(r.extra ? { resultado: r.extra } : {}) };
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
  const motivo = p.validar?.(c.pendiente.accion) ?? null;
  if (motivo) return { respuesta: motivo };
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
  return { respuesta: fallo && typeof o.error === 'string' && typeof o.mensaje !== 'string' ? `No se ha podido hacer: ${o.error}` : texto, resultado: o, ejecutado: !fallo };
}

export async function cancelarOrdenJev(p: { supabase: SupabaseClient; businessId: string; userId: string; ordenId: string }): Promise<SalidaMotor> {
  await cancelarPendiente(p.supabase, p.ordenId, p.businessId, p.userId);
  return { respuesta: 'Vale, no hago nada.' };
}

export type { Tarea };
