/**
 * Motor .jev de UN turno de chat: mensaje → (traductor) → orden → (ejecutor) → pregunta / orden pendiente /
 * respuesta. Y la confirmación: «Sí, hazlo» → se carga la orden pendiente DEL SERVIDOR y se ejecuta exactamente
 * lo guardado. Sin dependencias de Next: lo usan la ruta del chat y los tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { completarOrden, etiquetaOrden, expandirOrden, type OrdenCruda, type OrdenJev } from '@/lib/jev/ordenes';
import { esRechazo, esRespuestaCorta, marcaOrden, ordenIdDelUltimoAsistente } from '@/lib/jev/dialogo';
import { logJev } from '@/lib/jev/log';
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
  /** Última cita creada o movida en la conversación («pásala al viernes»). */
  ultimoEventoId?: string | null;
  ahora?: Date;
  runTool: CtxEjecutor['runTool'];
  validar?: (accion: { tool: string; args: Record<string, unknown> }) => string | null;
  /** Fotos del diario ya subidas al almacenamiento (rutas) que acompañan al mensaje. */
  fotosAdjuntas?: string[];
  /** Para tests: traductor simulado. */
  traducir?: (e: EntradaTraductor) => Promise<SalidaTraductor>;
};

/** Compatibilidad: «no» suelto. Las reglas completas están en `esRechazo` (lib/jev/dialogo.ts). */
export const esNegacionSuelta = (m: string) => esRechazo(m);

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
export function fusionarOrden(previa: OrdenCruda | OrdenJev, nueva: OrdenCruda | OrdenJev): OrdenCruda {
  const p = normalizarCrudo(previa);
  const n = normalizarCrudo(nueva);
  if (p.accion !== n.accion) return n as OrdenCruda;
  // normalizarCrudo ya quitó los null / "" / "N/A": lo que queda en `n` lo ha dicho el usuario.
  return { ...p, ...n } as OrdenCruda;
}

/** Qué campo de la orden rellena la respuesta a una pregunta del resolvedor («¿Lo doy de alta o es otro nombre?»). */
const SLOT_A_CAMPO: Record<string, string> = {
  cliente: 'cliente_texto',
  obra: 'obra_texto',
  presupuesto: 'presupuesto_texto',
  factura: 'factura_texto',
  albaran: 'albaran_texto',
  operario: 'operario_texto',
  evento: 'evento_texto',
  proveedor: 'proveedor_texto',
};

const RE_NIF = /\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[A-HJNPQRSUVW]\d{7}[0-9A-J])\b/i;

const limpiarRespuestaDeHueco = (m: string) => m.trim().replace(/^(?:pues |es |ser[ií]a |con |a |para |de |el |la |lo de |lo del )+/i, '').replace(/[.!]+$/, '').trim();

/** Frase corta que cuenta qué se hace después (varias órdenes en un mensaje). */
const despues = (siguientes: OrdenCruda[]) =>
  siguientes.length ? `\n\nDespués te pregunto por: ${siguientes.map((o) => etiquetaOrden(o as Record<string, unknown>)).join('; ')}.` : '';

