/** Construye `presupuesto_generado` con el mismo formato que el seed y el agente. Todo en céntimos. */

export type DemoPartida = { concepto: string; cantidad: number; precio: number };
export type DemoCapitulo = { nombre: string; partidas: DemoPartida[] };

export const DEMO_IVA_PCT = 21;

export function aCentimos(euros: number): number {
  return Math.round(euros * 100);
}

/** 2485050 -> «24.850,50» (siempre con punto de miles, como el seed). */
export function fmtEs(centimos: number): string {
  const neg = centimos < 0;
  const abs = Math.abs(Math.round(centimos));
  const enteros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${enteros},${dec}`;
}

export function importePartidaCent(p: DemoPartida): number {
  return Math.round(p.cantidad * aCentimos(p.precio));
}

export function totalCapituloCent(c: DemoCapitulo): number {
  return c.partidas.reduce((s, p) => s + importePartidaCent(p), 0);
}

export function baseCent(capitulos: DemoCapitulo[]): number {
  return capitulos.reduce((s, c) => s + totalCapituloCent(c), 0);
}

export function ivaCent(base: number): number {
  return Math.round((base * DEMO_IVA_PCT) / 100);
}

export function generarTextoPresupuesto(cliente: string, capitulos: DemoCapitulo[]): string {
  const lineas: string[] = [`PRESUPUESTO PARA ${cliente}`, ''];
  let n = 0;
  for (const cap of capitulos) {
    lineas.push(`CAPÍTULO ${cap.nombre}`);
    for (const p of cap.partidas) {
      n += 1;
      lineas.push(
        `${n}. ${p.concepto} | Cantidad: ${p.cantidad} | Precio: ${fmtEs(aCentimos(p.precio))} € | Importe: ${fmtEs(importePartidaCent(p))} €`
      );
    }
    lineas.push(`TOTAL ${cap.nombre}: ${fmtEs(totalCapituloCent(cap))} €`);
  }
  const base = baseCent(capitulos);
  const iva = ivaCent(base);
  lineas.push(
    `BASE IMPONIBLE: ${fmtEs(base)} € | IVA (${DEMO_IVA_PCT}%): ${fmtEs(iva)} € | TOTAL: ${fmtEs(base + iva)} €`
  );
  return lineas.join('\n');
}
