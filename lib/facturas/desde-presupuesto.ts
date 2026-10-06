import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { insertarFacturaConNumeroCorrelativo } from '@/lib/facturas/numero';
import { ESTADOS_FACTURABLES } from '@/lib/presupuestos/estado';

/** Días entre la fecha de la factura y su vencimiento. */
export const DIAS_VENCIMIENTO_FACTURA = 30;
const IVA_POR_DEFECTO = 21;

/** Línea de factura tal y como se guarda en `facturas.lineas` y la lee el PDF. */
export type LineaFactura = {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number;
  importe: number;
  capitulo: string | null;
};

export type CodigoErrorFactura =
  | 'no_encontrado'
  | 'estado_invalido'
  | 'facturado_sin_factura'
  | 'sin_lineas'
  | 'cliente_incompleto'
  | 'error';

export type ResultadoFactura =
  | {
      ok: true;
      factura_id: string;
      numero_factura: number;
      total: number;
      cliente_nombre: string | null;
      ya_existia: boolean;
    }
  | { ok: false; code: CodigoErrorFactura; error: string; cliente_id?: string | null };

const redondear = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

/** Fecha de hoy en Madrid (AAAA-MM-DD). */
export function hoyMadrid(now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function sumarDiasYmd(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * 86_400_000).toISOString().slice(0, 10);
}

function linea(
  descripcion: unknown,
  cantidad: unknown,
  unidad: unknown,
  precio: unknown,
  capitulo: unknown
): LineaFactura {
  const c = num(cantidad);
  const p = num(precio);
  return {
    descripcion: texto(descripcion) ?? '—',
    cantidad: c,
    unidad: texto(unidad),
    precio_unitario: p,
    importe: redondear(c * p),
    capitulo: texto(capitulo),
  };
}

type Fila = Record<string, unknown>;

/**
 * Líneas del presupuesto, por orden de preferencia:
 *  (a) borrador editable (`presupuesto_borrador_items`),
 *  (b) partidas de la previsualización MCP (`presupuesto_previews.partidas`),
 *  (c) el texto guardado en `presupuesto_generado`.
 * También devuelve el IVA % de la misma fuente cuando lo tiene.
 */
