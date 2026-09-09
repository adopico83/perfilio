import type { SupabaseClient } from '@supabase/supabase-js';

/** Reglas de grounding para el system prompt (God File solo interpola). */
export const GROUNDING_REGLAS_SISTEMA = `GROUNDING (obligatorio, lenguaje de calle):
Pino habla natural, sin UUIDs.
CONSULTAS / LISTADOS («qué obras tengo abiertas», pendientes, fichas): usa buscar_* / listar_* y responde con lo encontrado. PROHIBIDO iniciar_borrador, crear_presupuesto, crear_obra o crear_cliente si no te lo han pedido. No cojas un cliente del contexto (p. ej. CLIENTES REGISTRADOS) para inventar un presupuesto.
MUTACIONES sobre cliente/obra/presupuesto existente: interpreta → busca con buscar_* / nombre real → 1 coincidencia usa ese ID; varias: pregunta en castellano cuál; cero: dilo y no sigas. No inventes, no crees ficha ni documento de paso.
Crear solo con tools crear_* (u iniciar_borrador) cuando pidan explícitamente un alta o un presupuesto NUEVO («haz un presupuesto para…»).
En la respuesta final SOLO afirma mutaciones que hayan vuelto en un TOOL RESULT con ok:true. Si la tool falló o no encontró, dilo; nunca narres éxito sobre IDs o nombres fantasma.`;

export type CandidatoGrounding = { id: string; etiqueta: string };

export type ResolveResult<T extends { id: string } = { id: string }> =
  | { status: 'none' }
  | { status: 'one'; match: T }
  | { status: 'many'; candidatos: T[] };

export type ToolFailClosed = {
  ok: false;
  error: string;
  necesita_aclaracion?: true;
  candidatos?: CandidatoGrounding[];
};

export function failClosed(
  error: string,
  extra?: { necesita_aclaracion?: true; candidatos?: CandidatoGrounding[] }
): ToolFailClosed {
  return { ok: false, error, ...extra };
}

export function pedirAclaracion(error: string, candidatos: CandidatoGrounding[]): ToolFailClosed {
  return {
    ok: false,
    error,
    necesita_aclaracion: true,
    candidatos,
  };
}

