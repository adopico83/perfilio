import type { McpContext } from '@/lib/mcp/context';
import type { EmpresaLoaderClient } from '@/lib/pdf/empresa';
import type { PresupuestoPdfRow } from '@/lib/pdf/presupuesto-render';
import { MSG_NO_ENCONTRADO, esPresupuestoConfirmado } from '@/lib/presupuestos/lectura';

export const DIAS_VALIDEZ_DEFECTO = 7;
export const DIAS_VALIDEZ_MAX = 30;

const BUCKET = 'presupuestos-pdf';
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorEnlace = {
  ok: false;
  code: 'validacion' | 'no_encontrado' | 'no_confirmado' | 'error';
  error: string;
};

export type EnlacePdfOk = {
  ok: true;
  url: string;
  expira_en: string;
  dias_validez: number;
  presupuesto_id: string;
  numero_presupuesto: number | null;
  cliente_nombre: string | null;
};

type FilaEnlace = PresupuestoPdfRow & {
  id: string;
  estado: string | null;
  preview_id: string | null;
  numero_presupuesto: number | null;
  cliente_nombre: string | null;
};

const validacion = (error: string): ErrorEnlace => ({ ok: false, code: 'validacion', error });

function mensajeStorage(message: string): string {
  return /bucket/i.test(message) || /not found/i.test(message)
    ? `${message} (puede que el bucket ${BUCKET} aún no exista: aplica la migración).`
    : message;
}

/**
 * Genera el PDF oficial de un presupuesto confirmado del negocio de la conexión, lo sube al
 * bucket privado `presupuestos-pdf` y devuelve un enlace firmado y temporal. El business_id
 * sale siempre del contexto, nunca de los argumentos.
 */
export async function obtenerEnlacePdfPresupuesto(
  ctx: McpContext,
  args: Record<string, unknown>,
  now: Date = new Date()
): Promise<EnlacePdfOk | ErrorEnlace> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const numeroRaw = args.numero;
  const numero =
    typeof numeroRaw === 'number'
      ? numeroRaw
      : typeof numeroRaw === 'string' && /^\d+$/.test(numeroRaw.trim())
        ? Number(numeroRaw.trim())
        : null;

  if (!id && numero == null) return validacion('Indica id (uuid) o numero del presupuesto.');
  if (id && !RE_UUID.test(id)) return validacion('id no es un uuid válido.');
  if (!id && (numero == null || !Number.isInteger(numero))) {
    return validacion('numero debe ser un número entero.');
  }

  const dias = args.dias_validez == null ? DIAS_VALIDEZ_DEFECTO : args.dias_validez;
  if (
    typeof dias !== 'number' ||
    !Number.isInteger(dias) ||
    dias < 1 ||
    dias > DIAS_VALIDEZ_MAX
  ) {
    return validacion(
      `dias_validez debe ser un número entero de días entre 1 y ${DIAS_VALIDEZ_MAX} (por defecto ${DIAS_VALIDEZ_DEFECTO}).`
    );
  }

  // Import diferido: @react-pdf/renderer es pesado y solo hace falta al generar el PDF.
  const { PRESUPUESTO_PDF_COLUMNS, nombreArchivoPresupuestoPdf, renderPresupuestoPdf } = await import(
    '@/lib/pdf/presupuesto-render'
  );

  let query = ctx.supabase
    .from('presupuestos')
    .select(`${PRESUPUESTO_PDF_COLUMNS}, estado, preview_id`)
    .eq('business_id', ctx.businessId);
  query = id ? query.eq('id', id) : query.eq('numero_presupuesto', numero);

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, code: 'error', error: error.message };
  if (!data) return { ok: false, code: 'no_encontrado', error: MSG_NO_ENCONTRADO };

  const row = data as unknown as FilaEnlace;
  if (!esPresupuestoConfirmado(row)) {
    return {
      ok: false,
      code: 'no_confirmado',
      error:
        'Solo se puede enlazar el PDF de presupuestos confirmados. Confirma antes el presupuesto (confirmar_presupuesto).',
    };
  }

  const rendered = await renderPresupuestoPdf(
    ctx.supabase as unknown as EmpresaLoaderClient,
    ctx.businessId,
    row
  );
  if (!rendered.ok) return { ok: false, code: 'error', error: rendered.error };

  const path = `${ctx.businessId}/${row.id}.pdf`;
  const { error: upErr } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, rendered.buffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) return { ok: false, code: 'error', error: mensajeStorage(upErr.message) };

  const segundos = dias * 86400;
  const { data: firmado, error: signErr } = await ctx.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, segundos, { download: nombreArchivoPresupuestoPdf(rendered.fecha) });
  if (signErr || !firmado?.signedUrl) {
    return { ok: false, code: 'error', error: signErr?.message ?? 'No se pudo firmar la URL.' };
  }

  return {
    ok: true,
    url: firmado.signedUrl,
    expira_en: new Date(now.getTime() + segundos * 1000).toISOString(),
    dias_validez: dias,
    presupuesto_id: row.id,
    numero_presupuesto: row.numero_presupuesto ?? null,
    cliente_nombre: row.cliente_nombre ?? null,
  };
}
