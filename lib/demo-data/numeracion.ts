/** Numeración correlativa por fecha para los documentos del mock (facturas, albaranes). */

/**
 * Asigna `PREFIJO-AAAA-NNN` por fecha: el documento más antiguo del año recibe el número más bajo.
 * El año sale de la fecha del documento y la cuenta arranca en `base + 1` cada año.
 */
export function numerosCorrelativos(
  docs: Array<{ id: string; fecha: string }>,
  prefijo: string,
  base: number
): Map<string, string> {
  const ordenados = [...docs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const contador = new Map<string, number>();
  const out = new Map<string, string>();
  for (const d of ordenados) {
    const anio = d.fecha.slice(0, 4);
    const n = (contador.get(anio) ?? base) + 1;
    contador.set(anio, n);
    out.set(d.id, `${prefijo}-${anio}-${String(n).padStart(3, '0')}`);
  }
  return out;
}
