/** Tipos compartidos para documentos PDF generados en el servidor. */

export type PartidaPresupuestoPdf = {
  concepto: string;
  cantidad: number;
  precio: number;
  importe: number;
};

export type CapituloPresupuestoPdf = {
  nombre: string;
  partidas: PartidaPresupuestoPdf[];
  total: number;
};

/** Resultado de `parsePresupuestoGenerado` (texto `presupuesto_generado`). */
export type PresupuestoGeneradoParseado = {
  tituloGeneral: string | null;
  capitulos: CapituloPresupuestoPdf[];
  baseImponible: number;
  porcentajeIva: number;
  importeIva: number;
  total: number;
};

/** Props del documento PDF de presupuesto (Pino). */
export type PresupuestoPdfProps = {
  logoUrl: string | null;
  numeroPresupuesto: string;
  referencia: string;
  fecha: string;
  parsed: PresupuestoGeneradoParseado;
  /** Texto original si el parseo no produjo capítulos (fallback). */
  textoPlanoFallback: string;
};
