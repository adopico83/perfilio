import type { SupabaseClient } from '@supabase/supabase-js';
import {
  escapeIlikeGrounding,
  failClosed,
  pedirAclaracion,
  type CandidatoGrounding,
  type ResolveResult,
  type ToolFailClosed,
} from '@/lib/agente/modules/grounding';

/**
 * Localiza una factura o un albarán DEL NEGOCIO por id, por número o por cliente, para que el usuario
 * no tenga que decir UUIDs («marca la factura 3 como pagada», «factúrame el albarán de García»).
 * Siempre filtra por business_id: un número de otro negocio nunca se resuelve.
 */

export type TipoDocumento = 'factura' | 'albaran';

export type DocumentoMatch = {
  id: string;
  nombre: string | null; // cliente
  numero: string | number | null;
  total: number | null;
  estado: string | null;
};

const CONFIG: Record<TipoDocumento, { tabla: string; colNumero: string; colId: string; etiqueta: string; plural: string }> = {
  factura: { tabla: 'facturas', colNumero: 'numero_factura', colId: 'id', etiqueta: 'factura', plural: 'facturas' },
  albaran: { tabla: 'albaranes', colNumero: 'numero_albaran', colId: 'id', etiqueta: 'albarán', plural: 'albaranes' },
};

function aNumeroEntero(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return n > 0 ? n : null;
  }
  return null;
}

type Fila = Record<string, unknown>;

function aMatch(tipo: TipoDocumento, f: Fila): DocumentoMatch {
  const total = f.total == null ? null : Number(f.total);
  return {
    id: String(f.id),
    nombre: typeof f.cliente_nombre === 'string' ? f.cliente_nombre : null,
    numero: (f[CONFIG[tipo].colNumero] as string | number | null | undefined) ?? null,
    total: total != null && Number.isFinite(total) ? total : null,
    estado: typeof f.estado === 'string' ? f.estado : null,
  };
}

export async function localizarDocumento(
  supabase: SupabaseClient,
  businessId: string,
  tipo: TipoDocumento,
  opts: { id?: unknown; numero?: unknown; cliente?: unknown; excluirEstado?: string }
): Promise<ResolveResult<DocumentoMatch>> {
  const cfg = CONFIG[tipo];
  const columnas = `id, ${cfg.colNumero}, cliente_nombre, total, estado`;
  const id = String(opts.id ?? '').trim();
  const numero = aNumeroEntero(opts.numero);

  // Por id (viene de una consulta anterior, o del navegador tras confirmar) o por número: siempre dentro del negocio.
  if (id) {
    const { data, error } = await supabase
      .from(cfg.tabla)
      .select(columnas)
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return { status: 'none' };
    return { status: 'one', match: aMatch(tipo, data as unknown as Fila) };
  }
  if (numero != null) {
    const { data, error } = await supabase
      .from(cfg.tabla)
      .select(columnas)
      .eq('business_id', businessId)
      .eq(cfg.colNumero, numero)
      .limit(2);
    if (error || !data || data.length === 0) return { status: 'none' };
    const filas = (data as unknown as Fila[]).map((f) => aMatch(tipo, f));
    return filas.length === 1 ? { status: 'one', match: filas[0] } : { status: 'many', candidatos: filas };
  }

  const cliente = String(opts.cliente ?? '').trim();
  const safe = escapeIlikeGrounding(cliente).slice(0, 120);
  if (!safe) return { status: 'none' };
  let q = supabase
    .from(cfg.tabla)
    .select(columnas)
    .eq('business_id', businessId)
    .ilike('cliente_nombre', `%${safe}%`)
    .order('created_at', { ascending: false })
    .limit(10);
  if (opts.excluirEstado) q = q.neq('estado', opts.excluirEstado);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return { status: 'none' };
  const filas = (data as unknown as Fila[]).map((f) => aMatch(tipo, f));
  return filas.length === 1 ? { status: 'one', match: filas[0] } : { status: 'many', candidatos: filas };
}

function euros(n: number | null): string {
  return n == null ? 'sin importe' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' }).format(n)} €`;
}

/** «factura nº 3 de García (1.210 €)» */
export function describirDocumento(tipo: TipoDocumento, m: DocumentoMatch): string {
  const num = m.numero != null && String(m.numero).trim() ? ` nº ${m.numero}` : '';
  return `${CONFIG[tipo].etiqueta}${num} de ${m.nombre ?? 'sin cliente'} (${euros(m.total)})`;
}

/** Resultado listo para devolver al modelo/usuario si no hay UN documento claro. */
export function falloDesdeLocalizar(
  tipo: TipoDocumento,
  resolved: ResolveResult<DocumentoMatch>,
  etiquetaBuscada: string
): { ok: true; match: DocumentoMatch } | ToolFailClosed {
  const cfg = CONFIG[tipo];
  if (resolved.status === 'none') {
    return failClosed(`No encuentro ninguna ${cfg.etiqueta} para «${etiquetaBuscada}». Dime el número o el cliente.`);
  }
  if (resolved.status === 'many') {
    const cands: CandidatoGrounding[] = resolved.candidatos.map((m) => ({
      id: m.id,
      etiqueta: `${describirDocumento(tipo, m)} · ${m.estado ?? '—'}`,
    }));
    const lista = cands.slice(0, 8).map((c, i) => `${i + 1}. ${c.etiqueta}`).join('\n');
    return pedirAclaracion(`Hay varias ${cfg.plural} que encajan. ¿Cuál es?\n${lista}`, cands);
  }
  return { ok: true, match: resolved.match };
}

/**
 * Atajo: de los args del modelo (id / numero / cliente) a un documento claro o un fallo con pregunta.
 * Ojo: en las tools de EDICIÓN `cliente_nombre` es el valor NUEVO, no un localizador; aquí solo se mira `cliente`. */
export async function localizarDesdeArgs(
  supabase: SupabaseClient,
  businessId: string,
  tipo: TipoDocumento,
  args: Record<string, unknown>,
  opciones: { excluirEstado?: string } = {}
): Promise<{ ok: true; match: DocumentoMatch } | ToolFailClosed> {
  const idArg = args.id ?? (tipo === 'albaran' ? args.albaran_id : args.factura_id);
  const etiqueta =
    String(idArg ?? '').trim() ||
    (args.numero != null && String(args.numero).trim() ? `nº ${String(args.numero).trim()}` : '') ||
    String(args.cliente ?? '').trim();
  if (!etiqueta) {
    return failClosed(`¿Qué ${CONFIG[tipo].etiqueta}? Dime el número o el cliente.`);
  }
  const resolved = await localizarDocumento(supabase, businessId, tipo, {
    id: idArg,
    numero: args.numero,
    cliente: args.cliente,
    excluirEstado: opciones.excluirEstado,
  });
  return falloDesdeLocalizar(tipo, resolved, etiqueta);
}
