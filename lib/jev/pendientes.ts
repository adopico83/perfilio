/**
 * Órdenes pendientes y tarea en curso, guardadas en el SERVIDOR (tabla `jev_ordenes_pendientes`).
 * Al navegador solo viaja el `id`; al confirmar, el servidor carga la fila (mismo negocio y usuario, sin
 * caducar ni usar) y ejecuta EXACTAMENTE `args_resueltos`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrdenCruda, OrdenJev } from '@/lib/jev/ordenes';

const TABLA = 'jev_ordenes_pendientes';
const MINUTOS_PENDIENTE = 30;
const MINUTOS_TAREA = 20;

export type AccionResuelta = {
  tool: string;
  args: Record<string, unknown>;
  /** Mensajes del usuario con los que se preparó (para volver a preparar una corrección: «espera, ponla a 230»). */
  mensajes?: string[];
  /** Órdenes que el usuario pidió en la misma frase o que hay que retomar después de esta («hago primero X; luego te pregunto Y»). */
  siguientes?: OrdenCruda[];
};

export type OrdenPendiente = {
  id: string;
  orden: OrdenCruda | OrdenJev;
  accion: AccionResuelta;
  resumen: string;
};

/** Lo que el ejecutor ya tiene resuelto de una tarea a medias (solo ids que salieron del resolvedor). */
export type EstadoTarea = {
  /** slot → { id, etiqueta } resuelto por el servidor. */
  resueltos: Record<string, { id: string; etiqueta: string; texto: string }>;
  /** Mensajes del usuario de esta tarea (para comprobar que los importes los dijo él). */
  mensajes: string[];
  /** Pregunta pendiente de respuesta, con las opciones cuyos ids ya salieron del resolvedor. */
  pregunta?: {
    slot: string;
    texto_slot: string;
    texto: string;
    opciones: Array<{ n: number; id: string; etiqueta: string }>;
    /** El resolvedor no encontró a nadie y se ofreció darlo de alta («¿Lo doy de alta o es otro nombre?»). */
    alta?: boolean;
    /** Falta un dato de la ficha del cliente para seguir (NIF, dirección): al llegar se guarda y se retoma la orden. */
    retomar?: { cliente_id: string; cliente: string; campo: 'nif' | 'direccion'; faltan?: Array<'nif' | 'direccion'> };
  } | null;
  /** Órdenes que quedan por preparar tras esta (misma frase) o tras guardar un dato pedido. */
  siguientes?: OrdenCruda[];
};

/** La orden de una tarea puede estar a medias (faltan datos): por eso es la orden cruda, que se completa con `completarOrden`. */
export type Tarea = { id: string; orden: OrdenCruda | OrdenJev; estado: EstadoTarea };

const ahoraMas = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

export async function crearPendiente(
  supabase: SupabaseClient,
  p: { businessId: string; userId: string; orden: OrdenCruda | OrdenJev; accion: AccionResuelta; resumen: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Solo hay UNA propuesta viva por usuario: la nueva sustituye a la anterior.
  await supabase
    .from(TABLA)
    .update({ estado: 'cancelada', usada_at: new Date().toISOString() })
    .eq('business_id', p.businessId)
    .eq('user_id', p.userId)
    .eq('estado', 'pendiente');
  const { data, error } = await supabase
    .from(TABLA)
    .insert({
      business_id: p.businessId,
      user_id: p.userId,
      orden: p.orden,
      args_resueltos: p.accion,
      resumen: p.resumen,
      estado: 'pendiente',
      expires_at: ahoraMas(MINUTOS_PENDIENTE),
    })
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: error?.message ?? 'No se pudo guardar la orden pendiente' };
  return { ok: true, id: String(data.id) };
}

/** La orden pendiente de ESTE usuario y negocio, si sigue viva. Nunca la de otro. */
export async function cargarPendiente(
  supabase: SupabaseClient,
  id: string,
  businessId: string,
  userId: string
): Promise<{ ok: true; pendiente: OrdenPendiente } | { ok: false; motivo: 'no_existe' | 'usada' | 'caducada' }> {
  const { data } = await supabase
    .from(TABLA)
    .select('id, orden, args_resueltos, resumen, estado, expires_at')
    .eq('id', id)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  const fila = data as { id: string; orden: OrdenCruda | OrdenJev; args_resueltos: AccionResuelta | null; resumen: string | null; estado: string; expires_at: string } | null;
  if (!fila || !fila.args_resueltos || !['pendiente', 'confirmada', 'cancelada', 'caducada'].includes(fila.estado)) {
    return { ok: false, motivo: 'no_existe' };
  }
  if (fila.estado !== 'pendiente') return { ok: false, motivo: 'usada' };
  if (new Date(fila.expires_at).getTime() < Date.now()) return { ok: false, motivo: 'caducada' };
  return { ok: true, pendiente: { id: fila.id, orden: fila.orden, accion: fila.args_resueltos, resumen: fila.resumen ?? '' } };
}

/** La pendiente más reciente viva del usuario (para un «sí» escrito). */
export async function pendienteVivaDelUsuario(
  supabase: SupabaseClient,
  businessId: string,
  userId: string
): Promise<OrdenPendiente | null> {
  const { data } = await supabase
    .from(TABLA)
    .select('id')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
    .limit(1);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) return null;
  const r = await cargarPendiente(supabase, id, businessId, userId);
  return r.ok ? r.pendiente : null;
}

/** Marca la orden como usada de forma atómica: solo una confirmación puede ganar. */
export async function marcarConfirmada(supabase: SupabaseClient, id: string, businessId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from(TABLA)
    .update({ estado: 'confirmada', usada_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle();
  return Boolean(data?.id);
}

export async function cancelarPendiente(supabase: SupabaseClient, id: string, businessId: string, userId: string): Promise<void> {
  await supabase
    .from(TABLA)
    .update({ estado: 'cancelada', usada_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'pendiente');
}

// ───────────── Tarea en curso («no, con Iker PRUEBA» corrige solo el cliente) ─────────────

export async function cargarTareaEnCurso(supabase: SupabaseClient, businessId: string, userId: string): Promise<Tarea | null> {
  const { data } = await supabase
    .from(TABLA)
    .select('id, orden, args_resueltos, expires_at')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'en_curso')
    .order('created_at', { ascending: false })
    .limit(1);
  const f = (data as Array<{ id: string; orden: OrdenCruda | OrdenJev; args_resueltos: EstadoTarea | null; expires_at: string }> | null)?.[0];
  if (!f || !f.args_resueltos || new Date(f.expires_at).getTime() < Date.now()) return null;
  return { id: f.id, orden: f.orden, estado: f.args_resueltos };
}

export async function guardarTarea(
  supabase: SupabaseClient,
  p: { businessId: string; userId: string; orden: OrdenCruda | OrdenJev; estado: EstadoTarea }
): Promise<void> {
  await supabase
    .from(TABLA)
    .update({ estado: 'caducada', usada_at: new Date().toISOString() })
    .eq('business_id', p.businessId)
    .eq('user_id', p.userId)
    .eq('estado', 'en_curso');
  await supabase.from(TABLA).insert({
    business_id: p.businessId,
    user_id: p.userId,
    orden: p.orden,
    args_resueltos: p.estado,
    resumen: p.estado.pregunta?.texto ?? null,
    estado: 'en_curso',
    expires_at: ahoraMas(MINUTOS_TAREA),
  });
}

export async function cerrarTarea(supabase: SupabaseClient, businessId: string, userId: string): Promise<void> {
  await supabase
    .from(TABLA)
    .update({ estado: 'caducada', usada_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'en_curso');
}
