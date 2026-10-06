/**
 * Qué campos de un cliente se pueden cambiar y cómo se limpian. Lo usan `PATCH /api/clientes` (pantalla
 * Clientes) y la tool `actualizar_cliente` del agente: una sola regla para los dos.
 */
export type CambiosCliente = {
  nombre?: string;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  nif?: string | null;
  notas?: string | null;
};

export function construirCambiosCliente(
  b: Record<string, unknown>
): { ok: true; cambios: CambiosCliente } | { ok: false; error: string } {
  const cambios: CambiosCliente = {};
  if (typeof b.nombre === 'string') {
    const n = b.nombre.trim();
    if (!n) return { ok: false, error: 'nombre no puede estar vacío' };
    cambios.nombre = n;
  }
  if (typeof b.telefono === 'string') cambios.telefono = b.telefono.trim() || null;
  if (typeof b.email === 'string') cambios.email = b.email.trim() || null;
  if (typeof b.direccion === 'string') cambios.direccion = b.direccion.trim() || null;
  if (typeof b.nif === 'string') cambios.nif = b.nif.trim().toUpperCase() || null;
  if (typeof b.notas === 'string') cambios.notas = b.notas.trim() || null;
  if (Object.keys(cambios).length === 0) return { ok: false, error: 'No hay campos para actualizar' };
  return { ok: true, cambios };
}
