import type { PresupuestoPdfRow } from '@/lib/pdf/presupuesto-render';

/** Texto de un presupuesto de ejemplo (mismo formato que `presupuesto_generado`). 2 capítulos para ver títulos, filas alternas y totales. */
const TEXTO_MUESTRA = [
  'CAPÍTULO ALBAÑILERÍA',
  '1. Demolición de tabique y retirada de escombros | Cantidad: 12 | Precio: 18,50 € | Importe: 222,00 €',
  '2. Alicatado de paredes con azulejo cerámico | Cantidad: 24 | Precio: 32,00 € | Importe: 768,00 €',
  '3. Solado de gres porcelánico | Cantidad: 9 | Precio: 41,00 € | Importe: 369,00 €',
  'TOTAL ALBAÑILERÍA: 1.359,00 €',
  'CAPÍTULO PINTURA',
  '4. Pintura plástica lisa en paramentos | Cantidad: 60 | Precio: 7,50 € | Importe: 450,00 €',
  '5. Lacado de puerta de paso | Cantidad: 2 | Precio: 65,00 € | Importe: 130,00 €',
  'TOTAL PINTURA: 580,00 €',
  'BASE IMPONIBLE: 1.939,00 € | IVA (21%): 407,19 € | TOTAL: 2.346,19 €',
].join('\n');

/** Fila de presupuesto inventada para el «PDF de muestra»: nunca toca datos reales. */
export function presupuestoMuestra(now: Date = new Date()): PresupuestoPdfRow {
  return {
    id: 'muestra',
    presupuesto_generado: TEXTO_MUESTRA,
    fecha: now.toISOString().slice(0, 10),
    cliente_nombre: 'Cliente de ejemplo',
    numero_presupuesto: 1,
    obras: { nombre: 'Reforma de ejemplo' },
  };
}
