import type { SupabaseClient } from '@supabase/supabase-js';
import { textoResumen, type ResumenDia } from '@/lib/resumen-diario/calcular';

export const TIPO_NOTIFICACION_RESUMEN = 'resumen_diario';

export function slugResumen(fecha: string): string {
  return `resumen-diario-${fecha}`;
}

/**
 * Guarda el resumen como notificación del negocio. Es idempotente: si ya existe la del día
 * (mismo business_id + slug) no duplica nada. Devuelve true solo si ha creado una nueva.
 */
export async function guardarResumenComoNotificacion(
  supabase: SupabaseClient,
  businessId: string,
  resumen: ResumenDia
): Promise<boolean> {
  const slug = slugResumen(resumen.fecha);

  const { data: existente, error: lookupError } = await supabase
    .from('bicho_notifications')
    .select('id')
    .eq('business_id', businessId)
    .eq('slug', slug)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(`Resumen del día (lookup): ${lookupError.message}`);
  if (existente) return false;

  const { error } = await supabase.from('bicho_notifications').insert({
    business_id: businessId,
    type: TIPO_NOTIFICACION_RESUMEN,
    slug,
    urgency: resumen.facturasVencidas.length > 0 || resumen.obrasParadas.length > 0 ? 'media' : 'baja',
    message: textoResumen(resumen),
    metadata: resumen,
    is_read: false,
  });
  // 23505: otra ejecución se adelantó (índice único de la migración).
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(`Resumen del día (insert): ${error.message}`);
  }
  return true;
}
