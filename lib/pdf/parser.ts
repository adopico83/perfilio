import type { CapituloPresupuestoPdf, PresupuestoGeneradoParseado } from './types';

/** Formato español para importes en PDF (miles con punto, decimales con coma). */
export function formatEuro(n: number): string {
  return (
    n.toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' €'
  );
}

const RE_FOOTER =
  /BASE\s+IMPONIBLE:\s*([\d.]+,\d{2})\s*€\s*\|\s*IVA\s*\((\d+)\s*%\)\s*:\s*([\d.]+,\d{2})\s*€\s*\|\s*TOTAL:\s*([\d.]+,\d{2})\s*€/i;

const RE_PARTIDA =
  /^(\d+)\.\s*(.+?)\s*\|\s*Cantidad:\s*([\d.,]+)\s*\|\s*Precio:\s*([\d.,]+)\s*€\s*\|\s*Importe:\s*([\d.,]+)\s*€\s*$/i;

const RE_TOTAL_CAP =
  /^TOTAL\s+(.+?)\s*(?:\s*:\s*|\s*-\s*)\s*([\d.]+,\d{2})\s*€\s*$/i;

function parseSpanishEuro(raw: string): number {
  const s = raw.trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseSpanishNumber(raw: string): number {
  const s = raw.trim();
  if (s.includes(',')) {
    return parseSpanishEuro(s);
  }
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function isChapterHeader(line: string): boolean {
  const t = line.trim();
  if (/^CAP[IÍ]TULO\s+/i.test(t)) return true;
  if (/^CUARTO\s+DE\s+BAÑO/i.test(t)) return true;
  if (/^COCINA$/i.test(t)) return true;
  return false;
}

function parseFooterLine(line: string): Pick<
  PresupuestoGeneradoParseado,
  'baseImponible' | 'porcentajeIva' | 'importeIva' | 'total'
> | null {
  const m = line.match(RE_FOOTER);
  if (!m) return null;
  return {
    baseImponible: parseSpanishEuro(m[1]),
    porcentajeIva: Number(m[2]),
    importeIva: parseSpanishEuro(m[3]),
    total: parseSpanishEuro(m[4]),
  };
}

function fillMissingFooter(parsed: PresupuestoGeneradoParseado): PresupuestoGeneradoParseado {
  if (parsed.baseImponible > 0 && parsed.total > 0) return parsed;
  const base =
    Math.round(
      parsed.capitulos.reduce((s, c) => s + (Number.isFinite(c.total) ? c.total : 0), 0) * 100
    ) / 100;
  if (base <= 0) return parsed;
  const ivaPct = parsed.porcentajeIva > 0 ? parsed.porcentajeIva : 21;
  const iva = Math.round((base * ivaPct) / 100 * 100) / 100;
  const total = Math.round((base + iva) * 100) / 100;
  return {
    ...parsed,
    baseImponible: base,
    porcentajeIva: ivaPct,
    importeIva: iva,
    total,
  };
}

/**
 * Interpreta el texto almacenado en `presupuestos.presupuesto_generado` (formato Pino / partidas).
 */
export function parsePresupuestoGenerado(texto: string): PresupuestoGeneradoParseado {
  const raw = (texto ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let footerIdx = -1;
  let footer: ReturnType<typeof parseFooterLine> = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const f = parseFooterLine(lines[i]);
    if (f) {
      footer = f;
      footerIdx = i;
      break;
    }
  }

  const bodyLines = footerIdx >= 0 ? lines.slice(0, footerIdx) : [...lines];

  let tituloGeneral: string | null = null;
  const tituloIdx = bodyLines.findIndex((l) => /PRESUPUESTO\s+PARA/i.test(l));
  if (tituloIdx >= 0) {
    tituloGeneral = bodyLines[tituloIdx];
    bodyLines.splice(tituloIdx, 1);
  }

  const capitulos: CapituloPresupuestoPdf[] = [];

  const pushChapter = (nombre: string): void => {
    capitulos.push({
      nombre: nombre.trim(),
      partidas: [],
      total: 0,
    });
  };

  for (const line of bodyLines) {
    if (isChapterHeader(line)) {
      pushChapter(line);
      continue;
    }

    const tm = line.match(RE_TOTAL_CAP);
    if (tm) {
      const amount = parseSpanishEuro(tm[2]);
      const last = capitulos[capitulos.length - 1];
      if (last) {
        last.total = amount;
      }
      continue;
    }

    const pm = line.match(RE_PARTIDA);
    if (pm) {
      if (capitulos.length === 0) {
        pushChapter('PARTIDAS');
      }
      const cap = capitulos[capitulos.length - 1];
      if (cap) {
        cap.partidas.push({
          concepto: pm[2].trim(),
          cantidad: parseSpanishNumber(pm[3]),
          precio: parseSpanishEuro(pm[4]),
          importe: parseSpanishEuro(pm[5]),
        });
      }
      continue;
    }
  }

  for (const c of capitulos) {
    if (c.total <= 0 && c.partidas.length > 0) {
      c.total =
        Math.round(c.partidas.reduce((s, p) => s + (Number.isFinite(p.importe) ? p.importe : 0), 0) * 100) /
        100;
    }
  }

  let baseImponible = footer?.baseImponible ?? 0;
  let porcentajeIva = footer?.porcentajeIva ?? 0;
  let importeIva = footer?.importeIva ?? 0;
  let total = footer?.total ?? 0;

  const parsed: PresupuestoGeneradoParseado = {
    tituloGeneral,
    capitulos,
    baseImponible,
    porcentajeIva,
    importeIva,
    total,
  };

  return fillMissingFooter(parsed);
}
