import type { McpContext } from '@/lib/mcp/context';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import type { CapituloPresupuestoPdf } from '@/lib/pdf/types';

const ESTADOS_CONFIRMADOS = ['enviado', 'aceptado', 'aprobado', 'facturado'];
const LIMITE_DEFECTO = 20;
const LIMITE_MAX = 50;
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_PIE = /BASE\s+IMPONIBLE:/i;

const MSG_NO_ENCONTRADO = 'No se encontró ese presupuesto en este negocio.';

type ErrorLectura = { ok: false; code: 'validacion' | 'no_encontrado' | 'error'; error: string };

export type PresupuestoResumen = {
  id: string;
  numero_presupuesto: number | null;
  cliente_nombre: string | null;
  importe_total: number | string | null;
  estado: string | null;
  fecha: string | null;
  obra_id: string | null;
  confirmado: boolean;
};

export type PresupuestoDetalle = PresupuestoResumen & {
  created_at: string | null;
  capitulos: CapituloPresupuestoPdf[];
  /** Importe guardado en la base de datos, sin recalcular. */
  total: number | string | null;
  base_imponible: number | null;
  iva_porcentaje: number | null;
  iva_importe: number | null;
};

type FilaPresupuesto = {
  id: string;
  numero_presupuesto: number | null;
  cliente_nombre: string | null;
  importe_total: number | string | null;
  estado: string | null;
  fecha: string | null;
  obra_id: string | null;
  preview_id: string | null;
  presupuesto_generado?: string | null;
  created_at?: string | null;
};

/** Confirmado = salió de una previsualización aprobada (preview_id) o su estado ya no es borrador. */
export function esPresupuestoConfirmado(row: {
  estado?: string | null;
  preview_id?: string | null;
}): boolean {
  if (row.preview_id != null) return true;
  const estado = typeof row.estado === 'string' ? row.estado.trim().toLowerCase() : '';
  return ESTADOS_CONFIRMADOS.includes(estado);
}

function escapeIlikePattern(s: string): string {
  return s.replace(/[%_*]/g, '');
}

function texto(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function limiteLista(raw: unknown): number {
  if (raw == null || raw === '') return LIMITE_DEFECTO;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return LIMITE_DEFECTO;
  return Math.min(LIMITE_MAX, Math.max(1, Math.round(n)));
}

function resumen(row: FilaPresupuesto): PresupuestoResumen {
  return {
    id: row.id,
    numero_presupuesto: row.numero_presupuesto,
    cliente_nombre: row.cliente_nombre,
    importe_total: row.importe_total,
    estado: row.estado,
    fecha: row.fecha,
    obra_id: row.obra_id,
    confirmado: esPresupuestoConfirmado(row),
  };
}

/** Lista presupuestos del negocio con filtros opcionales. Solo lectura. */
export async function listarPresupuestos(
  ctx: McpContext,
  args: Record<string, unknown>
): Promise<{ ok: true; items: PresupuestoResumen[] } | ErrorLectura> {
  const desde = texto(args.desde);
  const hasta = texto(args.hasta);
  if (desde && !RE_YMD.test(desde)) {
    return { ok: false, code: 'validacion', error: 'La fecha «desde» no es válida. Usa AAAA-MM-DD.' };
  }
  if (hasta && !RE_YMD.test(hasta)) {
    return { ok: false, code: 'validacion', error: 'La fecha «hasta» no es válida. Usa AAAA-MM-DD.' };
  }

  let query = ctx.supabase
    .from('presupuestos')
    .select('id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha, obra_id, preview_id')
    .eq('business_id', ctx.businessId);

  const cliente = escapeIlikePattern(texto(args.cliente)).trim();
  if (cliente) query = query.ilike('cliente_nombre', `%${cliente}%`);
  const estado = texto(args.estado).toLowerCase();
  if (estado) query = query.eq('estado', estado);
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limiteLista(args.limite));
  if (error) return { ok: false, code: 'error', error: error.message };

  return { ok: true, items: ((data ?? []) as FilaPresupuesto[]).map(resumen) };
}

/** Detalle de un presupuesto del negocio, por id o por número. Solo lectura; no recalcula importes. */
export async function verPresupuesto(
  ctx: McpContext,
  args: Record<string, unknown>
): Promise<({ ok: true } & PresupuestoDetalle) | ErrorLectura> {
  const id = texto(args.id);
  const numeroRaw = args.numero;
  const numero =
    typeof numeroRaw === 'number'
      ? numeroRaw
      : typeof numeroRaw === 'string' && /^\d+$/.test(numeroRaw.trim())
        ? Number(numeroRaw.trim())
        : null;

  if (!id && numero == null) {
    return { ok: false, code: 'validacion', error: 'Indica id (uuid) o numero del presupuesto.' };
  }
  if (id && !RE_UUID.test(id)) {
    return { ok: false, code: 'validacion', error: 'id no es un uuid válido.' };
  }
  if (!id && (numero == null || !Number.isInteger(numero))) {
    return { ok: false, code: 'validacion', error: 'numero debe ser un número entero.' };
  }

  let query = ctx.supabase
    .from('presupuestos')
    .select(
      'id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha, obra_id, preview_id, presupuesto_generado, created_at'
    )
    .eq('business_id', ctx.businessId);
  query = id ? query.eq('id', id) : query.eq('numero_presupuesto', numero);

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, code: 'error', error: error.message };
  if (!data) return { ok: false, code: 'no_encontrado', error: MSG_NO_ENCONTRADO };

  const row = data as FilaPresupuesto;
  const generado = row.presupuesto_generado ?? '';
  const parsed = parsePresupuestoGenerado(generado);
  // El parser recalcula el pie si falta; solo se expone el que está escrito en el texto.
  const hayPie = RE_PIE.test(generado);

  return {
    ok: true,
    ...resumen(row),
    created_at: row.created_at ?? null,
    capitulos: parsed.capitulos,
    total: row.importe_total,
    base_imponible: hayPie ? parsed.baseImponible : null,
    iva_porcentaje: hayPie ? parsed.porcentajeIva : null,
    iva_importe: hayPie ? parsed.importeIva : null,
  };
}
