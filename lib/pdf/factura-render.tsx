import { renderToBuffer } from '@react-pdf/renderer';
import { loadEmpresaEmisor, type EmpresaEmisor, type EmpresaLoaderClient } from '@/lib/pdf/empresa';
import { FacturaPdfDocument, type FacturaPdfProps } from '@/lib/pdf/factura';

/** Columnas de `facturas` que necesita el render del PDF. */
export const FACTURA_PDF_COLUMNS =
  'id, business_id, numero_factura, fecha, cliente_nombre, cliente_nif, cliente_direccion, lineas, base_imponible, iva, total, observaciones, created_at';

export type FacturaPdfRow = {
  id?: unknown;
  numero_factura?: number | string | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  cliente_nif?: string | null;
  cliente_direccion?: string | null;
  lineas?: unknown;
  base_imponible?: unknown;
  iva?: unknown;
  total?: unknown;
  observaciones?: string | null;
  created_at?: string;
};

export type RenderFacturaPdfResult =
  | { ok: true; buffer: Buffer; fecha: string; numero_factura: number }
  | { ok: false; error: string };

/**
 * `lineas` es jsonb: normalmente un array, pero las facturas antiguas guardaron un string JSON
 * dentro del jsonb. Se aceptan las dos formas.
 */
export function parseFacturaLineas(raw: unknown): FacturaPdfProps['factura']['lineas'] {
  if (raw == null) return [];
  let arr: unknown[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      arr = Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }

  return arr.map((row) => {
    const o = row as Record<string, unknown>;
    const descripcion = String(o.descripcion ?? '').trim() || '—';
    const cantidad = Number(o.cantidad ?? 0);
    const precio_unitario = Number(o.precio_unitario ?? o.precio ?? 0);
    const importe =
      o.importe != null && String(o.importe).trim() !== ''
        ? Number(o.importe)
        : Number.isFinite(cantidad) && Number.isFinite(precio_unitario)
          ? Math.round(cantidad * precio_unitario * 100) / 100
          : 0;
    const capitulo =
      o.capitulo != null && String(o.capitulo).trim() ? String(o.capitulo).trim() : undefined;
    return {
      descripcion,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      precio_unitario: Number.isFinite(precio_unitario) ? precio_unitario : 0,
      importe: Number.isFinite(importe) ? importe : 0,
      capitulo,
    };
  });
}

function numFromDb(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Nombre del archivo descargado. */
export function nombreArchivoFacturaPdf(fecha: string, numero: number): string {
  return `factura-${fecha.replace(/[^0-9-]/g, '')}-${numero}.pdf`;
}

/**
 * Render oficial del PDF de una factura. Lo comparten la ruta `/api/pdf/factura/[id]` y la tool MCP
 * del enlace firmado: quien llama es responsable de haber comprobado que la fila es del negocio.
 */
export async function renderFacturaPdf(
  supabase: EmpresaLoaderClient,
  businessId: string,
  fac: FacturaPdfRow
): Promise<RenderFacturaPdfResult> {
  const emisor = await loadEmpresaEmisor(supabase, businessId);
  if (!emisor.ok) return { ok: false, error: emisor.error };
  return renderFacturaPdfConEmisor(emisor, fac);
}

export async function renderFacturaPdfConEmisor(
  emisor: { empresa: EmpresaEmisor; logoUrl: string | null },
  fac: FacturaPdfRow
): Promise<RenderFacturaPdfResult> {
  const createdAt = fac.created_at;
  const fechaFallback =
    createdAt && createdAt.length >= 10 ? createdAt.slice(0, 10) : new Date().toISOString().split('T')[0];
  const fecha = fac.fecha && String(fac.fecha).trim().length > 0 ? String(fac.fecha).trim() : fechaFallback;

  const baseImponible = numFromDb(fac.base_imponible);
  const ivaImporte = numFromDb(fac.iva);
  const total = numFromDb(fac.total);
  const porcentajeIva = baseImponible > 0 ? Math.round((ivaImporte / baseImponible) * 1000) / 10 : 21;

  const nRaw = fac.numero_factura;
  const numero_factura = nRaw != null && Number.isFinite(Number(nRaw)) ? Number(nRaw) : 0;

  const factura: FacturaPdfProps['factura'] = {
    id: String(fac.id ?? ''),
    numero_factura,
    fecha,
    fecha_operacion: null,
    cliente_nombre: String(fac.cliente_nombre ?? '—'),
    cliente_nif: fac.cliente_nif ?? undefined,
    cliente_direccion: fac.cliente_direccion ?? undefined,
    lineas: parseFacturaLineas(fac.lineas),
    base_imponible: baseImponible,
    iva: ivaImporte,
    total: total > 0 ? total : Math.round((baseImponible + ivaImporte) * 100) / 100,
    observaciones: fac.observaciones ?? undefined,
  };

  const buffer = await renderToBuffer(
    <FacturaPdfDocument
      factura={factura}
      logoUrl={emisor.logoUrl}
      empresa={emisor.empresa}
      porcentajeIva={porcentajeIva}
    />
  );
  return { ok: true, buffer, fecha, numero_factura };
}