async function cargarLineas(
  supabase: SupabaseClient,
  businessId: string,
  pres: Fila
): Promise<{ lineas: LineaFactura[]; iva: number | null; error?: string }> {
  const presupuestoId = String(pres.id);

  // (a) borrador
  const { data: bor, error: borErr } = await supabase
    .from('presupuesto_borrador')
    .select('id, iva_porcentaje')
    .eq('presupuesto_id', presupuestoId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (borErr) return { lineas: [], iva: null, error: borErr.message };
  if (bor?.id) {
    const { data: items, error: itemsErr } = await supabase
      .from('presupuesto_borrador_items')
      .select('orden, capitulo, descripcion, cantidad, unidad, precio_unitario, importe')
      .eq('borrador_id', bor.id as string)
      .order('orden', { ascending: true });
    if (itemsErr) return { lineas: [], iva: null, error: itemsErr.message };
    const filas = (items ?? []) as Fila[];
    if (filas.length > 0) {
      const iva = (bor as Fila).iva_porcentaje;
      return {
        lineas: filas.map((i) => linea(i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.capitulo)),
        iva: iva == null ? null : num(iva),
      };
    }
  }

  // (b) previsualización MCP
  const previewId = texto(pres.preview_id);
  if (previewId) {
    const { data: prev, error: prevErr } = await supabase
      .from('presupuesto_previews')
      .select('partidas, iva_porcentaje')
      .eq('id', previewId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (prevErr) return { lineas: [], iva: null, error: prevErr.message };
    const partidas = Array.isArray((prev as Fila | null)?.partidas) ? ((prev as Fila).partidas as Fila[]) : [];
    if (partidas.length > 0) {
      const iva = (prev as Fila).iva_porcentaje;
      return {
        lineas: partidas.map((p) => linea(p.concepto, p.cantidad, p.unidad, p.precio, p.capitulo)),
        iva: iva == null ? null : num(iva),
      };
    }
  }

  // (c) texto generado
  const parsed = parsePresupuestoGenerado(String(pres.presupuesto_generado ?? ''));
  const lineas: LineaFactura[] = [];
  for (const cap of parsed.capitulos) {
    for (const p of cap.partidas) lineas.push(linea(p.concepto, p.cantidad, null, p.precio, cap.nombre));
  }
  return { lineas, iva: parsed.porcentajeIva > 0 ? parsed.porcentajeIva : null };
}

const COLUMNAS_FACTURA = 'id, numero_factura, total, cliente_nombre';

async function facturaDePresupuesto(
  supabase: SupabaseClient,
  businessId: string,
  presupuestoId: string
): Promise<{ fila: Fila | null; error?: string }> {
  const { data, error } = await supabase
    .from('facturas')
    .select(COLUMNAS_FACTURA)
    .eq('business_id', businessId)
    .eq('presupuesto_id', presupuestoId)
    .maybeSingle();
  if (error) return { fila: null, error: error.message };
  return { fila: (data as Fila | null) ?? null };
}

function resultadoExistente(f: Fila): ResultadoFactura {
  return {
    ok: true,
    factura_id: String(f.id),
    numero_factura: num(f.numero_factura),
    total: num(f.total),
    cliente_nombre: texto(f.cliente_nombre),
    ya_existia: true,
  };
}

/**
 * Crea la factura de un presupuesto aceptado/aprobado del negocio. La usan el agente, la API de la
 * pantalla de presupuestos y la tool MCP, para que las tres hagan exactamente lo mismo.
 * Es idempotente: si ya hay factura de ese presupuesto la devuelve con `ya_existia: true`.
 */
export async function crearFacturaDesdePresupuesto(
  supabase: SupabaseClient,
  businessId: string,
  presupuestoId: string,
  now: Date = new Date()
): Promise<ResultadoFactura> {
  const fallo = (code: CodigoErrorFactura, error: string, cliente_id?: string | null): ResultadoFactura => ({
    ok: false,
    code,
    error,
    ...(cliente_id !== undefined ? { cliente_id } : {}),
  });

  const { data: presData, error: presErr } = await supabase
    .from('presupuestos')
    .select('id, estado, cliente_nombre, cliente_id, obra_id, preview_id, presupuesto_generado')
    .eq('id', presupuestoId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (presErr) return fallo('error', presErr.message);
  if (!presData) return fallo('no_encontrado', 'Presupuesto no encontrado');
  const pres = presData as Fila;

  // Idempotencia: si ya tiene factura, esa es la respuesta.
  const previa = await facturaDePresupuesto(supabase, businessId, presupuestoId);
  if (previa.error) return fallo('error', previa.error);
  if (previa.fila) return resultadoExistente(previa.fila);

  const estado = String(pres.estado ?? '').trim().toLowerCase();
  if (estado === 'facturado') {
    return fallo(
      'facturado_sin_factura',
      'El presupuesto figura como facturado pero no hay ninguna factura vinculada. Revísalo en Facturas.'
    );
  }
  if (!ESTADOS_FACTURABLES.includes(estado)) {
    return fallo('estado_invalido', 'Solo se puede facturar un presupuesto aceptado o aprobado.');
  }

  // Cliente con NIF y dirección (obligatorios en una factura).
  const clienteId = texto(pres.cliente_id);
  const msgCliente = 'No puedo generar la factura: el cliente no tiene NIF o dirección configurados.';
  if (!clienteId) return fallo('cliente_incompleto', msgCliente, null);
  const { data: cli, error: cliErr } = await supabase
    .from('clientes')
    .select('id, nif, direccion')
    .eq('id', clienteId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (cliErr) return fallo('error', cliErr.message);
  const nif = texto((cli as Fila | null)?.nif);
  const direccion = texto((cli as Fila | null)?.direccion);
  if (!nif || !direccion) return fallo('cliente_incompleto', msgCliente, clienteId);

  const { lineas, iva: ivaFuente, error: lineasErr } = await cargarLineas(supabase, businessId, pres);
  if (lineasErr) return fallo('error', lineasErr);
  if (lineas.length === 0) {
    return fallo('sin_lineas', 'No se encontraron las líneas del presupuesto para generar la factura.');
  }

  const base = redondear(lineas.reduce((acc, l) => acc + l.importe, 0));
  const ivaPct = ivaFuente != null && Number.isFinite(ivaFuente) ? ivaFuente : IVA_POR_DEFECTO;
  const iva = redondear(base * (ivaPct / 100));
  const total = redondear(base + iva);
  const fecha = hoyMadrid(now);

  const ins = await insertarFacturaConNumeroCorrelativo(
    supabase,
    businessId,
    {
      cliente_nombre: texto(pres.cliente_nombre),
      cliente_direccion: direccion,
      cliente_nif: nif,
      cliente_id: clienteId,
      obra_id: texto(pres.obra_id),
      presupuesto_id: presupuestoId,
      albaran_id: null,
      lineas, // array real: `facturas.lineas` es jsonb
      base_imponible: base,
      iva,
      total,
      fecha,
      fecha_vencimiento: sumarDiasYmd(fecha, DIAS_VENCIMIENTO_FACTURA),
      estado: 'pendiente',
    },
    COLUMNAS_FACTURA
  );

  if (!ins.ok) {
    if (ins.conflictoPresupuesto) {
      // Otra llamada se nos adelantó: devolvemos su factura en vez de dar error.
      const otra = await facturaDePresupuesto(supabase, businessId, presupuestoId);
      if (otra.fila) return resultadoExistente(otra.fila);
    }
    return fallo('error', ins.error);
  }

  const { error: updErr } = await supabase
    .from('presupuestos')
    .update({ estado: 'facturado' })
    .eq('id', presupuestoId)
    .eq('business_id', businessId);
  if (updErr) return fallo('error', updErr.message);

  const f = ins.data;
  return {
    ok: true,
    factura_id: String(f.id),
    numero_factura: num(f.numero_factura),
    total: num(f.total),
    cliente_nombre: texto(f.cliente_nombre),
    ya_existia: false,
  };
}