export async function procesarMensajeJev(ent: EntradaMotor): Promise<SalidaMotor> {
  const { supabase, businessId, userId } = ent;
  const ahora = ent.ahora ?? new Date();
  const mensaje = ent.mensaje.trim();
  const viva = await pendienteVivaDelUsuario(supabase, businessId, userId);
  const tarea = await cargarTareaEnCurso(supabase, businessId, userId);

  // 1) «no», «mejor no», «no, ese ya lo apunté yo», «déjalo», «olvídalo», «cancela»: se cancela la pendiente y se cierra la
  //    tarea en curso. Nunca confirma ni va al modelo como orden nueva (así «cancela» suelto no puede acabar en CITA_BORRAR).
  if (esRechazo(mensaje)) {
    if (viva) await cancelarPendiente(supabase, viva.id, businessId, userId);
    if (tarea) await cerrarTarea(supabase, businessId, userId);
    return { respuesta: viva || tarea ? 'Vale, no hago nada.' : 'Vale.' };
  }

  // 2) Un «sí» escrito: solo confirma si el último mensaje del asistente fue la pregunta de confirmación de ESA orden.
  if (esAfirmacionSuelta(mensaje)) {
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
    // El último mensaje era la confirmación de una orden que ya no está viva (cancelada, usada o caducada): no se hace nada.
    if (!tarea && ordenIdDelUltimoAsistente(ent.ultimoAsistente)) return { respuesta: MENSAJE_NADA_PENDIENTE };
    if (!tarea) {
      const pregunto = /\?\s*$/.test(String(ent.ultimoAsistente ?? '').replace(/<!--[\s\S]*?-->/g, '').trim());
      if (!pregunto) return { respuesta: MENSAJE_NADA_PENDIENTE };
    }
  }

  // 3) Contesta a una pregunta con opciones («la 2»): se rellena el hueco SIN modelo y con el id del resolvedor.
  if (!viva && tarea?.estado.pregunta?.opciones.length) {
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
    // «ninguna» / «sin obra» ante una lista de obras: se sigue sin ese dato (solo en los campos que son opcionales).
    if (/^(?:ninguna?|sin obra|ninguna de (?:ellas|esas)|no es ninguna)[\s.!]*$/i.test(mensaje) && tarea.estado.pregunta.slot === 'obra') {
      const orden = { ...(tarea.orden as Record<string, unknown>), obra_texto: undefined, sin_obra: 'si' } as unknown as OrdenCruda;
      return ejecutarYResponder(ent, orden, { ...tarea.estado, resueltos: { ...tarea.estado.resueltos }, mensajes: [...tarea.estado.mensajes, mensaje], pregunta: null }, ahora);
    }
  }

  // 4) Llega el dato que se pidió para seguir (NIF / dirección del cliente): se guarda en su ficha y la orden se retoma sola.
  const retomar = !viva ? tarea?.estado.pregunta?.retomar : undefined;
  if (tarea && retomar) {
    const faltan = retomar.faltan?.length ? retomar.faltan : [retomar.campo];
    const nif = faltan.includes('nif') ? mensaje.match(RE_NIF)?.[0] : undefined;
    // Lo que queda del mensaje, quitado el NIF y las muletillas («su NIF es … y vive en …»), es la dirección.
    let direccion: string | undefined;
    if (faltan.includes('direccion')) {
      const resto = mensaje
        .replace(RE_NIF, ' ')
        .replace(/\b(?:su|el|la|mi)?\s*(?:nif|cif|dni)\b\s*(?:es|:)?/gi, ' ')
        .replace(/^[\s,.;:y]+/i, '')
        .replace(/^(?:y\s+)?(?:vive(?:n)?\s+en|est[aá]\s+en|su\s+direcci[oó]n\s+es|la\s+direcci[oó]n\s+es|direcci[oó]n\s*(?:es|:)?|en|calle)\b[\s,:]*/i, (m0) => (/^calle/i.test(m0.trim()) ? 'Calle ' : ''))
        .replace(/\s+/g, ' ')
        .replace(/[.]+$/, '')
        .trim();
      if (resto.length >= 5 && esRespuestaCorta(resto, 16)) direccion = resto;
    }
    if (nif || direccion) {
      const ordenDato = {
        accion: 'ACTUALIZAR_CLIENTE',
        cliente_texto: retomar.cliente,
        ...(nif ? { nif_texto: nif.toUpperCase() } : {}),
        ...(direccion ? { direccion_texto: direccion } : {}),
      } as OrdenCruda;
      const estado: EstadoTarea = {
        resueltos: { cliente: { id: retomar.cliente_id, etiqueta: retomar.cliente, texto: retomar.cliente } },
        // Los mensajes de la orden original viajan con el dato: al retomarla, sus importes siguen siendo «dichos».
        mensajes: [...tarea.estado.mensajes, mensaje],
        pregunta: null,
        siguientes: [tarea.orden as OrdenCruda, ...(tarea.estado.siguientes ?? [])],
      };
      return ejecutarYResponder(ent, ordenDato, estado, ahora);
    }
  }

  // 5) Respuesta corta a «¿Lo doy de alta o es otro nombre?»: es el nombre que sí existe → se rellena el hueco de la
  //    orden original (no se pierde nada de lo que ya estaba dicho).
  const pq = !viva ? tarea?.estado.pregunta : null;
  if (tarea && pq && !pq.opciones.length && pq.texto_slot && SLOT_A_CAMPO[pq.slot] && esRespuestaCorta(mensaje, 6) && !esAfirmacionSuelta(mensaje)) {
    const campo = SLOT_A_CAMPO[pq.slot]!;
    const resueltos = { ...tarea.estado.resueltos };
    delete resueltos[pq.slot];
    const orden = { ...(tarea.orden as Record<string, unknown>), [campo]: limpiarRespuestaDeHueco(mensaje) } as OrdenCruda;
    return ejecutarYResponder(ent, orden, { ...tarea.estado, resueltos, mensajes: [...tarea.estado.mensajes, mensaje], pregunta: null }, ahora);
  }

  // 6) Traducir el mensaje a una orden cerrada (si hay algo pendiente, el modelo la ve como «la orden anterior»).
  const traducir = ent.traducir ?? traducirMensaje;
  const previa = (viva?.orden ?? tarea?.orden ?? null) as OrdenCruda | null;
  const salida = await traducir({
    mensaje,
    categoria: ent.categoria,
    hoyTexto: ent.hoyTexto,
    tarea: previa,
    pendiente: Boolean(viva),
    ultimoAsistente: ent.ultimoAsistente,
  });
  const cruda = normalizarCrudo(salida.orden) as OrdenCruda;
  const otras = (salida.otras ?? []).map((o) => normalizarCrudo(o) as OrdenCruda).filter((o) => o.accion);

  // Hay una orden pendiente y el usuario no dijo «sí»: o corrige ESA orden (se fusiona y se vuelve a enseñar el resumen) o
  // pide otra cosa (la pendiente se descarta, y se le dice). Nunca queda viva una propuesta que no ha vuelto a mirar.
  let aviso = '';
  let base: { orden: OrdenCruda | OrdenJev; estado: EstadoTarea } | null = null;
  let correccionDePendiente = false;
  if (viva) {
    await cancelarPendiente(supabase, viva.id, businessId, userId);
    const misma = normalizarCrudo(viva.orden).accion === cruda.accion;
    if (misma && salida.continuaTarea) {
      correccionDePendiente = true;
      base = { orden: viva.orden, estado: { resueltos: {}, mensajes: viva.accion.mensajes ?? [], pregunta: null, siguientes: viva.accion.siguientes } };
    } else {
      aviso = 'He dejado sin hacer lo que tenía pendiente. ';
    }
  } else if (tarea) {
    // Si acabamos de preguntar por un dato que faltaba (texto_slot vacío), la respuesta continúa esa tarea aunque el modelo
    // no lo marque. Una orden NUEVA y larga no hereda huecos de la tarea anterior.
    const preguntabaFalta = tarea.estado.pregunta != null && tarea.estado.pregunta.texto_slot === '' && tarea.estado.pregunta.opciones.length === 0;
    const misma = normalizarCrudo(tarea.orden).accion === cruda.accion;
    if (misma && (salida.continuaTarea || preguntabaFalta) && esRespuestaCorta(mensaje, 12)) {
      base = { orden: tarea.orden, estado: { resueltos: { ...tarea.estado.resueltos }, mensajes: tarea.estado.mensajes, pregunta: null, siguientes: tarea.estado.siguientes } };
    }
  }

  if (cruda.accion === 'CHARLA') {
    if (viva || tarea) await cerrarTarea(supabase, businessId, userId);
    return viva ? { respuesta: 'Vale, no hago nada.' } : { respuesta: '', charla: true };
  }

  const ordenBase = base ? fusionarOrden(base.orden, cruda) : cruda;
  const todas = [ordenBase, ...otras].flatMap((o) => expandirOrden(o));
  const [primera, ...resto] = todas;
  const estado: EstadoTarea = {
    resueltos: base?.estado.resueltos ?? {},
    mensajes: [...(base?.estado.mensajes ?? []), mensaje],
    pregunta: null,
    siguientes: [...resto, ...(base?.estado.siguientes ?? [])],
  };
  const r = await ejecutarYResponder(ent, primera!, estado, ahora, correccionDePendiente);
  return aviso && !r.charla ? { ...r, respuesta: `${aviso}${r.respuesta}` } : r;
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
    const p = await crearPendiente(supabase, { businessId, userId, orden, accion: { ...r.accion, mensajes: estado.mensajes, ...(siguientes.length ? { siguientes } : {}) }, resumen: r.resumen });
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
  if (siguientes.length) {
    const [sig, ...resto] = siguientes;
    const s2 = await ejecutarYResponder(ent, sig!, { resueltos: {}, mensajes: estado.mensajes, pregunta: null, siguientes: resto }, ahora);
    return { ...s2, respuesta: `${salida.respuesta}\n\n${s2.respuesta}`, resultado: salida.resultado ?? s2.resultado };
  }
  return salida;
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
  const respuesta = fallo && typeof o.error === 'string' && typeof o.mensaje !== 'string' ? `No se ha podido hacer: ${o.error}` : texto;
  // La cita creada o movida se recuerda en la conversación («pásala al viernes» = esa cita).
  const tocoCita = c.pendiente.accion.tool === 'crear_recordatorio' || c.pendiente.accion.tool === 'modificar_evento_agenda';
  const eventoId = tocoCita ? (typeof o.id === 'string' ? o.id : typeof c.pendiente.accion.args.evento_id === 'string' ? (c.pendiente.accion.args.evento_id as string) : '') : '';
  const salida: SalidaMotor = { respuesta, resultado: eventoId && !fallo ? { ...o, evento_id: eventoId } : o, ejecutado: !fallo };

  // Lo que se pidió en la misma frase (otra persona en horas, retomar la factura tras guardar el NIF…): se prepara ahora.
  const siguientes = c.pendiente.accion.siguientes ?? [];
  if (!fallo && siguientes.length) {
    const [sig, ...resto] = siguientes;
    const ent = {
      supabase: p.supabase,
      businessId: p.businessId,
      userId: p.userId,
      mensaje: '',
      categoria: 'general',
      hoyTexto: '',
      runTool: p.runTool,
    } satisfies EntradaMotor;
    const s2 = await ejecutarYResponder(ent, sig!, { resueltos: {}, mensajes: c.pendiente.accion.mensajes ?? [], pregunta: null, siguientes: resto }, p.ahora ?? new Date());
    return { ...salida, respuesta: `${salida.respuesta}\n\n---\nSiguiente: ${s2.respuesta}`, accionPendiente: s2.accionPendiente, opciones: s2.opciones };
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
