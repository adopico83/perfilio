import type { SupabaseClient } from '@supabase/supabase-js';

export type Obra = {
  id: string;
  business_id: string;
  cliente_id: string | null;
  nombre: string;
  direccion: string | null;
  estado: string;
};

const ESTADOS_ABIERTAS = new Set(['abierta', 'en_curso']);

function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function escapeIlikePattern(s: string): string {
  return s.replace(/[%_*]/g, '');
}

/** Palabras significativas (evita coincidencias por "de", "la", etc.). */
function significantWords(normalized: string, minLen = 3): string[] {
  return normalized
    .split(/[\s,.;:/\\-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= minLen);
}

/**
 * Indica si `texto` del usuario encaja con el nombre de obra, cliente o dirección
 * (coincidencia tipo ilike / subcadena insensible a mayúsculas).
 */
function textoCoincideConObra(
  textoNorm: string,
  obraNombre: string,
  clienteNombre: string | null,
  direccion: string | null
): boolean {
  if (!textoNorm) return false;

  const on = normalizeForMatch(obraNombre);
  if (on.length >= 2 && textoNorm.includes(on)) return true;

  for (const w of significantWords(on, 3)) {
    if (textoNorm.includes(w)) return true;
  }

  if (clienteNombre) {
    const cn = normalizeForMatch(clienteNombre);
    if (cn.length >= 2 && textoNorm.includes(cn)) return true;
    for (const w of significantWords(cn, 3)) {
      if (textoNorm.includes(w)) return true;
    }
  }

  if (direccion) {
    const d = normalizeForMatch(direccion);
    if (d.length >= 4 && textoNorm.includes(d)) return true;
    for (const w of significantWords(d, 4)) {
      if (w.length >= 4 && textoNorm.includes(w)) return true;
    }
  }

  return false;
}

/** El usuario puede nombrar la obra con palabras sueltas: comprobar si alguna palabra del texto encaja con nombre/dirección/cliente (ilike conceptual). */
function palabrasUsuarioCoincidenConObra(
  textoNorm: string,
  obraNombre: string,
  clienteNombre: string | null,
  direccion: string | null
): boolean {
  const words = significantWords(textoNorm, 2);
  for (const w of words) {
    if (w.length < 2) continue;
    const on = normalizeForMatch(obraNombre);
    if (on.includes(w)) return true;
    if (clienteNombre && normalizeForMatch(clienteNombre).includes(w)) return true;
    if (direccion && normalizeForMatch(direccion).includes(w)) return true;
  }
  return false;
}

export async function detectarObraDesdeTexto(
  texto: string,
  businessId: string,
  supabase: SupabaseClient
): Promise<{ obra: Obra | null; multiples: Obra[] }> {
  const raw = String(texto ?? '').trim();
  if (!raw) {
    return { obra: null, multiples: [] };
  }

  const { data: rows, error } = await supabase
    .from('obras')
    .select(
      'id, business_id, cliente_id, nombre, direccion, estado, clientes ( nombre )'
    )
    .eq('business_id', businessId)
    .in('estado', ['abierta', 'en_curso']);

  if (error) {
    console.error('[detectarObraDesdeTexto]', error.message);
    return { obra: null, multiples: [] };
  }

  const lista = (rows ?? []) as Array<
    Obra & { clientes?: { nombre?: string | null } | null }
  >;

  const textoNorm = normalizeForMatch(raw);

  const rowToObra = (row: (typeof lista)[number]): Obra => ({
    id: row.id,
    business_id: row.business_id,
    cliente_id: row.cliente_id,
    nombre: row.nombre,
    direccion: row.direccion,
    estado: row.estado,
  });

  // FASE 1 — Nombre de obra completo en el texto (sin ambigüedad con coincidencias parciales)
  const exactMatches: Obra[] = [];
  for (const row of lista) {
    if (!ESTADOS_ABIERTAS.has(String(row.estado ?? '').toLowerCase())) continue;
    const on = normalizeForMatch(row.nombre);
    if (on.length >= 2 && textoNorm.includes(on)) {
      exactMatches.push(rowToObra(row));
    }
  }
  if (exactMatches.length > 0) {
    exactMatches.sort(
      (a, b) => normalizeForMatch(b.nombre).length - normalizeForMatch(a.nombre).length
    );
    return { obra: exactMatches[0]!, multiples: [] };
  }

  // FASE 2 — Coincidencia parcial en memoria (palabras clave, cliente, dirección)
  const candidatas: Obra[] = [];
  for (const row of lista) {
    if (!ESTADOS_ABIERTAS.has(String(row.estado ?? '').toLowerCase())) continue;
    const cliNom =
      row.clientes && typeof row.clientes === 'object'
        ? (row.clientes as { nombre?: string | null }).nombre ?? null
        : null;
    const cliStr = cliNom != null ? String(cliNom) : null;
    const dirStr = row.direccion != null ? String(row.direccion) : null;

    const match =
      textoCoincideConObra(textoNorm, row.nombre, cliStr, dirStr) ||
      palabrasUsuarioCoincidenConObra(textoNorm, row.nombre, cliStr, dirStr);

    if (match) {
      candidatas.push(rowToObra(row));
    }
  }

  // FASE 3 — ilike en BD si fases 1 y 2 no encontraron nada
  if (candidatas.length === 0) {
    const safeFragment = escapeIlikePattern(raw).slice(0, 120);
    if (safeFragment.length >= 2) {
      const pat = `%${safeFragment}%`;
      const base = () =>
        supabase
          .from('obras')
          .select('id, business_id, cliente_id, nombre, direccion, estado')
          .eq('business_id', businessId)
          .in('estado', ['abierta', 'en_curso']);

      const [{ data: porNombre }, { data: porDir }] = await Promise.all([
        base().ilike('nombre', pat),
        base().ilike('direccion', pat),
      ]);

      const pushRow = (row: Obra) => {
        if (!candidatas.some((c) => c.id === row.id)) candidatas.push(row);
      };
      for (const row of porNombre ?? []) pushRow(row as Obra);
      for (const row of porDir ?? []) pushRow(row as Obra);

      const { data: clientesRows } = await supabase
        .from('clientes')
        .select('id, nombre')
        .eq('business_id', businessId)
        .ilike('nombre', pat)
        .limit(30);

      const clienteIds = (clientesRows ?? []).map((c: { id: string }) => c.id);
      if (clienteIds.length > 0) {
        const { data: porCliente } = await supabase
          .from('obras')
          .select('id, business_id, cliente_id, nombre, direccion, estado')
          .eq('business_id', businessId)
          .in('estado', ['abierta', 'en_curso'])
          .in('cliente_id', clienteIds);

        for (const row of porCliente ?? []) {
          if (!candidatas.some((c) => c.id === row.id)) {
            candidatas.push(row as Obra);
          }
        }
      }
    }
  }

  const uniq = new Map<string, Obra>();
  for (const c of candidatas) uniq.set(c.id, c);
  const finalList = [...uniq.values()];

  if (finalList.length === 1) {
    return { obra: finalList[0]!, multiples: [] };
  }
  if (finalList.length > 1) {
    return { obra: null, multiples: finalList };
  }
  return { obra: null, multiples: [] };
}

/**
 * Resuelve obra_id: primero valida UUID explícito (obra abierta); si no, detecta desde texto.
 * `textoBusqueda` debe incluir ya el mensaje del usuario si aplica.
 */
export async function resolverObraDocumentoAgente(
  supabase: SupabaseClient,
  businessId: string,
  explicitObraId: string | undefined,
  textoBusqueda: string,
  contexto: 'entrada_diario' | 'documento' | 'gasto' | 'extra'
): Promise<
  | { ok: true; obra_id: string | null; obra_nombre?: string }
  | { ok: false; mensaje: string }
> {
  const ex = (explicitObraId ?? '').trim();
  if (ex) {
    const { data: row, error } = await supabase
      .from('obras')
      .select('id, nombre, estado')
      .eq('business_id', businessId)
      .eq('id', ex)
      .in('estado', ['abierta', 'en_curso'])
      .maybeSingle();
    if (!error && row?.id) {
      return { ok: true, obra_id: row.id, obra_nombre: String(row.nombre ?? '') };
    }
  }
  const texto = textoBusqueda.trim();
  if (!texto) {
    return { ok: true, obra_id: null };
  }
  const det = await detectarObraDesdeTexto(texto, businessId, supabase);
  if (det.multiples.length > 1) {
    return { ok: false, mensaje: mensajeObrasAmbiguas(det.multiples, contexto) };
  }
  if (det.obra) {
    return { ok: true, obra_id: det.obra.id, obra_nombre: det.obra.nombre };
  }
  return { ok: true, obra_id: null };
}

export function mensajeObrasAmbiguas(
  obras: Obra[],
  contexto: 'entrada_diario' | 'documento' | 'gasto' | 'extra'
): string {
  const lines = obras.map((o, i) => `${i + 1}. ${o.nombre}`).join('\n');
  const cierre =
    contexto === 'entrada_diario'
      ? '¿A cuál quieres añadir la entrada?'
      : contexto === 'gasto'
        ? '¿A cuál obra quieres asociar el gasto?'
        : contexto === 'extra'
          ? '¿Para cuál obra es el extra?'
          : '¿A cuál obra quieres asociar el documento?';
  return `He encontrado varias obras que pueden coincidir:\n${lines}\n${cierre}`;
}
