import type { SupabaseClient } from '@supabase/supabase-js';
import { insertarFacturaConNumeroCorrelativo } from '@/lib/facturas/numero';
import {
  DIAS_VENCIMIENTO_FACTURA,
  hoyMadrid,
  sumarDiasYmd,
  type LineaFactura,
} from '@/lib/facturas/desde-presupuesto';
import { IVA_PORCENTAJES_PERMITIDOS } from '@/lib/facturas/editar';

export type CodigoErrorAlbaran = 'validacion' | 'no_encontrado' | 'facturado_sin_factura' | 'error';

export type ResultadoFacturaAlbaran =
  | {
      ok: true;
      factura_id: string;
      numero_factura: number;
      total: number;
      cliente_nombre: string | null;
      ya_existia: boolean;
      /** Algo no salió del todo bien aunque la factura existe (p. ej. no se pudo marcar el albarán). */
      aviso?: string;
    }
  | { ok: false; code: CodigoErrorAlbaran; error: string };

type Fila = Record<string, unknown>;

const redondear = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s || null;
}

const COLUMNAS_FACTURA = 'id, numero_factura, total, cliente_nombre';

function existente(f: Fila, aviso?: string): ResultadoFacturaAlbaran {
  return {
    ...(aviso ? { aviso } : {}),
    ok: true,
    factura_id: String(f.id),
    numero_factura: num(f.numero_factura),
    total: num(f.total),
    cliente_nombre: texto(f.cliente_nombre),
    ya_existia: true,
  };
}

/** Líneas del albarán (array jsonb) normalizadas; [] si no hay o no se entienden. */
function lineasDelAlbaran(raw: unknown): LineaFactura[] {
  if (!Array.isArray(raw)) return [];
  const lineas: LineaFactura[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return [];
    const r = item as Fila;
    const descripcion = texto(r.descripcion) ?? texto(r.concepto) ?? texto(r.texto);
    if (!descripcion) return [];
    const cantidad = r.cantidad == null ? 1 : num(r.cantidad);
    let precio = num(r.precio_unitario ?? r.precio);
    if (!precio && r.importe != null && cantidad > 0) precio = redondear(num(r.importe) / cantidad);
    lineas.push({
      descripcion,
      cantidad,
      unidad: texto(r.unidad),
      precio_unitario: precio,
      importe: redondear(cantidad * precio),
      capitulo: texto(r.capitulo),
    });
  }
  return lineas;
}

/**
 * Crea la factura de un albarán del negocio. La usan la API de la pantalla de albaranes y la tool
 * `convertir_albaran_a_factura` del agente, para que las dos hagan exactamente lo mismo.
 *
 * - `albaranes.total` se trata como IVA INCLUIDO: base = total / (1 + iva/100).
 * - Suma los extras aceptados del cliente (igual que hacía el agente).
 * - Es idempotente: si el albarán ya tiene factura, la devuelve con `ya_existia: true`.
 */
