import { ymdHoyMadrid, ymdMadridDeTimestamp } from '@/lib/fechas-madrid';
import { renderToBuffer } from '@react-pdf/renderer';
import { loadEmpresaEmisor, type EmpresaEmisor, type EmpresaLoaderClient } from '@/lib/pdf/empresa';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { PresupuestoPdfDocument } from '@/lib/pdf/presupuesto';
import type { MarcaPdf } from '@/lib/pdf/marca';

/** Columnas de `presupuestos` que necesita el render oficial del PDF. */
export const PRESUPUESTO_PDF_COLUMNS =
  'id, business_id, presupuesto_generado, fecha, cliente_nombre, mensaje_cliente, obra_id, created_at, numero_presupuesto, obras(nombre)';

/** Nº legible desde `mensaje_cliente`: "Pre XX/YY" o "XX/YY"; si no, 8 primeros caracteres del id. */
function numeroPresupuestoDesdeMensaje(mensaje: string | null | undefined, id: string): string {
  const texto = String(mensaje ?? '');
  const conPre = texto.match(/Pre\s+\d{1,4}\/\d{1,4}/i);
  if (conPre) return conPre[0].replace(/\s+/g, ' ').trim();
  const solo = texto.match(/\b\d{1,4}\/\d{1,4}\b/);
  if (solo) return solo[0];
  const rid = String(id ?? '').trim();
  return rid.length > 0 ? rid.slice(0, 8) : '—';
}

export type PresupuestoPdfRow = {
  id?: unknown;
  presupuesto_generado?: string | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  mensaje_cliente?: string | null;
  created_at?: string;
  numero_presupuesto?: number | null;
  obras?: { nombre?: string } | { nombre?: string }[] | null;
};

export type RenderPresupuestoPdfResult =
  | { ok: true; buffer: Buffer; fecha: string }
  | { ok: false; error: string };

/**
 * Flujo oficial de render del PDF de un presupuesto (plantilla `PresupuestoPdfDocument`).
 * Lo comparten la route `/api/pdf/presupuesto/[id]` y la tool MCP del enlace firmado:
 * quien llama es responsable de haber comprobado que la fila es del negocio correcto.
 */
export async function renderPresupuestoPdf(
  supabase: EmpresaLoaderClient,
  businessId: string,
  pres: PresupuestoPdfRow
): Promise<RenderPresupuestoPdfResult> {
  const emisor = await loadEmpresaEmisor(supabase, businessId);
  if (!emisor.ok) return { ok: false, error: emisor.error };
  return renderPresupuestoPdfConEmisor(emisor, pres);
}

/** Datos del emisor ya resueltos (los de un negocio real o los del mock demo). */
export type EmisorPdf = { empresa: EmpresaEmisor; logoUrl: string | null; marca?: MarcaPdf };

/** Mismo render que `renderPresupuestoPdf`, sin consultar nada: el emisor llega resuelto. */
export async function renderPresupuestoPdfConEmisor(
  emisor: EmisorPdf,
  pres: PresupuestoPdfRow
): Promise<RenderPresupuestoPdfResult> {
  const texto = String(pres.presupuesto_generado ?? '');
  const parsed = parsePresupuestoGenerado(texto);

  const fechaRaw = pres.fecha;
  const createdAt = pres.created_at;
  const fechaFallback =
    ymdMadridDeTimestamp(createdAt) ?? ymdHoyMadrid();
  const fecha = fechaRaw && fechaRaw.trim().length > 0 ? fechaRaw.trim() : fechaFallback;

  const nCorr = pres.numero_presupuesto;
  const numero =
    nCorr != null && Number.isFinite(Number(nCorr))
      ? String(Number(nCorr))
      : numeroPresupuestoDesdeMensaje(pres.mensaje_cliente, String(pres.id ?? ''));

  const obraJoin = pres.obras;
  const obraNombre = Array.isArray(obraJoin) ? obraJoin[0]?.nombre : obraJoin?.nombre;
  const clienteNombre = pres.cliente_nombre;
  const referencia =
    (obraNombre && String(obraNombre).trim()) ||
    (clienteNombre && String(clienteNombre).trim()) ||
    '—';

  const buffer = await renderToBuffer(
    <PresupuestoPdfDocument
      logoUrl={emisor.logoUrl}
      empresa={emisor.empresa}
      numeroPresupuesto={numero}
      referencia={referencia}
      fecha={fecha}
      parsed={parsed}
      textoPlanoFallback={texto.trim() || '—'}
      marca={emisor.marca}
    />
  );

  return { ok: true, buffer, fecha };
}

/** Nombre de descarga estable del PDF. */
export function nombreArchivoPresupuestoPdf(fecha: string): string {
  return `presupuesto-${fecha.replace(/[^0-9-]/g, '')}.pdf`;
}
