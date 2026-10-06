import type { McpContext } from '@/lib/mcp/context';
import { crearFacturaDesdePresupuesto } from '@/lib/facturas/desde-presupuesto';
import type { EmpresaLoaderClient } from '@/lib/pdf/empresa';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'facturas-pdf';
export const DIAS_VALIDEZ_FACTURA_DEFECTO = 7;
export const DIAS_VALIDEZ_FACTURA_MAX = 30;

type ErrorTool = { ok: false; code: string; error: string };
const validacion = (error: string): ErrorTool => ({ ok: false, code: 'validacion', error });

function numeroEntero(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/** `crear_factura_desde_presupuesto`: id (uuid) o numero del presupuesto del negocio de la conexión. */
export async function crearFacturaDesdePresupuestoMcp(
  ctx: McpContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const numero = numeroEntero(args.numero);
  if (!id && numero == null) return validacion('Indica id (uuid) o numero del presupuesto.');
  if (id && !RE_UUID.test(id)) return validacion('id no es un uuid válido.');
  if (!id && (numero == null || !Number.isInteger(numero))) {
    return validacion('numero debe ser un número entero.');
  }

  let presupuestoId = id;
  if (!presupuestoId) {
    const { data, error } = await ctx.supabase
      .from('presupuestos')
      .select('id')
      .eq('business_id', ctx.businessId)
      .eq('numero_presupuesto', numero)
      .maybeSingle();
    if (error) return { ok: false, code: 'error', error: error.message };
    if (!data?.id) return { ok: false, code: 'no_encontrado', error: 'Presupuesto no encontrado' };
    presupuestoId = data.id as string;
  }

  return crearFacturaDesdePresupuesto(ctx.supabase, ctx.businessId, presupuestoId);
}

/** `obtener_enlace_pdf_factura`: PDF de una factura del negocio, subido a `facturas-pdf` y firmado. */
export async function obtenerEnlacePdfFactura(
  ctx: McpContext,
  args: Record<string, unknown>,
  now: Date = new Date()
): Promise<unknown> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const numero = numeroEntero(args.numero);
  if (!id && numero == null) return validacion('Indica id (uuid) o numero de la factura.');
  if (id && !RE_UUID.test(id)) return validacion('id no es un uuid válido.');
  if (!id && (numero == null || !Number.isInteger(numero))) {
    return validacion('numero debe ser un número entero.');
  }

  const dias = args.dias_validez == null ? DIAS_VALIDEZ_FACTURA_DEFECTO : args.dias_validez;
  if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 1 || dias > DIAS_VALIDEZ_FACTURA_MAX) {
    return validacion(
      `dias_validez debe ser un número entero de días entre 1 y ${DIAS_VALIDEZ_FACTURA_MAX} (por defecto ${DIAS_VALIDEZ_FACTURA_DEFECTO}).`
    );
  }

  // Import diferido: @react-pdf/renderer es pesado y solo hace falta al generar el PDF.
  const { FACTURA_PDF_COLUMNS, nombreArchivoFacturaPdf, renderFacturaPdf } = await import(
    '@/lib/pdf/factura-render'
  );

  let query = ctx.supabase.from('facturas').select(FACTURA_PDF_COLUMNS).eq('business_id', ctx.businessId);
  query = id ? query.eq('id', id) : query.eq('numero_factura', numero);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, code: 'error', error: error.message };
  if (!data) return { ok: false, code: 'no_encontrado', error: 'Factura no encontrada' };
  const row = data as unknown as { id: string; numero_factura: number | null; cliente_nombre: string | null };

  const rendered = await renderFacturaPdf(
    ctx.supabase as unknown as EmpresaLoaderClient,
    ctx.businessId,
    data as never
  );
  if (!rendered.ok) return { ok: false, code: 'error', error: rendered.error };

  const path = `${ctx.businessId}/${row.id}.pdf`;
  const { error: upErr } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, rendered.buffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    const hint = /bucket|not found/i.test(upErr.message)
      ? ` (puede que el bucket ${BUCKET} aún no exista: aplica la migración).`
      : '';
    return { ok: false, code: 'error', error: upErr.message + hint };
  }

  const segundos = dias * 86400;
  const { data: firmado, error: signErr } = await ctx.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, segundos, {
      download: nombreArchivoFacturaPdf(rendered.fecha, rendered.numero_factura),
    });
  if (signErr || !firmado?.signedUrl) {
    return { ok: false, code: 'error', error: signErr?.message ?? 'No se pudo firmar la URL.' };
  }

  return {
    ok: true,
    url: firmado.signedUrl,
    expira_en: new Date(now.getTime() + segundos * 1000).toISOString(),
    dias_validez: dias,
    factura_id: row.id,
    numero_factura: row.numero_factura ?? null,
    cliente_nombre: row.cliente_nombre ?? null,
  };
}