export function normalizarNombreComparable(s: string): string {
  return s
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function escapeIlikeGrounding(s: string): string {
  return s.replace(/[%_*]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** Mayor = más parecido. 100 = igual normalizado. */
export function scoreNombreMatch(candidato: string, needle: string): number {
  const d = normalizarNombreComparable(candidato);
  const n = normalizarNombreComparable(needle);
  if (!n || !d) return 0;
  if (d === n) return 100;
  if (d.startsWith(n) || n.startsWith(d)) return 85 - Math.abs(d.length - n.length) * 0.1;
  if (d.includes(n) || n.includes(d)) return 70;
  const maxLen = Math.max(d.length, n.length);
  const dist = levenshtein(d, n);
  if (maxLen <= 12 && dist <= 2) return 55;
  if (dist / maxLen <= 0.12) return 50;
  let sc = 0;
  for (const w of n.split(/\s+/).filter((x) => x.length > 1)) {
    if (d.includes(w)) sc += 12 + w.length;
  }
  return sc;
}

export function colapsarResolve<T extends { id: string; nombre?: string | null }>(
  filas: T[],
  needle: string
): ResolveResult<T> {
  const scored = filas
    .map((f) => ({ f, score: scoreNombreMatch(String(f.nombre ?? ''), needle) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const exactos = scored.filter((x) => x.score >= 100);
  if (exactos.length === 1) return { status: 'one', match: exactos[0]!.f };
  if (scored.length === 0) return { status: 'none' };
  if (scored.length === 1) return { status: 'one', match: scored[0]!.f };
  return { status: 'many', candidatos: scored.map((x) => x.f) };
}

const RE_CONSULTA_LISTADO_OBRAS =
  /\b(?:qu[eé]\s+obras?\b|\bobras?\s+(?:tengo|hay|abiertas?|activas?|en\s+curso)\b|\blistar?\s+(?:las\s+)?obras?\b|\bmu[eé]stra(?:me)?\s+(?:las\s+)?obras?\b|\bcu[aá]ntas?\s+obras?\b|\bobras?\s+abiertas\b)/i;

const RE_ALTA_OBRA =
  /\b(?:crea(?:r)?|nueva|nuevo|actualiza(?:r)?|cierra|cerrar|pausa)\s+(?:una\s+)?obra\b/i;

/** Consulta de listado de obras (no alta, no presupuesto). */
export function pareceConsultaListadoObras(mensaje: string): boolean {
  const t = String(mensaje ?? '').trim();
  if (!t) return false;
  if (RE_ALTA_OBRA.test(t)) return false;
  return RE_CONSULTA_LISTADO_OBRAS.test(t);
}

/** Query de buscar_obra que debe listar abiertas/en curso, no ilike por nombre. */
export function esQueryListadoObras(query: string): boolean {
  const raw = String(query ?? '').trim();
  if (!raw) return true;
  if (pareceConsultaListadoObras(raw)) return true;
  const q = normalizarNombreComparable(raw);
  return (
    /^(las?\s+)?obras?(\s+(abiertas?|en curso|activas?|todas?))?$/.test(q) ||
    /^(abiertas?|en curso|en_curso|activas?|todas?)$/.test(q)
  );
}

export function pareceMutacionSobrePresupuestoExistente(mensaje: string): boolean {
  const t = String(mensaje ?? '').trim();
  if (!t) return false;
  const verboAdd =
    /\b(a[nñ]ad(?:e|ir|o)|agreg(?:a|ar)|pon(?:e[rd])?|mete[r]?|sum(?:a|ar))\w*\b/i.test(t);
  const alPresu =
    /\bal\s+presupuesto\b|\bel\s+presupuesto\s+d(?:el|e)\b|\bpresupuesto\s+del\s+cliente\b/i.test(
      t
    );
  const crearNuevo =
    /\b(nuevo\s+presupuesto|haz(?:me)?\s+(un\s+)?presupuesto|crea(?:r)?\s+(un\s+)?presupuesto|iniciar\s+(un\s+)?(borrador|presupuesto))\b/i.test(
      t
    );
  return verboAdd && alPresu && !crearNuevo;
}

/** Solo entonces iniciar_borrador puede crear. Consultas (obras abiertas, etc.) no. */
export function parecePeticionPresupuestoNuevo(mensaje: string): boolean {
  const t = String(mensaje ?? '').trim();
  if (!t) return false;
  if (pareceConsultaListadoObras(t)) return false;
  if (pareceMutacionSobrePresupuestoExistente(t)) return false;
  return (
    /\b(nuevo\s+presupuesto|presupuesto\s+nuevo)\b/i.test(t) ||
    /\bhaz(?:me)?\s+(un\s+)?presupuesto\b/i.test(t) ||
    /\bcrea(?:r)?\s+(un\s+)?presupuesto\b/i.test(t) ||
    /\binicia(?:r)?\s+(un\s+)?(borrador|presupuesto)\b/i.test(t) ||
    /\bpresupuesta(?:r|me)?\b/i.test(t) ||
    /\b(?:un\s+)?presupuesto\s+para\b/i.test(t)
  );
}

export function extraerNombreClienteDePeticionPresupuesto(mensaje: string): string | null {
  const t = String(mensaje ?? '').trim();
  if (!t) return null;
  const patterns = [
    /presupuesto(?:\s+activo)?\s+del\s+cliente\s+(.+)$/i,
    /presupuesto(?:\s+activo)?\s+de(?:l)?\s+(?:el\s+)?cliente\s+(.+)$/i,
    /presupuesto(?:\s+activo)?\s+de\s+(.+)$/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m?.[1]) continue;
    let nom = m[1].trim().replace(/[.,;:¡!¿?]+$/g, '').trim();
    nom = nom.replace(/^inexistente\s+/i, '').trim();
    if (nom.length >= 1) return nom.slice(0, 120);
  }
  return null;
}

export function esUuid(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function etiquetaCliente(row: { id: string; nombre?: string | null }): CandidatoGrounding {
  return { id: row.id, etiqueta: String(row.nombre ?? '').trim() || row.id };
}

function preguntaVarios(tipo: string, candidatos: CandidatoGrounding[]): string {
  const lista = candidatos
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${c.etiqueta}`)
    .join('\n');
  return `Hay varios ${tipo} que encajan. ¿Cuál es?\n${lista}`;
}

export function resultadoResolveATool<T extends { id: string; nombre?: string | null }>(
  resolved: ResolveResult<T>,
  nombreBuscado: string,
  tipoSingular: string
): { ok: true; match: T } | ToolFailClosed {
  if (resolved.status === 'none') {
    return failClosed(
      `No encuentro ningún ${tipoSingular} llamado «${nombreBuscado}». No he creado nada de paso ni he inventado la ficha.`
    );
  }
  if (resolved.status === 'many') {
    const cands = resolved.candidatos.map(etiquetaCliente);
    return pedirAclaracion(preguntaVarios(`${tipoSingular}s`, cands), cands);
  }
  return { ok: true, match: resolved.match };
}

export async function resolverClientesPorNombre(
  supabase: SupabaseClient,
  businessId: string,
  nombre: string
): Promise<ResolveResult<{ id: string; nombre: string | null }>> {
  const needle = String(nombre ?? '').trim();
  if (!needle) return { status: 'none' };
  const safe = escapeIlikeGrounding(needle).slice(0, 120);
  if (!safe) return { status: 'none' };
  const pat = `%${safe}%`;
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nombre')
    .eq('business_id', businessId)
    .ilike('nombre', pat)
    .order('nombre', { ascending: true })
    .limit(20);
  if (error) return { status: 'none' };
  return colapsarResolve(
    (data ?? []) as Array<{ id: string; nombre: string | null }>,
    needle
  );
}

export async function resolverObrasPorNombre(
  supabase: SupabaseClient,
  businessId: string,
  nombre: string
): Promise<ResolveResult<{ id: string; nombre: string | null }>> {
  const needle = String(nombre ?? '').trim();
  if (!needle) return { status: 'none' };
  const safe = escapeIlikeGrounding(needle).slice(0, 120);
  if (!safe) return { status: 'none' };
  const pat = `%${safe}%`;
  const { data, error } = await supabase
    .from('obras')
    .select('id, nombre')
    .eq('business_id', businessId)
    .ilike('nombre', pat)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return { status: 'none' };
  return colapsarResolve((data ?? []) as Array<{ id: string; nombre: string | null }>, needle);
}

export type PresupuestoMatch = {
  id: string;
  nombre?: string | null;
  cliente_nombre: string | null;
  estado: string | null;
  importe_total: number | null;
};

export async function resolverPresupuestosPorTexto(
  supabase: SupabaseClient,
  businessId: string,
  opts: { id?: string; clienteNombre?: string }
): Promise<ResolveResult<PresupuestoMatch>> {
  const id = String(opts.id ?? '').trim();
  if (id && esUuid(id)) {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('id, cliente_nombre, estado, importe_total')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error || !data?.id) return { status: 'none' };
    const row = data as {
      id: string;
      cliente_nombre?: string | null;
      estado?: string | null;
      importe_total?: number | null;
    };
    return {
      status: 'one',
      match: {
        id: row.id,
        nombre: row.cliente_nombre ?? null,
        cliente_nombre: row.cliente_nombre ?? null,
        estado: row.estado ?? null,
        importe_total: row.importe_total ?? null,
      },
    };
  }

  const clienteNombre = String(opts.clienteNombre ?? '').trim();
  if (!clienteNombre) return { status: 'none' };

  const clientes = await resolverClientesPorNombre(supabase, businessId, clienteNombre);
  const clienteIds: string[] = [];
  if (clientes.status === 'one') clienteIds.push(clientes.match.id);
  else if (clientes.status === 'many') clienteIds.push(...clientes.candidatos.map((c) => c.id));

  const safe = escapeIlikeGrounding(clienteNombre).slice(0, 120);
  const pat = safe ? `%${safe}%` : '';
  const byId = new Map<string, PresupuestoMatch>();

  const pushRows = (
    rows: Array<{
      id: string;
      cliente_nombre?: string | null;
      estado?: string | null;
      importe_total?: number | null;
    }> | null
  ) => {
    for (const r of rows ?? []) {
      if (!r.id || byId.has(r.id)) continue;
      byId.set(r.id, {
        id: r.id,
        nombre: r.cliente_nombre ?? null,
        cliente_nombre: r.cliente_nombre ?? null,
        estado: r.estado ?? null,
        importe_total: r.importe_total ?? null,
      });
    }
  };

  if (pat) {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('id, cliente_nombre, estado, importe_total, cliente_id')
      .eq('business_id', businessId)
      .ilike('cliente_nombre', pat)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error) {
      pushRows(
        (data ?? []) as Array<{
          id: string;
          cliente_nombre?: string | null;
          estado?: string | null;
          importe_total?: number | null;
        }>
      );
    }
  }
  if (clienteIds.length > 0) {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('id, cliente_nombre, estado, importe_total, cliente_id')
      .eq('business_id', businessId)
      .in('cliente_id', clienteIds)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error) {
      pushRows(
        (data ?? []) as Array<{
          id: string;
          cliente_nombre?: string | null;
          estado?: string | null;
          importe_total?: number | null;
        }>
      );
    }
  }

  const mapped = [...byId.values()];
  if (mapped.length === 0) return { status: 'none' };
  if (mapped.length === 1) return { status: 'one', match: mapped[0]! };
  const collapsed = colapsarResolve(mapped, clienteNombre);
  if (collapsed.status === 'one' || collapsed.status === 'none') return collapsed;
  return { status: 'many', candidatos: mapped };
}

export function toolFailDesdePresupuestoResolve(
  resolved: ResolveResult<PresupuestoMatch>,
  etiqueta: string
): { ok: true; match: PresupuestoMatch } | ToolFailClosed {
  if (resolved.status === 'none') {
    return failClosed(
      `No encuentro ningún presupuesto para «${etiqueta}». No he añadido partidas ni he creado cliente ni presupuesto de paso.`
    );
  }
  if (resolved.status === 'many') {
    const cands: CandidatoGrounding[] = resolved.candidatos.map((p) => ({
      id: p.id,
      etiqueta: `${p.cliente_nombre ?? 'sin cliente'} · ${p.estado ?? '—'} · ${
        p.importe_total != null ? `${p.importe_total} €` : 'sin importe'
      }`,
    }));
    return pedirAclaracion(preguntaVarios('presupuestos', cands), cands);
  }
  return { ok: true, match: resolved.match };
}
