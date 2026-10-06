/**
 * Marca de cada negocio en sus PDF (presupuesto y factura): colores, tipografía y texto de
 * observaciones. Todo es opcional: un campo sin rellenar (null) deja el aspecto de siempre.
 */

/** Fuentes estándar de PDF: viajan dentro de todos los lectores, no hay que descargar ni incrustar nada. */
export const TIPOGRAFIAS = ['Helvetica', 'Times-Roman', 'Courier'] as const;
export type Tipografia = (typeof TIPOGRAFIAS)[number];

export const MARCA_OBSERVACIONES_MAX = 1000;

/** Texto de observaciones que llevaban todos los presupuestos antes de poder personalizarlo. */
export const OBSERVACIONES_PRESUPUESTO_DEFECTO =
  'La presente oferta sólo incluye los trabajos en ella expresamente indicados... Todo trabajo fuera de presupuesto tendrá un importe de 30€/hora más el material empleado.';

/** Colores y fuente que tenían los PDF antes de existir la marca (no cambiar: son el «aspecto de siempre»). */
export const DEFECTO_PRESUPUESTO = { primario: '#1e3a8a', tipografia: 'Helvetica' as Tipografia };
export const DEFECTO_FACTURA = {
  primario: '#1a365d',
  fondoCaja: '#f5f5f5',
  fondoFila: '#fafafa',
  tipografia: 'Helvetica' as Tipografia,
};

export type MarcaPdf = {
  /** Cabeceras de tabla y títulos. */
  colorPrimario: string | null;
  /** Fondos de cajas y filas alternas. */
  colorSecundario: string | null;
  tipografia: Tipografia | null;
  /** Solo presupuestos. */
  observacionesPresupuesto: string | null;
};

export const MARCA_VACIA: MarcaPdf = {
  colorPrimario: null,
  colorSecundario: null,
  tipografia: null,
  observacionesPresupuesto: null,
};

/** Columnas de `business_profiles` que forman la marca. */
export const MARCA_PROFILE_COLUMNS =
  'marca_color_primario, marca_color_secundario, marca_tipografia, marca_observaciones_presupuesto';

export type MarcaPerfilRow = {
  marca_color_primario?: string | null;
  marca_color_secundario?: string | null;
  marca_tipografia?: string | null;
  marca_observaciones_presupuesto?: string | null;
};

const RE_HEX = /^#[0-9A-Fa-f]{6}$/;

export function esHexValido(v: unknown): v is string {
  return typeof v === 'string' && RE_HEX.test(v);
}

export function esTipografiaValida(v: unknown): v is Tipografia {
  return typeof v === 'string' && (TIPOGRAFIAS as readonly string[]).includes(v);
}

/** Lee la marca de una fila de `business_profiles`. Lo que no sea válido se ignora (queda el defecto). */
export function marcaDesdePerfil(row: MarcaPerfilRow | null | undefined): MarcaPdf {
  const obs = typeof row?.marca_observaciones_presupuesto === 'string' ? row.marca_observaciones_presupuesto.trim() : '';
  return {
    colorPrimario: esHexValido(row?.marca_color_primario) ? row.marca_color_primario : null,
    colorSecundario: esHexValido(row?.marca_color_secundario) ? row.marca_color_secundario : null,
    tipografia: esTipografiaValida(row?.marca_tipografia) ? row.marca_tipografia : null,
    observacionesPresupuesto: obs ? obs.slice(0, MARCA_OBSERVACIONES_MAX) : null,
  };
}

export type MarcaEntrada = {
  marca_color_primario: string | null;
  marca_color_secundario: string | null;
  marca_tipografia: Tipografia | null;
  marca_observaciones_presupuesto: string | null;
};

/**
 * Valida lo que llega del formulario de ajustes con las mismas reglas que los CHECK de la base de
 * datos. Solo se aceptan estos cuatro campos (lista blanca); vacío o null = quitar el valor.
 * Devuelve solo los campos presentes en la entrada.
 */
export function validarMarcaEntrada(
  entrada: unknown
): { ok: true; valores: Partial<MarcaEntrada> } | { ok: false; error: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, error: 'Cuerpo inválido' };
  }
  const e = entrada as Record<string, unknown>;
  const valores: Partial<MarcaEntrada> = {};

  const color = (clave: 'marca_color_primario' | 'marca_color_secundario', etiqueta: string) => {
    if (!(clave in e)) return null;
    const v = e[clave];
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      valores[clave] = null;
      return null;
    }
    if (!esHexValido(typeof v === 'string' ? v.trim() : v)) {
      return `${etiqueta} debe ser un color con formato #RRGGBB`;
    }
    valores[clave] = (v as string).trim();
    return null;
  };

  const errores = [
    color('marca_color_primario', 'El color primario'),
    color('marca_color_secundario', 'El color secundario'),
  ].filter(Boolean);
  if (errores.length > 0) return { ok: false, error: errores[0] as string };

  if ('marca_tipografia' in e) {
    const v = e.marca_tipografia;
    if (v == null || (typeof v === 'string' && v.trim() === '')) valores.marca_tipografia = null;
    else if (esTipografiaValida(v)) valores.marca_tipografia = v;
    else return { ok: false, error: `La tipografía debe ser una de: ${TIPOGRAFIAS.join(', ')}` };
  }

  if ('marca_observaciones_presupuesto' in e) {
    const v = e.marca_observaciones_presupuesto;
    if (v == null) valores.marca_observaciones_presupuesto = null;
    else if (typeof v !== 'string') return { ok: false, error: 'Las observaciones deben ser texto' };
    else if (v.trim().length > MARCA_OBSERVACIONES_MAX) {
      return { ok: false, error: `Las observaciones admiten como máximo ${MARCA_OBSERVACIONES_MAX} caracteres` };
    } else valores.marca_observaciones_presupuesto = v.trim() || null;
  }

  return { ok: true, valores };
}