export async function crearFacturaDesdeAlbaran(
  supabase: SupabaseClient,
  businessId: string,
  albaranId: string,
  opciones: { iva_porcentaje?: number; observaciones?: string | null } = {},
  now: Date = new Date()
): Promise<ResultadoFacturaAlbaran> {
  const fallo = (code: CodigoErrorAlbaran, error: string): ResultadoFacturaAlbaran => ({ ok: false, code, error });

  const ivaPct = opciones.iva_porcentaje ?? 21;
  if (!(IVA_PORCENTAJES_PERMITIDOS as readonly number[]).includes(ivaPct)) {
    return fallo('validacion', `El IVA debe ser uno de: ${IVA_PORCENTAJES_PERMITIDOS.join(', ')}`);
  }
  if (!albaranId.trim()) return fallo('validacion', 'albaran_id es obligatorio');

  const { data: albData, error: albErr } = await supabase
    .from('albaranes')
    .select(
      'id, numero_albaran, estado, cliente_nombre, cliente_id, cliente_direccion, obra_id, descripcion_trabajos, lineas, total'
    )
    .eq('id', albaranId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (albErr) return fallo('error', albErr.message);
  if (!albData) return fallo('no_encontrado', 'Albarán no encontrado');
  const alb = albData as Fila;

  // Idempotencia: si ya tiene factura, esa es la respuesta (y el albarán queda facturado).
  const { data: previa, error: previaErr } = await supabase
    .from('facturas')
    .select(COLUMNAS_FACTURA)
    .eq('business_id', businessId)
    .eq('albaran_id', albaranId)
    .maybeSingle();
  if (previaErr) return fallo('error', previaErr.message);
  if (previa) {
    let aviso: string | undefined;
    if (String(alb.estado ?? '').toLowerCase() !== 'facturado') {
      const fallo = await marcarFacturado(supabase, businessId, albaranId);
      if (fallo) aviso = avisoNoMarcado(previa as Fila, fallo);
    }
    return existente(previa as Fila, aviso);
  }
  if (String(alb.estado ?? '').toLowerCase() === 'facturado') {
    return fallo(
      'facturado_sin_factura',
      'El albarán figura como facturado pero no hay ninguna factura vinculada. Revísalo en Facturas.'
    );
  }

  // Extras aceptados del mismo cliente.
  const clienteNombre = String(alb.cliente_nombre ?? '').trim();
  const clienteId = texto(alb.cliente_id);
  let extras: Fila[] = [];
  if (clienteId || clienteNombre) {
    let q = supabase
      .from('presupuestos')
      .select('importe_total, presupuesto_generado, mensaje_cliente')
      .eq('business_id', businessId)
      .eq('es_extra', true)
      .eq('estado', 'aceptado');
    q = clienteId ? q.eq('cliente_id', clienteId) : q.ilike('cliente_nombre', clienteNombre);
    const { data: exData, error: exErr } = await q;
    if (exErr) return fallo('error', exErr.message);
    extras = (exData ?? []) as Fila[];
  }
  let extrasSum = 0;
  const extraLineas: string[] = [];
  for (const ex of extras) {
    const imp = num(ex.importe_total);
    extrasSum += imp;
    const t = texto(ex.presupuesto_generado) ?? texto(ex.mensaje_cliente) ?? 'Extra';
    extraLineas.push(`- ${t} (${redondear(imp).toFixed(2)} €)`);
  }

  const totalConExtras = redondear(num(alb.total) + extrasSum);
  const base = redondear(totalConExtras / (1 + ivaPct / 100));
  const iva = redondear(totalConExtras - base);

  let descripcion = texto(alb.descripcion_trabajos) ?? '';
  if (extraLineas.length > 0) {
    const bloque = `Extras aceptados (importes con IVA incluido):\n${extraLineas.join('\n')}`;
    descripcion = descripcion ? `${descripcion}\n\n${bloque}` : bloque;
  }

  // Líneas: las del albarán solo si encajan con la base (sin extras); si no, una sola línea coherente.
  const delAlbaran = lineasDelAlbaran(alb.lineas);
  const sumaLineas = redondear(delAlbaran.reduce((s, l) => s + l.importe, 0));
  const usarLineasAlbaran =
    delAlbaran.length > 0 && extras.length === 0 && Math.abs(sumaLineas - base) <= 0.05;
  const numero = texto(alb.numero_albaran);
  const lineas: LineaFactura[] = usarLineasAlbaran
    ? delAlbaran
    : [
        {
          descripcion: numero ? `Trabajos según albarán nº ${numero}` : 'Trabajos según albarán',
          cantidad: 1,
          unidad: null,
          precio_unitario: base,
          importe: base,
          capitulo: null,
        },
      ];

  const fecha = hoyMadrid(now);
  const observaciones = texto(opciones.observaciones) ?? 'Generada desde albarán';
  const ins = await insertarFacturaConNumeroCorrelativo(
    supabase,
    businessId,
    {
      albaran_id: albaranId,
      cliente_nombre: clienteNombre || null,
      cliente_id: clienteId,
      cliente_direccion: texto(alb.cliente_direccion),
      obra_id: texto(alb.obra_id),
      descripcion_trabajos: descripcion || null,
      lineas,
      base_imponible: base,
      iva,
      total: totalConExtras,
      fecha,
      fecha_vencimiento: sumarDiasYmd(fecha, DIAS_VENCIMIENTO_FACTURA),
      estado: 'pendiente',
      observaciones,
    },
    COLUMNAS_FACTURA
  );

  if (!ins.ok) {
    if (ins.conflictoAlbaran) {
      // Otra llamada se nos adelantó: devolvemos su factura.
      const { data: otra } = await supabase
        .from('facturas')
        .select(COLUMNAS_FACTURA)
        .eq('business_id', businessId)
        .eq('albaran_id', albaranId)
        .maybeSingle();
      if (otra) return existente(otra as Fila);
    }
    return fallo('error', ins.error);
  }

  // La factura YA existe. Si falla marcar el albarán no se devuelve error (el usuario creería que no
  // se creó): se devuelve la factura con un aviso. Al reintentar se encuentra la factura previa,
  // se vuelve a intentar marcar el albarán y no se crea otra (índice uq_facturas_albaran_id).
  const marcado = await marcarFacturado(supabase, businessId, albaranId);
  const f = ins.data;
  const aviso = marcado ? avisoNoMarcado(f, marcado) : undefined;
  return {
    ...(aviso ? { aviso } : {}),
    ok: true,
    factura_id: String(f.id),
    numero_factura: num(f.numero_factura),
    total: f.total != null ? num(f.total) : totalConExtras,
    cliente_nombre: texto(f.cliente_nombre) ?? (clienteNombre || null),
    ya_existia: false,
  };
}

/** Devuelve el mensaje de error o null si fue bien. */
async function marcarFacturado(supabase: SupabaseClient, businessId: string, albaranId: string): Promise<string | null> {
  const { error } = await supabase
    .from('albaranes')
    .update({ estado: 'facturado' })
    .eq('id', albaranId)
    .eq('business_id', businessId);
  return error ? error.message : null;
}

function avisoNoMarcado(factura: Fila, motivo: string): string {
  const mensaje = `Factura nº ${factura.numero_factura ?? ''} creada, pero el albarán no se pudo marcar como facturado. Vuelve a pulsar "Marcar facturado": no se creará otra factura.`;
  console.warn('[facturas/desde-albaran] no se pudo marcar el albarán como facturado:', motivo);
  return mensaje;
}
