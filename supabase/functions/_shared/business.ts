/** Lo mínimo que necesitamos del cliente de Supabase (así se puede probar sin Deno). */
type ClienteNegocios = {
  from: (table: 'business_profiles') => {
    select: (
      columns: string
    ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * UUID del negocio sobre el que trabaja la función.
 * 1. `business_id` de la petición (debe ser un UUID; ya no se admite el alias 'pino').
 * 2. Si no viene: el único negocio de `business_profiles`, o el que se llame Pino.
 */
export async function resolveBusinessId(
  adminClient: ClienteNegocios,
  requested: string | null | undefined
): Promise<string> {
  const wanted = requested?.trim();
  if (wanted) {
    if (!isUuid(wanted)) {
      throw new Error(`business_id inválido: se esperaba un UUID y llegó «${wanted}»`);
    }
    return wanted;
  }

  const { data, error } = await adminClient.from('business_profiles').select('id, nombre');
  if (error) {
    throw new Error(`Error resolviendo el negocio: ${error.message}`);
  }
  const negocios = (data ?? []) as Array<{ id: string; nombre: string | null }>;
  if (negocios.length === 1) return negocios[0].id;
  const pino = negocios.filter((n) => (n.nombre ?? '').toLowerCase().includes('pino'));
  if (pino.length === 1) return pino[0].id;
  throw new Error('No se pudo determinar el negocio: envía business_id (UUID) en la petición');
}
