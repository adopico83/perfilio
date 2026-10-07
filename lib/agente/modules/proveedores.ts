import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizarNombreComparable, escapeIlikeGrounding } from '@/lib/agente/modules/grounding';

/**
 * Proveedores como ficha (tabla `proveedores`). Si la migración todavía no está aplicada, las consultas
 * dan error y todo funciona como antes (el proveedor del gasto es solo texto): nunca se rompe un gasto
 * por esto.
 */

export type ProveedorFicha = {
  id: string;
  nombre: string;
  nif: string | null;
  telefono: string | null;
  email: string | null;
};

export type ResolucionProveedor =
  | { status: 'one'; match: ProveedorFicha }
  | { status: 'many'; candidatos: ProveedorFicha[] }
  | { status: 'none' }
  /** La tabla no existe todavía (migración sin aplicar) o falló la consulta. */
  | { status: 'sin_tabla' };

const COLUMNAS = 'id, nombre, nif, telefono, email';

function palabras(s: string): string[] {
  return normalizarNombreComparable(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 2);
}

/** Proveedor existente del negocio cuyo nombre contiene TODAS las palabras dichas. */
export async function resolverProveedorPorNombre(
  supabase: SupabaseClient,
  businessId: string,
  nombre: string
): Promise<ResolucionProveedor> {
  const pals = palabras(nombre);
  if (pals.length === 0) return { status: 'none' };
  const mayor = [...pals].sort((a, b) => b.length - a.length)[0]!;
  const { data, error } = await supabase
    .from('proveedores')
    .select(COLUMNAS)
    .eq('business_id', businessId)
    .ilike('nombre', `%${escapeIlikeGrounding(mayor).slice(0, 80)}%`)
    .order('nombre', { ascending: true })
    .limit(20);
  if (error) return { status: 'sin_tabla' };
  const filas = ((data ?? []) as ProveedorFicha[]).filter((p) => {
    const ps = new Set(palabras(p.nombre));
    return pals.every((w) => ps.has(w) || [...ps].some((x) => x.startsWith(w) || w.startsWith(x)));
  });
  if (filas.length === 0) return { status: 'none' };
  if (filas.length === 1) return { status: 'one', match: filas[0]! };
  const nn = normalizarNombreComparable(nombre);
  const exactos = filas.filter((f) => normalizarNombreComparable(f.nombre) === nn);
  if (exactos.length === 1) return { status: 'one', match: exactos[0]! };
  return { status: 'many', candidatos: filas };
}

/** Valida un `proveedor_id` que llega: tiene que ser de ESTE negocio. */
export async function proveedorPorId(
  supabase: SupabaseClient,
  businessId: string,
  id: string
): Promise<ProveedorFicha | null | 'sin_tabla'> {
  const { data, error } = await supabase
    .from('proveedores')
    .select(COLUMNAS)
    .eq('business_id', businessId)
    .eq('id', id)
    .maybeSingle();
  if (error) return 'sin_tabla';
  return (data as ProveedorFicha | null) ?? null;
}

export const PROVEEDORES_HANDLED_TOOLS = new Set(['crear_proveedor', 'buscar_proveedor']);

export const PROVEEDORES_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_proveedor',
      description:
        'Busca proveedores dados de alta (Saltoki, Bricomart…) por nombre. Solo lectura. Úsala antes de registrar un gasto si dudas de cómo se llama el proveedor habitual.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Nombre o parte del nombre; vacío = lista los primeros' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_proveedor',
      description:
        'Da de alta un proveedor (nombre obligatorio; NIF, teléfono, email y notas opcionales). Si ya existe uno con ese nombre, no lo duplica. Los gastos de ese proveedor se vinculan solos a su ficha. Pide confirmación. Usa el nombre EXACTO que dijo el usuario; la población («de Irún») y cualquier dato extra van en notas.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del proveedor' },
          nif: { type: 'string' },
          telefono: { type: 'string' },
          email: { type: 'string' },
          notas: { type: 'string' },
        },
        required: ['nombre'],
        additionalProperties: false,
      },
    },
  },
];

const limpio = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

export async function handleProveedores(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  if (toolName === 'buscar_proveedor') {
    const q = String(toolArgs.query ?? '').trim();
    let consulta = supabase.from('proveedores').select(COLUMNAS).eq('business_id', businessId);
    const safe = escapeIlikeGrounding(q).slice(0, 80);
    if (safe) consulta = consulta.ilike('nombre', `%${safe}%`);
    const { data, error } = await consulta.order('nombre', { ascending: true }).limit(20);
    if (error) return { ok: false, error: 'Todavía no está activada la ficha de proveedores.' };
    return { ok: true, items: data ?? [] };
  }

  // crear_proveedor
  const nombre = String(toolArgs.nombre ?? '').trim();
  if (!nombre) return { ok: false, error: 'nombre es obligatorio' };
  const previo = await resolverProveedorPorNombre(supabase, businessId, nombre);
  if (previo.status === 'sin_tabla') {
    return { ok: false, error: 'Todavía no está activada la ficha de proveedores (falta aplicar su migración). El gasto se guarda igualmente con el nombre.' };
  }
  if (previo.status === 'one') {
    return { ok: true, id: previo.match.id, existente: true, mensaje: `El proveedor ${previo.match.nombre} ya existe: uso ese.` };
  }
  if (previo.status === 'many') {
    return {
      ok: false,
      error: `Ya hay varios proveedores parecidos a «${nombre}»: ${previo.candidatos.map((c) => c.nombre).join(', ')}. ¿Es alguno de ellos?`,
      necesita_aclaracion: true,
      candidatos: previo.candidatos.map((c) => ({ id: c.id, etiqueta: c.nombre })),
    };
  }
  const { data, error } = await supabase
    .from('proveedores')
    .insert({
      business_id: businessId,
      nombre,
      nif: limpio(toolArgs.nif)?.toUpperCase() ?? null,
      telefono: limpio(toolArgs.telefono),
      email: limpio(toolArgs.email),
      notas: limpio(toolArgs.notas),
    })
    .select('id')
    .maybeSingle();
  if (error || !data?.id) return { ok: false, error: error?.message ?? 'No se pudo crear el proveedor' };
  return { ok: true, id: data.id as string, mensaje: `Proveedor ${nombre} dado de alta.` };
}
