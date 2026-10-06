/**
 * Estados de un presupuesto. Una sola lista, con los valores que ya existen en el código y en la pantalla
 * de Presupuestos: el dictado y el atajo del agente guardan «borrador» (antes el agente no lo aceptaba como
 * estado y «márcalo aceptado» no funcionaba), la confirmación guarda «pendiente», y solo «aceptado» o
 * «aprobado» se pueden facturar.
 */
export const ESTADOS_PRESUPUESTO = [
  'borrador',
  'pendiente',
  'enviado',
  'aceptado',
  'aprobado',
  'rechazado',
  'facturado',
  'pagado',
] as const;
export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[number];

/** Estados desde los que se puede crear la factura. */
export const ESTADOS_FACTURABLES: readonly string[] = ['aceptado', 'aprobado'];

/** Cómo lo dice la gente → estado real. */
const SINONIMOS: Record<string, EstadoPresupuesto> = {
  aceptada: 'aceptado',
  aprobada: 'aprobado',
  rechazada: 'rechazado',
  enviada: 'enviado',
  facturada: 'facturado',
  pagada: 'pagado',
};

export function parseEstadoPresupuesto(raw: unknown): EstadoPresupuesto | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if ((ESTADOS_PRESUPUESTO as readonly string[]).includes(s)) return s as EstadoPresupuesto;
  return SINONIMOS[s] ?? null;
}

export const MENSAJE_ESTADO_PRESUPUESTO = `El estado de un presupuesto debe ser uno de: ${ESTADOS_PRESUPUESTO.join(', ')}.`;
