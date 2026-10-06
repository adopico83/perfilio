import type { SupabaseClient } from '@supabase/supabase-js';

/** Estados que se pueden poner a mano. «facturado» solo se alcanza facturando (crearFacturaDesdeAlbaran). */
export const ESTADOS_ALBARAN_EDITABLES = ['pendiente', 'entregado'] as const;

export type ResultadoAlbaran =
  | { ok: true; id: string }
  | { ok: false; code: 'validacion' | 'no_encontrado' | 'conflicto' | 'error'; error: string };

export const MENSAJE_ALBARAN_FACTURADO = 'Un albarán facturado ya no cambia de estado.';
export const MENSAJE_ALBARAN_FACTURADO_CARRERA = 'El albarán se ha facturado mientras tanto: ya no cambia de estado.';

export function esFacturado(estado: unknown): boolean {
  return String(estado ?? '').toLowerCase() === 'facturado';
}

/**
 * Cambia pendiente/entregado de un albarán del negocio. Misma regla que `PATCH /api/albaranes/[id]/estado`:
 * un albarán facturado no se toca, y la condición va EN el UPDATE para que dos peticiones a la vez no se pisen
 * (`not.ilike` sin comodines = distinto sin mirar mayúsculas; `is.null` porque `NULL <> x` no es verdadero en SQL).
 */
export async function cambiarEstadoAlbaran(
  supabase: SupabaseClient,
  businessId: string,
  albaranId: string,
  estadoRaw: unknown
): Promise<ResultadoAlbaran> {
  const estado = typeof estadoRaw === 'string' ? estadoRaw.trim().toLowerCase() : '';
  if (estado === 'facturado') {
    return {
      ok: false,
      code: 'validacion',
      error: 'Para marcar un albarán como facturado hay que crear su factura.',
    };
  }
  if (!(ESTADOS_ALBARAN_EDITABLES as readonly string[]).includes(estado)) {
    return { ok: false, code: 'validacion', error: `El estado de un albarán debe ser uno de: ${ESTADOS_ALBARAN_EDITABLES.join(', ')}.` };
  }
  return actualizarAlbaranNoFacturado(supabase, businessId, albaranId, { estado });
}

/** UPDATE de un albarán que NUNCA toca uno ya facturado (ni siquiera con dos peticiones a la vez). */
export async function actualizarAlbaranNoFacturado(
  supabase: SupabaseClient,
  businessId: string,
  albaranId: string,
  campos: Record<string, unknown>
): Promise<ResultadoAlbaran> {
  const { data: actual, error: errLeer } = await supabase
    .from('albaranes')
    .select('id, estado')
    .eq('id', albaranId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (errLeer) return { ok: false, code: 'error', error: errLeer.message };
  if (!actual?.id) return { ok: false, code: 'no_encontrado', error: 'Albarán no encontrado' };
  if (esFacturado((actual as { estado?: string | null }).estado)) {
    return { ok: false, code: 'conflicto', error: MENSAJE_ALBARAN_FACTURADO };
  }

  const { data: filas, error } = await supabase
    .from('albaranes')
    .update(campos)
    .eq('id', albaranId)
    .eq('business_id', businessId)
    .or('estado.is.null,estado.not.ilike.facturado')
    .select('id');
  if (error) return { ok: false, code: 'error', error: error.message };
  if (!filas || filas.length === 0) {
    const { data: ahora } = await supabase
      .from('albaranes')
      .select('id')
      .eq('id', albaranId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!ahora) return { ok: false, code: 'no_encontrado', error: 'Albarán no encontrado' };
    return { ok: false, code: 'conflicto', error: MENSAJE_ALBARAN_FACTURADO_CARRERA };
  }
  return { ok: true, id: albaranId };
}
