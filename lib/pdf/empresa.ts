/**
 * Emisor de presupuestos y facturas. Sale de `business_profiles` del tenant.
 * Un campo vacío es null y el documento no pinta esa línea.
 */

export type EmpresaEmisor = {
  razonSocial: string | null;
  nif: string | null;
  rea: string | null;
  direccion: string | null;
  localidad: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
  instagram: string | null;
  /** Una cuenta por línea, texto listo para imprimir. */
  cuentasBancarias: string[];
};

export const EMPRESA_PROFILE_COLUMNS =
  'razon_social, nif, rea, direccion_fiscal, localidad_fiscal, telefono, email, web, instagram, iban, logo_url';

export type BusinessProfileEmisorRow = {
  razon_social?: string | null;
  nif?: string | null;
  rea?: string | null;
  direccion_fiscal?: string | null;
  localidad_fiscal?: string | null;
  telefono?: string | null;
  email?: string | null;
  web?: string | null;
  instagram?: string | null;
  iban?: string | null;
  logo_url?: string | null;
};

export function empresaVacia(): EmpresaEmisor {
  return {
    razonSocial: null,
    nif: null,
    rea: null,
    direccion: null,
    localidad: null,
    telefono: null,
    email: null,
    web: null,
    instagram: null,
    cuentasBancarias: [],
  };
}

function texto(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function empresaDesdePerfil(
  row: BusinessProfileEmisorRow | null | undefined
): EmpresaEmisor {
  const iban = texto(row?.iban);
  const cuentasBancarias = iban
    ? iban
        .split(/\r?\n/)
        .map((linea) => linea.trim())
        .filter((linea) => linea.length > 0)
    : [];

  return {
    razonSocial: texto(row?.razon_social),
    nif: texto(row?.nif),
    rea: texto(row?.rea),
    direccion: texto(row?.direccion_fiscal),
    localidad: texto(row?.localidad_fiscal),
    telefono: texto(row?.telefono),
    email: texto(row?.email),
    web: texto(row?.web),
    instagram: texto(row?.instagram),
    cuentasBancarias,
  };
}

/** `NIF: …  R.E.A. …` con el mismo espaciado de la plantilla de presupuesto. */
export function lineaNifRea(empresa: Pick<EmpresaEmisor, 'nif' | 'rea'>): string | null {
  if (empresa.nif && empresa.rea) return `NIF: ${empresa.nif}  R.E.A. ${empresa.rea}`;
  if (empresa.nif) return `NIF: ${empresa.nif}`;
  if (empresa.rea) return `R.E.A. ${empresa.rea}`;
  return null;
}

/** `Oficina: …  E-mail: …` con el mismo espaciado de la plantilla de presupuesto. */
export function lineaOficinaEmail(
  empresa: Pick<EmpresaEmisor, 'telefono' | 'email'>
): string | null {
  if (empresa.telefono && empresa.email) {
    return `Oficina: ${empresa.telefono}  E-mail: ${empresa.email}`;
  }
  if (empresa.telefono) return `Oficina: ${empresa.telefono}`;
  if (empresa.email) return `E-mail: ${empresa.email}`;
  return null;
}

export function lineaInstagram(instagram: string | null): string | null {
  if (!instagram) return null;
  const handle = instagram.startsWith('@') ? instagram : `@${instagram}`;
  return `Instagram: ${handle}`;
}

export function lineasPresupuestoEmisor(empresa: EmpresaEmisor): string[] {
  const lineas: string[] = [];
  if (empresa.razonSocial) lineas.push(empresa.razonSocial);
  if (empresa.direccion) lineas.push(empresa.direccion);
  if (empresa.localidad) lineas.push(empresa.localidad);
  const nifRea = lineaNifRea(empresa);
  if (nifRea) lineas.push(nifRea);
  const contacto = lineaOficinaEmail(empresa);
  if (contacto) lineas.push(contacto);
  const instagram = lineaInstagram(empresa.instagram);
  if (instagram) lineas.push(instagram);
  return lineas;
}

type ProfileQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string
    ) => {
      maybeSingle: () => Promise<{
        data: BusinessProfileEmisorRow | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export type EmpresaLoaderClient = {
  from: (table: string) => unknown;
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number
      ) => PromiseLike<{
        data: { signedUrl?: string } | null;
        error: unknown;
      }>;
    };
  };
};

export type EmpresaCargada =
  | { ok: true; empresa: EmpresaEmisor; logoUrl: string | null }
  | { ok: false; error: string };

export async function loadEmpresaEmisor(
  supabase: EmpresaLoaderClient,
  businessId: string
): Promise<EmpresaCargada> {
  const query = supabase.from('business_profiles') as ProfileQuery;
  const { data, error } = await query
    .select(EMPRESA_PROFILE_COLUMNS)
    .eq('id', businessId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const row = data ?? null;
  let logoUrl: string | null = null;
  const logoPath = texto(row?.logo_url);
  if (logoPath) {
    const path = logoPath.replace(/^\/+/, '');
    const signed = await supabase.storage.from('business-assets').createSignedUrl(path, 3600);
    if (!signed.error && signed.data?.signedUrl) {
      logoUrl = signed.data.signedUrl;
    }
  }

  return { ok: true, empresa: empresaDesdePerfil(row), logoUrl };
}
