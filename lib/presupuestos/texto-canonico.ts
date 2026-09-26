/**
 * Texto canónico de `presupuestos.presupuesto_generado`: el único formato que
 * entiende `parsePresupuestoGenerado` (lib/pdf/parser.ts). Cualquier alta que
 * deba verse en el PDF pasa por `generarTextoCanonico`. Si cambias el formato
 * de las líneas, cambia también el parser.
 */

export const TOLERANCIA_IMPORTE = 0.01;

export function fmtImporteLinea(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCantidadLinea(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

const aCentimos = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export type PartidaCanonicaEntrada = {
  concepto: string;
  cantidad: number;
  precio: number;
  /** Si el llamante ya trae un importe, debe coincidir con cantidad × precio (±1 céntimo). */
  importe?: number;
  capitulo?: string | null;
};

export type PartidaCanonica = {
  concepto: string;
  cantidad: number;
  precio: number;
  importe: number;
  capitulo: string;
};

export type TextoCanonico = {
  texto: string;
  base: number;
  ivaImporte: number;
  total: number;
  partidas: PartidaCanonica[];
};

export type ResultadoTextoCanonico =
  | ({ ok: true } & TextoCanonico)
  | { ok: false; error: string };

/** El texto es de una sola línea por partida y usa `|` como separador. */
function limpiarTextoLinea(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

/**
 * Valida las partidas y genera el texto que se guarda. Todo el redondeo a
 * céntimo ocurre aquí; el modelo nunca aporta base, IVA ni total.
 */
export function generarTextoCanonico(
  partidas: PartidaCanonicaEntrada[],
  ivaPct: number
): ResultadoTextoCanonico {
  if (!Array.isArray(partidas) || partidas.length === 0) {
    return { ok: false, error: 'No hay partidas.' };
  }
  if (!Number.isInteger(ivaPct) || ivaPct < 0 || ivaPct > 100) {
    return { ok: false, error: 'El IVA debe ser un porcentaje entero entre 0 y 100.' };
  }

  const normalizadas: PartidaCanonica[] = [];
  for (let i = 0; i < partidas.length; i++) {
    const p = partidas[i];
    const etiqueta = `Partida ${i + 1}`;
    const concepto = limpiarTextoLinea(String(p?.concepto ?? ''));
    if (!concepto) return { ok: false, error: `${etiqueta}: falta el concepto.` };

    const cantidadRaw = typeof p.cantidad === 'number' ? p.cantidad : Number.NaN;
    const precioRaw = typeof p.precio === 'number' ? p.precio : Number.NaN;
    if (!Number.isFinite(cantidadRaw) || cantidadRaw < 0) {
      return { ok: false, error: `${etiqueta} («${concepto}»): cantidad no válida.` };
    }
    if (!Number.isFinite(precioRaw) || precioRaw < 0) {
      return { ok: false, error: `${etiqueta} («${concepto}»): precio no válido.` };
    }

    // Se normaliza a lo que se imprime (4 decimales de cantidad, céntimos de precio)
    // para que el texto guardado sea coherente consigo mismo al releerlo.
    const cantidad = Math.round(cantidadRaw * 10000) / 10000;
    const precio = aCentimos(precioRaw);
    const importe = aCentimos(cantidad * precio);

    if (p.importe !== undefined) {
      const declarado = p.importe;
      if (typeof declarado !== 'number' || !Number.isFinite(declarado) || declarado < 0) {
        return { ok: false, error: `${etiqueta} («${concepto}»): importe no válido.` };
      }
      if (Math.abs(declarado - importe) > TOLERANCIA_IMPORTE + 1e-9) {
        return {
          ok: false,
          error: `${etiqueta} («${concepto}»): el importe ${fmtImporteLinea(declarado)} € no coincide con cantidad × precio (${fmtImporteLinea(importe)} €).`,
        };
      }
    }

    normalizadas.push({
      concepto,
      cantidad,
      precio,
      importe,
      capitulo: limpiarTextoLinea(p.capitulo ?? '') || 'GENERAL',
    });
  }

  const capOrder: string[] = [];
  const porCapitulo = new Map<string, PartidaCanonica[]>();
  for (const p of normalizadas) {
    if (!porCapitulo.has(p.capitulo)) {
      porCapitulo.set(p.capitulo, []);
      capOrder.push(p.capitulo);
    }
    porCapitulo.get(p.capitulo)!.push(p);
  }

  const base = aCentimos(normalizadas.reduce((s, p) => s + p.importe, 0));
  const ivaImporte = aCentimos((base * ivaPct) / 100);
  const total = aCentimos(base + ivaImporte);

  const lines: string[] = [];
  let n = 1;
  for (const cap of capOrder) {
    lines.push(`CAPÍTULO ${cap}`);
    let sumCap = 0;
    for (const p of porCapitulo.get(cap)!) {
      sumCap = aCentimos(sumCap + p.importe);
      lines.push(
        `${n}. ${p.concepto} | Cantidad: ${fmtCantidadLinea(p.cantidad)} | Precio: ${fmtImporteLinea(p.precio)} € | Importe: ${fmtImporteLinea(p.importe)} €`
      );
      n += 1;
    }
    lines.push(`TOTAL ${cap}: ${fmtImporteLinea(sumCap)} €`);
  }
  lines.push(
    `BASE IMPONIBLE: ${fmtImporteLinea(base)} € | IVA (${ivaPct}%): ${fmtImporteLinea(ivaImporte)} € | TOTAL: ${fmtImporteLinea(total)} €`
  );

  return { ok: true, texto: lines.join('\n'), base, ivaImporte, total, partidas: normalizadas };
}
