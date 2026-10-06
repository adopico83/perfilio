import { validarMarcaEntrada, type MarcaEntrada } from '@/lib/pdf/marca';

/** Datos fiscales del emisor (columnas de `business_profiles` que salen en los PDF). */
export const CAMPOS_FISCALES = [
  'razon_social',
  'nif',
  'rea',
  'direccion_fiscal',
  'localidad_fiscal',
  'telefono',
  'email',
  'web',
  'instagram',
  'iban',
] as const;
export type CampoFiscal = (typeof CAMPOS_FISCALES)[number];

const MAX_CAMPO = 300;
/** Una cuenta por línea: caben varias. */
const MAX_IBAN = 1000;

export const COLUMNAS_AJUSTES = [
  ...CAMPOS_FISCALES,
  'marca_color_primario',
  'marca_color_secundario',
  'marca_tipografia',
  'marca_observaciones_presupuesto',
  'logo_url',
] as const;

export type AjustesValores = Partial<Record<CampoFiscal, string | null>> & Partial<MarcaEntrada>;

/**
 * Valida el cuerpo del PATCH de ajustes. Lista blanca: cualquier otra clave (id, business_id,
 * user_id, logo_url…) se IGNORA, nunca llega al UPDATE. Vacío = quitar el valor.
 */
export function validarAjustesNegocio(
  entrada: unknown
): { ok: true; valores: AjustesValores } | { ok: false; error: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, error: 'Cuerpo inválido' };
  }
  const e = entrada as Record<string, unknown>;
  const valores: AjustesValores = {};

  for (const campo of CAMPOS_FISCALES) {
    if (!(campo in e)) continue;
    const v = e[campo];
    if (v == null) {
      valores[campo] = null;
      continue;
    }
    if (typeof v !== 'string') return { ok: false, error: `${campo} debe ser texto` };
    const limpio = campo === 'iban' ? v.replace(/\r\n/g, '\n').trim() : v.trim();
    const max = campo === 'iban' ? MAX_IBAN : MAX_CAMPO;
    if (limpio.length > max) return { ok: false, error: `${campo} admite como máximo ${max} caracteres` };
    valores[campo] = limpio || null;
  }

  const marca = validarMarcaEntrada(Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith('marca_'))));
  if (!marca.ok) return marca;
  Object.assign(valores, marca.valores);

  return { ok: true, valores };
}

/** Formatos de logo admitidos, comprobados por los primeros bytes del archivo (no por lo que diga el navegador). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function detectarFormatoLogo(bytes: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; mime: string } | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}
