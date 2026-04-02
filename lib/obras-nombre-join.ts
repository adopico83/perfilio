/** Join `obras(nombre)` desde Supabase: puede venir como objeto o como array. */
export type ObrasNombreJoin =
  | { nombre: string }[]
  | { nombre: string }
  | null
  | undefined;

export function nombreObraDesdeJoin(obras: ObrasNombreJoin): string | undefined {
  if (obras == null) return undefined;
  return Array.isArray(obras) ? obras[0]?.nombre : obras.nombre;
}
