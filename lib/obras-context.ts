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

/** Cliente con al menos dos partes (p. ej. nombre + apellido), cada una ≥ 2 caracteres. */
function clienteTieneNombreYApellido(cn: string): boolean {
  const tokens = cn
    .split(/[\s,.;:/\\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return tokens.length >= 2;
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

  if (clienteNombre) {
    const cn = normalizeForMatch(clienteNombre);
    if (
      cn.length >= 2 &&
      clienteTieneNombreYApellido(cn) &&
      textoNorm.includes(cn)
    ) {
      return true;
    }
  }

  for (const w of significantWords(on, 4)) {
    if (textoNorm.includes(w)) return true;
  }

  if (clienteNombre) {
    const cn = normalizeForMatch(clienteNombre);
    if (cn.length >= 2 && textoNorm.includes(cn)) return true;
    for (const w of significantWords(cn, 4)) {
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
  const words = significantWords(textoNorm, 4);
  for (const w of words) {
    const on = normalizeForMatch(obraNombre);
    if (on.includes(w)) return true;
    if (clienteNombre && normalizeForMatch(clienteNombre).includes(w)) return true;
    if (direccion && normalizeForMatch(direccion).includes(w)) return true;
  }
  return false;
}

export type OpcionesBusquedaObra = {
  /** Para CONSULTAR (ficha, horas, gastos…): también obras cerradas. Para escribir, no (se priorizan las abiertas). */
  incluirCerradas?: boolean;
};

export async function detectarObraDesdeTexto(
  texto: string,
  businessId: string,
  supabase: SupabaseClient,
  opciones: OpcionesBusquedaObra = {}
): Promise<{ obra: Obra | null; multiples: Obra[] }> {
  const incluirCerradas = opciones.incluirCerradas === true;
  const estadoOk = (estado: unknown) => incluirCerradas || ESTADOS_ABIERTAS.has(String(estado ?? '').toLowerCase());
  const raw = String(texto ?? '').trim();
  if (!raw) {
    return { obra: null, multiples: [] };
  }

  let qObras = supabase
    .from('obras')
    .select(
      'id, business_id, cliente_id, nombre, direccion, estado, clientes ( nombre )'
    )
    .eq('business_id', businessId);
  if (!incluirCerradas) qObras = qObras.in('estado', ['abierta', 'en_curso']);
  const { data: rows, error } = await qObras;

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

  // Nombre del cliente de cada obra: del join si viene; si no, de una consulta aparte (así no depende del join).
  const nombreClientePorId = new Map<string, string>();
  const idsSinJoin = [
    ...new Set(
      lista
        .filter((r) => r.cliente_id && !(r.clientes && typeof r.clientes === 'object' && (r.clientes as { nombre?: string | null }).nombre))
        .map((r) => String(r.cliente_id))
    ),
  ];
  if (idsSinJoin.length > 0) {
    const { data: clisRows } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('business_id', businessId)
      .in('id', idsSinJoin);
    for (const c of (clisRows ?? []) as Array<{ id: string; nombre: string | null }>) {
      if (c.nombre) nombreClientePorId.set(c.id, c.nombre);
    }
  }
  const clienteNormDesdeRow = (row: (typeof lista)[number]): string | null => {
    const cliNom =
      (row.clientes && typeof row.clientes === 'object'
        ? (row.clientes as { nombre?: string | null }).nombre ?? null
        : null) ?? (row.cliente_id ? nombreClientePorId.get(String(row.cliente_id)) ?? null : null);
    if (!cliNom || !String(cliNom).trim()) return null;
    return normalizeForMatch(String(cliNom));
  };

  // FASE -1 — El texto nombra a un CLIENTE (todas las palabras de su nombre): sus obras mandan sobre palabras
  // sueltas del resto del mensaje («cocina», «baño»…). Si el cliente tiene varias obras, se afina con esas
  // palabras entre SUS obras; si siguen siendo varias, se pregunta.
  {
    const palabrasTexto = new Set(textoNorm.split(/[^a-z0-9ñ]+/).filter(Boolean));
    const delCliente = lista.filter((row) => {
      if (!estadoOk(row.estado)) return false;
      const cn = clienteNormDesdeRow(row);
      if (!cn) return false;
      const pals = significantWords(cn, 3);
      return pals.length > 0 && pals.every((w) => palabrasTexto.has(w));
    });
    if (delCliente.length > 0) {
      // Si el cliente más específico (más palabras) gana, no mezclamos con otro que comparta una palabra.
      const maxPal = Math.max(...delCliente.map((r) => significantWords(clienteNormDesdeRow(r) ?? '', 3).length));
      let pool = delCliente.filter((r) => significantWords(clienteNormDesdeRow(r) ?? '', 3).length === maxPal);
      const clientesDistintos = new Set(pool.map((r) => r.cliente_id));
      if (clientesDistintos.size === 1) {
        if (pool.length > 1) {
          const porNombre = pool.filter((r) => significantWords(normalizeForMatch(r.nombre), 4).some((w) => palabrasTexto.has(w)));
          if (porNombre.length > 0) pool = porNombre;
        }
        // Abiertas primero: una obra cerrada solo si es la única.
        const abiertas = pool.filter((r) => ESTADOS_ABIERTAS.has(String(r.estado ?? '').toLowerCase()));
        if (abiertas.length > 0) pool = abiertas;
        if (pool.length === 1) return { obra: rowToObra(pool[0]!), multiples: [] };
        return { obra: null, multiples: pool.map(rowToObra) };
      }
    }
  }

  // FASE 0 — Palabras significativas del texto (≥4) en un solo cliente: todas en el mismo
  // nombre de cliente y cada palabra no aparece en el cliente de ninguna otra obra abierta.
  const palabrasUsuarioF0 = significantWords(textoNorm, 4);
  if (palabrasUsuarioF0.length > 0) {
    const obrasConTodasEnCliente: Obra[] = [];
    for (const row of lista) {
      if (!estadoOk(row.estado)) continue;
      const cn = clienteNormDesdeRow(row);
      if (!cn) continue;
      if (palabrasUsuarioF0.every((w) => cn.includes(w))) {
        obrasConTodasEnCliente.push(rowToObra(row));
      }
    }
    if (obrasConTodasEnCliente.length === 1) {
      const elegida = obrasConTodasEnCliente[0]!;
      let cadaPalabraSoloEnEsaObra = true;
      for (const w of palabrasUsuarioF0) {
        const obrasConLaPalabraEnCliente = lista.filter((row) => {
          if (!estadoOk(row.estado)) return false;
          const cn = clienteNormDesdeRow(row);
          return cn != null && cn.includes(w);
        });
        if (
          obrasConLaPalabraEnCliente.length !== 1 ||
          obrasConLaPalabraEnCliente[0]!.id !== elegida.id
        ) {
          cadaPalabraSoloEnEsaObra = false;
          break;
        }
      }
      if (cadaPalabraSoloEnEsaObra) {
        return { obra: elegida, multiples: [] };
      }
    }
  }

  // FASE 1 — Nombre de obra completo en el texto (sin ambigüedad con coincidencias parciales)
  const exactMatches: Obra[] = [];
  for (const row of lista) {
    if (!estadoOk(row.estado)) continue;
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
    if (!estadoOk(row.estado)) continue;
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
      const base = () => {
        const q = supabase
          .from('obras')
          .select('id, business_id, cliente_id, nombre, direccion, estado')
          .eq('business_id', businessId);
        return incluirCerradas ? q : q.in('estado', ['abierta', 'en_curso']);
      };

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
        const qPorCliente = supabase
          .from('obras')
          .select('id, business_id, cliente_id, nombre, direccion, estado')
          .eq('business_id', businessId)
          .in('cliente_id', clienteIds);
        const { data: porCliente } = await (incluirCerradas ? qPorCliente : qPorCliente.in('estado', ['abierta', 'en_curso']));

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

type ObrasPorClienteResult =
  | { kind: 'ok'; obra: Obra }
  | { kind: 'obras_ambiguas'; obras: Obra[] }
  | { kind: 'clientes_ambiguos'; clientes: Array<{ id: string; nombre: string }> }
  | { kind: 'cliente_sin_obras'; nombreCliente: string }
  | { kind: 'sin_coincidencia' };

/**
 * Si no hubo coincidencia por nombre de obra en memoria/ilike, intenta localizar una obra abierta
 * vía cliente (ilike en `clientes`, luego obras con ese cliente_id).
 */
async function obrasPorClienteDesdeTexto(
  supabase: SupabaseClient,
  businessId: string,
  texto: string,
  incluirCerradas = false
): Promise<ObrasPorClienteResult> {
  const raw = String(texto ?? '').trim();
  if (!raw) return { kind: 'sin_coincidencia' };

  const labels: string[] = [raw];
  const hint = raw.replace(/^(obra\s+de\s+|la\s+obra\s+de\s+|obra\s+)/i, '').trim();
  if (hint && hint !== raw) labels.push(hint);

  const seenCli = new Map<string, { id: string; nombre: string }>();
  for (const label of labels) {
    const safe = escapeIlikePattern(label).slice(0, 120);
    if (safe.length < 2) continue;
    const pat = `%${safe}%`;
    const { data: rows, error } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('business_id', businessId)
      .ilike('nombre', pat)
      .order('nombre', { ascending: true })
      .limit(15);
    if (error) {
      console.error('[obrasPorClienteDesdeTexto] clientes', error.message);
      continue;
    }
    for (const r of rows ?? []) {
      const id = String((r as { id: string }).id);
      const nombre = String((r as { nombre?: string | null }).nombre ?? '').trim() || id;
      seenCli.set(id, { id, nombre });
    }
  }

  const clientes = [...seenCli.values()];
  if (clientes.length === 0) return { kind: 'sin_coincidencia' };
  if (clientes.length > 1) {
    return { kind: 'clientes_ambiguos', clientes };
  }

  const { id: clienteId, nombre: nombreCli } = clientes[0]!;
  let qObrasCli = supabase
    .from('obras')
    .select('id, business_id, cliente_id, nombre, direccion, estado')
    .eq('business_id', businessId)
    .eq('cliente_id', clienteId);
  if (!incluirCerradas) qObrasCli = qObrasCli.in('estado', ['abierta', 'en_curso']);
  const { data: obrasRows, error: errOb } = await qObrasCli.order('nombre', { ascending: true }).limit(15);

  if (errOb) {
    console.error('[obrasPorClienteDesdeTexto] obras', errOb.message);
    return { kind: 'sin_coincidencia' };
  }

  const obras = (obrasRows ?? []) as Obra[];
  if (obras.length === 0) {
    return { kind: 'cliente_sin_obras', nombreCliente: nombreCli };
  }
  if (obras.length === 1) {
    return { kind: 'ok', obra: obras[0]! };
  }
  return { kind: 'obras_ambiguas', obras };
}

function mensajeClientesAmbiguosObra(
  clientes: Array<{ nombre: string }>,
  contexto: 'entrada_diario' | 'documento' | 'gasto' | 'extra'
): string {
  const lines = clientes.map((c, i) => `${i + 1}. ${c.nombre}`).join('\n');
  const cierre =
    contexto === 'entrada_diario'
      ? '¿Con cuál cliente quieres asociar la entrada del diario?'
      : contexto === 'gasto'
        ? '¿Con cuál cliente quieres asociar el gasto?'
        : contexto === 'extra'
          ? '¿Para cuál cliente es el extra?'
          : '¿Con cuál cliente quieres asociar el documento?';
  return `He encontrado varios clientes que encajan con el texto:\n${lines}\n${cierre} Indica el nombre completo u obra_id.`;
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
  contexto: 'entrada_diario' | 'documento' | 'gasto' | 'extra',
  opciones: OpcionesBusquedaObra = {}
): Promise<
  | { ok: true; obra_id: string | null; obra_nombre?: string }
  | { ok: false; mensaje: string; candidatos?: CandidatoObra[] }
> {
  const incluirCerradas = opciones.incluirCerradas === true;
  const ex = (explicitObraId ?? '').trim();
  if (ex) {
    // Un id que llega NUNCA se ignora en silencio: o es una obra de este negocio, o se dice claro.
    const { data: row, error } = await supabase
      .from('obras')
      .select('id, nombre, estado')
      .eq('business_id', businessId)
      .eq('id', ex)
      .maybeSingle();
    if (!error && row?.id) {
      const abierta = ESTADOS_ABIERTAS.has(String((row as { estado?: string | null }).estado ?? '').toLowerCase());
      if (abierta || incluirCerradas) {
        return { ok: true, obra_id: row.id, obra_nombre: String(row.nombre ?? '') };
      }
      return {
        ok: false,
        mensaje: `La obra «${String(row.nombre ?? '')}» está cerrada, así que no se le puede añadir nada. Si es otra obra, dime cuál.`,
      };
    }
    // ¿El modelo mandó el id de un CLIENTE como si fuera de obra? Entonces valen las obras de ese cliente.
    const { data: cli } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('business_id', businessId)
      .eq('id', ex)
      .maybeSingle();
    if (cli?.id) {
      let qOc = supabase
        .from('obras')
        .select('id, business_id, cliente_id, nombre, direccion, estado')
        .eq('business_id', businessId)
        .eq('cliente_id', ex);
      if (!incluirCerradas) qOc = qOc.in('estado', ['abierta', 'en_curso']);
      const { data: delCli } = await qOc.order('nombre', { ascending: true }).limit(15);
      const obrasCli = (delCli ?? []) as Obra[];
      if (obrasCli.length === 1) {
        return { ok: true, obra_id: obrasCli[0]!.id, obra_nombre: obrasCli[0]!.nombre };
      }
      if (obrasCli.length > 1) {
        return { ok: false, mensaje: mensajeObrasAmbiguas(obrasCli, contexto), candidatos: obrasCli.map(etiquetarObra) };
      }
      return {
        ok: false,
        mensaje: `No hay obras${incluirCerradas ? '' : ' abiertas'} vinculadas al cliente «${String((cli as { nombre?: string | null }).nombre ?? '')}». Indica otra obra.`,
      };
    }
    return { ok: false, mensaje: 'Ese obra_id no existe en este negocio. No he guardado nada: dime de qué obra hablas.' };
  }
  const texto = textoBusqueda.trim();
  if (!texto) {
    return { ok: true, obra_id: null };
  }
  // Para escribir: solo obras abiertas. Para consultar: todas (la del cliente nombrado manda aunque esté
  // cerrada; si no, «la obra de Leire» acababa contestándose con la de otro cliente).
  const det = await detectarObraDesdeTexto(texto, businessId, supabase, { incluirCerradas });
  if (det.multiples.length > 1) {
    return {
      ok: false,
      mensaje: mensajeObrasAmbiguas(det.multiples, contexto),
      candidatos: det.multiples.map(etiquetarObra),
    };
  }
  if (det.obra) {
    return { ok: true, obra_id: det.obra.id, obra_nombre: det.obra.nombre };
  }

  const porCli = await obrasPorClienteDesdeTexto(supabase, businessId, texto, incluirCerradas);
  switch (porCli.kind) {
    case 'ok':
      return { ok: true, obra_id: porCli.obra.id, obra_nombre: porCli.obra.nombre };
    case 'obras_ambiguas':
      return {
        ok: false,
        mensaje: mensajeObrasAmbiguas(porCli.obras, contexto),
        candidatos: porCli.obras.map(etiquetarObra),
      };
    case 'clientes_ambiguos':
      return {
        ok: false,
        mensaje: mensajeClientesAmbiguosObra(porCli.clientes, contexto),
      };
    case 'cliente_sin_obras':
      return {
        ok: false,
        mensaje: `No hay obras abiertas vinculadas al cliente «${porCli.nombreCliente}». Indica otra obra u obra_id.`,
      };
    case 'sin_coincidencia':
    default:
      return { ok: true, obra_id: null };
  }
}

/** Opción de una pregunta «¿cuál de estas obras?»: id para resolver y etiqueta para mostrar. */
export type CandidatoObra = { id: string; etiqueta: string };

/** «Nombre · dirección»: la dirección distingue dos obras con nombre parecido. */
export function etiquetarObra(o: Pick<Obra, 'id' | 'nombre' | 'direccion'>): CandidatoObra {
  const dir = (o.direccion ?? '').trim();
  return { id: o.id, etiqueta: dir ? `${o.nombre} · ${dir}` : o.nombre };
}

/**
 * Resultado de una tool cuando no se pudo resolver la obra. Si hay varias candidatas, devuelve una
 * petición de aclaración (`necesita_aclaracion` + `candidatos`) para que el agente pregunte con
 * opciones numeradas en vez de adivinar. Mantiene `mensaje` por compatibilidad.
 */
export function aclaracionObra(r: { mensaje: string; candidatos?: CandidatoObra[] }): Record<string, unknown> {
  if (!r.candidatos || r.candidatos.length === 0) return { ok: false, error: r.mensaje, mensaje: r.mensaje };
  return {
    ok: false,
    error: r.mensaje,
    mensaje: r.mensaje,
    necesita_aclaracion: true,
    candidatos: r.candidatos,
  };
}

export function mensajeObrasAmbiguas(
  obras: Obra[],
  contexto: 'entrada_diario' | 'documento' | 'gasto' | 'extra'
): string {
  const lines = obras.map((o, i) => `${i + 1}. ${etiquetarObra(o).etiqueta}`).join('\n');
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
