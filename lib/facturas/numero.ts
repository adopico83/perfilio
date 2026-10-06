import type { SupabaseClient } from '@supabase/supabase-js';

/** Visible al usuario si dos altas concurrentes agotan el reintento. */
export const MENSAJE_COLISION_NUMERO_FACTURA =
  'Colisión al generar número de factura. Inténtalo de nuevo.';

const INTENTOS_INSERCION = 2;

/**
 * Siguiente correlativo libre de factura por negocio. `MAX` ignora NULL (mismo enfoque que
 * `lib/presupuestos/numero.ts`): se ordena DESC excluyendo NULL, porque en Postgres el DESC
 * por defecto pone los NULL primero y el «último» podría ser NULL.
 */
export async function leerSiguienteNumeroFactura(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ ok: true; numero: number } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('facturas')
    .select('numero_factura')
    .eq('business_id', businessId)
    .not('numero_factura', 'is', null)
    .order('numero_factura', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const raw = (data as { numero_factura?: unknown } | null)?.numero_factura;
  const actual = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(actual)) return { ok: true, numero: 1 };
  const siguiente = Math.trunc(actual) + 1;
  return { ok: true, numero: siguiente >= 1 ? siguiente : 1 };
}

function campoError(error: unknown, campo: 'code' | 'message' | 'details'): string {
  if (!error || typeof error !== 'object' || !(campo in error)) return '';
  return String((error as Record<string, unknown>)[campo] ?? '');
}

/** El 23505 viene del índice «una factura por presupuesto» (no de la numeración). */
function esConflictoPresupuesto(error: unknown): boolean {
  const texto = `${campoError(error, 'message')} ${campoError(error, 'details')}`;
  return texto.includes('uq_facturas_presupuesto_id');
}

/** El 23505 viene del índice «una factura por albarán» (uq_facturas_albaran_id). */
function esConflictoAlbaran(error: unknown): boolean {
  const texto = `${campoError(error, 'message')} ${campoError(error, 'details')}`;
  return texto.includes('uq_facturas_albaran_id');
}

/**
 * Inserta una factura con el siguiente `numero_factura` del negocio.
 * - 23505 en `facturas_business_numero_unique` (otra alta se llevó el número): relee el máximo y
 *   reintenta una vez.
 * - 23505 en `uq_facturas_presupuesto_id` (ya hay factura de ese presupuesto): NO se reintenta;
 *   se devuelve `conflictoPresupuesto: true` para que el llamador relea la existente.
 * - 23505 en `uq_facturas_albaran_id` (ya hay factura de ese albarán): igual, `conflictoAlbaran: true`.
 * `campos` no debe fijar el número; `business_id` sale del argumento.
 */
export async function insertarFacturaConNumeroCorrelativo(
  supabase: SupabaseClient,
  businessId: string,
  campos: Record<string, unknown>,
  select: string
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; conflictoPresupuesto?: true; conflictoAlbaran?: true }
> {
  const resto: Record<string, unknown> = { ...campos };
  delete resto.numero_factura;
  delete resto.business_id;

  for (let intento = 0; intento < INTENTOS_INSERCION; intento++) {
    const siguiente = await leerSiguienteNumeroFactura(supabase, businessId);
    if (!siguiente.ok) return siguiente;

    const { data, error } = await supabase
      .from('facturas')
      .insert({ ...resto, business_id: businessId, numero_factura: siguiente.numero })
      .select(select)
      .single();

    if (!error && data && typeof data === 'object') {
      return { ok: true, data: data as Record<string, unknown> };
    }

    const code = campoError(error, 'code');
    if (code === '23505' && esConflictoPresupuesto(error)) {
      return { ok: false, error: 'Este presupuesto ya tiene una factura.', conflictoPresupuesto: true };
    }
    if (code === '23505' && esConflictoAlbaran(error)) {
      return { ok: false, error: 'Este albarán ya tiene una factura.', conflictoAlbaran: true };
    }
    if (code === '23505' && intento < INTENTOS_INSERCION - 1) continue;
    if (code === '23505') return { ok: false, error: MENSAJE_COLISION_NUMERO_FACTURA };
    return { ok: false, error: campoError(error, 'message') || 'No se pudo crear la factura.' };
  }
  return { ok: false, error: MENSAJE_COLISION_NUMERO_FACTURA };
}
