import type { SupabaseClient } from '@supabase/supabase-js';

/** Visible al usuario si dos altas concurrentes agotan el reintento. */
export const MENSAJE_COLISION_NUMERO_PRESUPUESTO =
  'Colisión al generar número de presupuesto. Inténtalo de nuevo.';

const INTENTOS_INSERCION = 2;

/**
 * Siguiente correlativo libre por negocio.
 *
 * `MAX` ignora NULL. El equivalente en PostgREST es ordenar DESC con
 * NULLS LAST y excluir NULL: en Postgres el default de DESC es NULLS FIRST,
 * así que «el último» podía ser NULL, el siguiente número volvía a ser 1 y
 * chocaba con `presupuestos_business_numero_unique`.
 */
export async function leerSiguienteNumeroPresupuesto(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ ok: true; numero: number } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('presupuestos')
    .select('numero_presupuesto')
    .eq('business_id', businessId)
    .not('numero_presupuesto', 'is', null)
    .order('numero_presupuesto', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const raw = (data as { numero_presupuesto?: unknown } | null)?.numero_presupuesto;
  const actual = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(actual)) return { ok: true, numero: 1 };
  const siguiente = Math.trunc(actual) + 1;
  return { ok: true, numero: siguiente >= 1 ? siguiente : 1 };
}

function codigoError(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code ?? '');
}

function mensajeError(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) return '';
  return String((error as { message?: unknown }).message ?? '');
}

function detallesError(error: unknown): string {
  if (!error || typeof error !== 'object' || !('details' in error)) return '';
  return String((error as { details?: unknown }).details ?? '');
}

/** Visible al usuario cuando el índice único de `preview_id` es el que choca. */
export const MENSAJE_CONFLICTO_PREVIEW =
  'Ya existe un presupuesto asociado a esta previsualización.';

/**
 * Distingue qué restricción única disparó un 23505: el índice parcial de
 * `preview_id` (no se reintenta: la previsualización ya generó un presupuesto)
 * o `presupuestos_business_numero_unique` (colisión de numeración, se reintenta).
 */
function esConflictoPreviewId(error: unknown): boolean {
  const texto = `${mensajeError(error)} ${detallesError(error)}`;
  return texto.includes('idx_presupuestos_preview_id_unique');
}

/**
 * Inserta un presupuesto con el siguiente `numero_presupuesto` del negocio.
 * Si otra alta se lleva ese número (23505 en `presupuestos_business_numero_unique`),
 * relee el máximo y reintenta una vez. Si el 23505 viene del índice único de
 * `preview_id` (`idx_presupuestos_preview_id_unique`), no se reintenta la
 * numeración: ya existe un presupuesto para esa previsualización, así que se
 * devuelve `conflictoPreview: true` para que el llamador la busque y la
 * reutilice en vez de duplicarla. `campos` no debe fijar el número: se asigna
 * aquí. `business_id` sale del argumento.
 */
export async function insertarPresupuestoConNumeroCorrelativo(
  supabase: SupabaseClient,
  businessId: string,
  campos: Record<string, unknown>,
  select: string
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; conflictoPreview?: true }
> {
  const resto: Record<string, unknown> = { ...campos };
  delete resto.numero_presupuesto;
  delete resto.business_id;

  for (let intento = 0; intento < INTENTOS_INSERCION; intento++) {
    const siguiente = await leerSiguienteNumeroPresupuesto(supabase, businessId);
    if (!siguiente.ok) return siguiente;

    const { data, error } = await supabase
      .from('presupuestos')
      .insert({
        ...resto,
        business_id: businessId,
        numero_presupuesto: siguiente.numero,
      })
      .select(select)
      .single();

    if (!error && data && typeof data === 'object') {
      return { ok: true, data: data as Record<string, unknown> };
    }

    const code = codigoError(error);
    if (code === '23505' && esConflictoPreviewId(error)) {
      return { ok: false, error: MENSAJE_CONFLICTO_PREVIEW, conflictoPreview: true };
    }
    if (code === '23505' && intento < INTENTOS_INSERCION - 1) continue;
    if (code === '23505') return { ok: false, error: MENSAJE_COLISION_NUMERO_PRESUPUESTO };
    return { ok: false, error: mensajeError(error) || 'No se pudo crear el presupuesto.' };
  }

  return { ok: false, error: MENSAJE_COLISION_NUMERO_PRESUPUESTO };
}
