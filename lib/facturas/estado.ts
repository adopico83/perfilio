import type { SupabaseClient } from '@supabase/supabase-js';

/** Estados que admite una factura. Una sola lista: la usan la API, la pantalla y el agente. */
export const ESTADOS_FACTURA = ['pendiente', 'pagada', 'vencida'] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

/** Cómo lo dice la gente → estado real («pagado», «cobrada»… no existen en la pantalla de Facturas). */
const SINONIMOS: Record<string, EstadoFactura> = {
  pagado: 'pagada',
  pagada: 'pagada',
  cobrada: 'pagada',
  cobrado: 'pagada',
  vencido: 'vencida',
  pendiente: 'pendiente',
  vencida: 'vencida',
};

export function parseEstadoFactura(raw: unknown): EstadoFactura | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SINONIMOS[s] ?? null;
}

export const MENSAJE_ESTADO_FACTURA = `El estado de una factura debe ser uno de: ${ESTADOS_FACTURA.join(', ')}.`;

export type ResultadoCambioEstado =
  | { ok: true; id: string; estado: string }
  | { ok: false; code: 'validacion' | 'no_encontrado' | 'conflicto' | 'error'; error: string };

/** Cambia el estado de una factura del negocio (siempre filtrando por business_id). */
export async function cambiarEstadoFactura(
  supabase: SupabaseClient,
  businessId: string,
  facturaId: string,
  estadoRaw: unknown
): Promise<ResultadoCambioEstado> {
  const estado = parseEstadoFactura(estadoRaw);
  if (!estado) return { ok: false, code: 'validacion', error: MENSAJE_ESTADO_FACTURA };
  const { data, error } = await supabase
    .from('facturas')
    .update({ estado })
    .eq('id', facturaId)
    .eq('business_id', businessId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, code: 'error', error: error.message };
  if (!data?.id) return { ok: false, code: 'no_encontrado', error: 'Factura no encontrada' };
  return { ok: true, id: String(data.id), estado };
}
