import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ObraFichaCliente = { obra_id: string; obra_nombre: string };

/** Cliente de la obra (JOIN clientes) para heredar en documentos cuando no hay cliente_id explícito. */
export async function clienteDesdeObraSiAplica(
  supabase: SupabaseClient,
  businessId: string,
  obraId: string
): Promise<{ cliente_id: string | null; cliente_nombre: string | null }> {
  const { data, error } = await supabase
    .from('obras')
    .select('cliente_id, clientes ( nombre )')
    .eq('id', obraId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error || !data) return { cliente_id: null, cliente_nombre: null };
  const row = data as {
    cliente_id: string | null;
    clientes?: { nombre?: string | null } | null;
  };
  const cid = row.cliente_id ?? null;
  if (!cid) return { cliente_id: null, cliente_nombre: null };
  const cn =
    row.clientes && typeof row.clientes === 'object'
      ? String((row.clientes as { nombre?: string | null }).nombre ?? '').trim() || null
      : null;
  return { cliente_id: cid, cliente_nombre: cn };
}

/** Normaliza nombre para comparar (trim, minúsculas, espacios, sin acentos). */
function normalizarNombreComparable(s: string): string {
  return s
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

/** Mismo nombre o muy parecido (typo leve); evita duplicar clientes. */
function nombresClienteSimilares(nuevo: string, existente: string): boolean {
  const a = normalizarNombreComparable(nuevo);
  const b = normalizarNombreComparable(existente);
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return false;
  const dist = levenshtein(a, b);
  if (maxLen <= 12 && dist <= 2) return true;
  if (dist / maxLen <= 0.12) return true;
  return false;
}

type ClienteFilaNombre = { id: string; nombre: string | null };

function buscarClienteSimilarExistente(
  nombreBuscado: string,
  filas: ClienteFilaNombre[] | null | undefined
): { id: string; nombre: string } | null {
  if (!filas?.length) return null;
  for (const row of filas) {
    const nom = String(row.nombre ?? '').trim();
    if (!nom) continue;
    if (nombresClienteSimilares(nombreBuscado, nom)) return { id: row.id, nombre: nom };
  }
  return null;
}

export async function resolveClienteIdOpcional(
  supabase: SupabaseClient,
  businessId: string,
  raw: unknown
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (raw == null || !String(raw).trim()) return { ok: true, id: null };
  const cid = String(raw).trim();
  const { data: row, error: e0 } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', cid)
    .eq('business_id', businessId)
    .maybeSingle();
  if (e0) return { ok: false, error: e0.message };
  if (!row?.id) return { ok: false, error: 'cliente_id no válido para este negocio' };
  return { ok: true, id: cid };
}

export function capturarObraFicha(toolResult: unknown): ObraFichaCliente | null {
  if (!toolResult || typeof toolResult !== 'object') return null;
  const o = toolResult as Record<string, unknown>;
  if (o.accion !== 'abrir_ficha_obra') return null;
  const obra_id = String(o.obra_id ?? '').trim();
  const obra_nombre = String(o.obra_nombre ?? '').trim();
  if (!obra_id) return null;
  return { obra_id, obra_nombre };
}

export const OBRAS_CLIENTES_HANDLED_TOOLS = new Set([
  'crear_obra',
  'actualizar_obra',
  'buscar_obra',
  'ver_ficha_obra',
  'asociar_documentos_a_obra',
  'crear_cliente',
  'buscar_cliente',
  'ver_cliente',
]);

export const OBRAS_CLIENTES_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'crear_obra',
      description:
        'Crea una nueva obra o proyecto. Usar cuando el usuario mencione una nueva obra, reforma o trabajo nuevo. Si ya existe una obra con el mismo nombre (sin distinguir mayúsculas) en el negocio, no crea duplicado: devuelve id de la existente y mensaje.',
      parameters: {
        type: 'object',
        properties: {
          nombre: {
            type: 'string',
            description: "Nombre de la obra (ej: 'Reforma Baño García', 'Fachada Calle Mayor')",
          },
          cliente_id: {
            type: 'string',
            description: 'UUID de ficha de cliente si existe en el sistema',
          },
          cliente_nombre: {
            type: 'string',
            description: 'Nombre del cliente si no se tiene cliente_id',
          },
          cliente_telefono: {
            type: 'string',
            description:
              'Teléfono del cliente (opcional; si no existe el cliente por nombre, se usa al crearlo automáticamente)',
          },
          cliente_email: {
            type: 'string',
            description:
              'Email del cliente (opcional; si no existe el cliente por nombre, se usa al crearlo automáticamente)',
          },
          direccion: { type: 'string', description: 'Dirección de la obra' },
          direccion_obra: {
            type: 'string',
            description:
              'Dirección física de la obra (si no se indica y el cliente tiene dirección, se usa la del cliente)',
          },
          fecha_inicio: {
            type: 'string',
            description: 'Fecha inicio (YYYY-MM-DD) opcional',
          },
          descripcion: { type: 'string', description: 'Descripción opcional' },
        },
        required: ['nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_obra',
      description:
        'Actualiza campos de una obra existente en la base de datos. DEBES llamar a esta tool cuando el usuario pida vincular un cliente a una obra, cambiar la dirección, el estado o cualquier dato de la obra. NO uses guardar_memoria para vincular clientes a obras — eso solo guarda texto, no modifica la base de datos. Para vincular un cliente: pasa obra_id (o busca la obra por nombre primero con listar_obras) y cliente_id del cliente.',
      parameters: {
        type: 'object',
        properties: {
          obra_id: { type: 'string', description: 'UUID de la obra' },
          obra_nombre: {
            type: 'string',
            description: 'Nombre de la obra (si no se conoce el id)',
          },
          nombre: { type: 'string', description: 'Nuevo nombre de la obra' },
          cliente_nombre: {
            type: 'string',
            description: 'Nombre del cliente a vincular si no se tiene cliente_id',
          },
          cliente_id: {
            type: 'string',
            description: 'UUID de ficha de cliente',
          },
          direccion: { type: 'string', description: 'Dirección de la obra' },
          estado: {
            type: 'string',
            description: 'abierta | en_curso | pausada | cerrada',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_obra',
      description: 'Busca una obra por nombre o cliente.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_ficha_obra',
      description:
        'Muestra la ficha completa de una obra con todos sus documentos, diario y gastos. Si solo envías el nombre, busca la obra primero.',
      parameters: {
        type: 'object',
        properties: {
          obra_id: { type: 'string', description: 'UUID de la obra' },
          obra_nombre: {
            type: 'string',
            description: 'Nombre de la obra (buscar si no hay id)',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'asociar_documentos_a_obra',
      description:
        'Asocia documentos existentes (presupuestos, facturas, albaranes, gastos, entradas de diario) a una obra. Usar cuando el usuario pida vincular documentos de un cliente a una obra específica.',
      parameters: {
        type: 'object',
        properties: {
          obra_id: { type: 'string', description: 'UUID de la obra' },
          obra_nombre: { type: 'string', description: 'Nombre de la obra (buscar si no hay id)' },
          cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
          cliente_id: { type: 'string', description: 'UUID del cliente (si existe)' },
          tipos: {
            type: 'array',
            description: 'Tipos a asociar (por defecto: todos)',
            items: {
              type: 'string',
              enum: ['presupuestos', 'facturas', 'albaranes', 'gastos', 'diario'],
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_cliente',
      description:
        'Nueva ficha de cliente (nombre obligatorio; contacto y notas opcionales). Tras crear, devuelve id del nuevo cliente. Si ya existe un cliente con el mismo nombre o muy parecido en el negocio, no crea duplicado: devuelve id del existente y mensaje.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre o razón social' },
          telefono: { type: 'string', description: 'Teléfono' },
          email: { type: 'string', description: 'Email' },
          direccion: { type: 'string', description: 'Dirección' },
          nif: { type: 'string', description: 'NIF/CIF' },
          notas: { type: 'string', description: 'Notas internas' },
        },
        required: ['nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Búsqueda parcial por nombre, email o teléfono.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_cliente',
      description: 'Ficha completa e historial: presupuestos, facturas, albaranes, diario.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'UUID del cliente' },
        },
        required: ['cliente_id'],
        additionalProperties: false,
      },
    },
  },
];

export async function handleObrasClientesAgent(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  authUserId: string | null,
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  void authUserId;
  const bid = typeof businessId === 'string' ? businessId : String(businessId ?? '');
  if (!bid) return { error: 'business_id es requerido' };

  switch (toolName) {
        case 'crear_obra': {
          const nombre = String(toolArgs.nombre ?? '').trim();
          if (!nombre) return { error: 'nombre es obligatorio' };

          const nombreObraNorm = normalizarNombreComparable(nombre);
          const { data: obrasExistentes, error: errObrasDup } = await supabase
            .from('obras')
            .select('id, nombre')
            .eq('business_id', bid);
          if (errObrasDup) return { error: errObrasDup.message };
          for (const oRow of obrasExistentes ?? []) {
            const nomO = String((oRow as { nombre?: string | null }).nombre ?? '').trim();
            if (!nomO) continue;
            if (normalizarNombreComparable(nomO) === nombreObraNorm) {
              return {
                id: String((oRow as { id: string }).id),
                mensaje: `La obra '${nomO}' ya existe, usando la existente.`,
                existente: true,
              };
            }
          }

          const direccionTool =
            typeof toolArgs.direccion_obra === 'string'
              ? toolArgs.direccion_obra.trim()
              : typeof toolArgs.direccion === 'string'
                ? toolArgs.direccion.trim()
                : '';
          const fechaInicio =
            typeof toolArgs.fecha_inicio === 'string' ? toolArgs.fecha_inicio.trim() : '';
          const descripcion =
            typeof toolArgs.descripcion === 'string' ? toolArgs.descripcion.trim() : '';

          let clienteId: string | null = null;
          let clienteNombreResuelto: string | null = null;
          let clienteDireccion: string | null = null;

          const cr = await resolveClienteIdOpcional(supabase, bid, toolArgs.cliente_id);
          if (!cr.ok) return { error: cr.error };
          clienteId = cr.id;

          if (clienteId) {
            const { data: cliRow } = await supabase
              .from('clientes')
              .select('nombre, direccion')
              .eq('id', clienteId)
              .eq('business_id', bid)
              .maybeSingle();
            if (cliRow) {
              clienteNombreResuelto = String((cliRow as { nombre?: string }).nombre ?? '').trim() || null;
              const d = (cliRow as { direccion?: string | null }).direccion;
              clienteDireccion = d != null && String(d).trim() ? String(d).trim() : null;
            }
          }

          let avisoSinCliente = false;
          if (!clienteId) {
            const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim();
            if (clienteNombre) {
              const safeQ = clienteNombre.replace(/[%_*]/g, '').slice(0, 120);
              const pat = `%${safeQ}%`;
              const { data: row } = await supabase
                .from('clientes')
                .select('id, nombre, email, direccion')
                .eq('business_id', bid)
                .ilike('nombre', pat)
                .order('nombre', { ascending: true })
                .limit(1)
                .maybeSingle();
              if (row?.id) {
                clienteId = String((row as { id: string }).id);
                clienteNombreResuelto = String((row as { nombre?: string }).nombre ?? '').trim() || clienteNombre;
                const d = (row as { direccion?: string | null }).direccion;
                clienteDireccion = d != null && String(d).trim() ? String(d).trim() : null;
              } else {
                avisoSinCliente = true;
              }
            }
          }

          if (avisoSinCliente) {
            const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim();
            // Si hay datos de cliente disponibles en toolArgs, crearlo automáticamente
            const telefonoCli =
              typeof toolArgs.cliente_telefono === 'string'
                ? toolArgs.cliente_telefono.trim() || null
                : null;
            const emailCli =
              typeof toolArgs.cliente_email === 'string'
                ? toolArgs.cliente_email.trim() || null
                : null;
            const sinDatosCliente =
              telefonoCli === null && emailCli === null && clienteNombre === '';
            if (!sinDatosCliente) {
              const { data: newCli, error: newCliErr } = await supabase
                .from('clientes')
                .insert({
                  business_id: bid,
                  nombre: clienteNombre,
                  telefono: telefonoCli,
                  email: emailCli,
                })
                .select('id')
                .maybeSingle();
              if (!newCliErr && newCli?.id) {
                clienteId = String((newCli as { id: string }).id);
                clienteNombreResuelto = clienteNombre;
              }
            }
          }

          const direccionObraFinal =
            direccionTool ||
            (!direccionTool && clienteDireccion ? clienteDireccion : '') ||
            '';

          const { error } = await supabase.from('obras').insert({
            business_id: bid,
            nombre,
            ...(clienteId ? { cliente_id: clienteId } : { cliente_id: null }),
            ...(direccionObraFinal ? { direccion: direccionObraFinal } : { direccion: null }),
            ...(fechaInicio ? { fecha_inicio: fechaInicio } : { fecha_inicio: null }),
            ...(descripcion ? { descripcion } : { descripcion: null }),
            estado: 'abierta',
          });

          if (error) return { error: error.message };

          const dirMsg = direccionObraFinal || 'sin dirección';
          const cliMsg = clienteNombreResuelto ?? 'sin cliente';
          return {
            mensaje: `Obra '${nombre}' creada para ${cliMsg} en ${dirMsg}. Estado: Abierta.`,
          };
        }
        case 'actualizar_obra': {
          const ESTADOS_OBRA = new Set(['abierta', 'en_curso', 'pausada', 'cerrada']);
          let obraId = String(toolArgs.obra_id ?? '').trim();
          const obraNombreBuscar = String(toolArgs.obra_nombre ?? '').trim();

          if (!obraId) {
            if (!obraNombreBuscar) {
              return { error: 'obra_id u obra_nombre es obligatorio' };
            }
            const safeQ = obraNombreBuscar.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: rowObra, error: errObra } = await supabase
              .from('obras')
              .select('id')
              .eq('business_id', bid)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (errObra) return { error: errObra.message };
            if (!rowObra?.id) return { error: 'No se encontró la obra' };
            obraId = rowObra.id;
          } else {
            const { data: ex } = await supabase
              .from('obras')
              .select('id')
              .eq('id', obraId)
              .eq('business_id', bid)
              .maybeSingle();
            if (!ex?.id) return { error: 'Obra no encontrada' };
          }

          let clienteIdUpdate: string | undefined;
          const cidRaw = String(toolArgs.cliente_id ?? '').trim();
          const cnameRaw = String(toolArgs.cliente_nombre ?? '').trim();
          if (cidRaw) {
            const cr = await resolveClienteIdOpcional(supabase, bid, cidRaw);
            if (!cr.ok) return { error: cr.error };
            if (!cr.id) return { error: 'cliente_id no válido' };
            clienteIdUpdate = cr.id;
          } else if (cnameRaw) {
            const safe = cnameRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safe}%`;
            const { data: rowC, error: errC } = await supabase
              .from('clientes')
              .select('id')
              .eq('business_id', bid)
              .ilike('nombre', pat)
              .order('nombre', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (errC) return { error: errC.message };
            if (!rowC?.id) {
              return { error: `No se encontró el cliente "${cnameRaw}"` };
            }
            clienteIdUpdate = String((rowC as { id: string }).id);
          }

          const updates: Record<string, unknown> = {};
          const nombreNuevo = typeof toolArgs.nombre === 'string' ? toolArgs.nombre.trim() : '';
          if (nombreNuevo) updates.nombre = nombreNuevo;
          if (toolArgs.direccion !== undefined) {
            updates.direccion =
              typeof toolArgs.direccion === 'string' && toolArgs.direccion.trim()
                ? toolArgs.direccion.trim()
                : null;
          }
          if (typeof toolArgs.estado === 'string' && toolArgs.estado.trim()) {
            const est = toolArgs.estado.trim().toLowerCase();
            if (!ESTADOS_OBRA.has(est)) {
              return {
                error: `estado inválido. Usa: ${Array.from(ESTADOS_OBRA).join(', ')}`,
              };
            }
            updates.estado = est;
          }
          if (clienteIdUpdate !== undefined) {
            updates.cliente_id = clienteIdUpdate;
          }

          if (Object.keys(updates).length === 0) {
            return {
              error:
                'Indica al menos un campo a actualizar (nombre, direccion, estado, cliente_nombre o cliente_id)',
            };
          }

          updates.updated_at = new Date().toISOString();

          const { data: updated, error: updErr } = await supabase
            .from('obras')
            .update(updates)
            .eq('id', obraId)
            .eq('business_id', bid)
            .select('nombre')
            .maybeSingle();

          if (updErr || !updated) {
            return { error: updErr?.message ?? 'No se pudo actualizar la obra' };
          }
          const nombreFinal = String((updated as { nombre?: string }).nombre ?? '');
          return { mensaje: `Obra '${nombreFinal}' actualizada correctamente.` };
        }
        case 'buscar_obra': {
          const qBus = String(toolArgs.query ?? '').trim();
          if (!qBus) return { error: 'query es obligatorio' };

          const safeQ = qBus.replace(/[%_*]/g, '').slice(0, 120);
          const pat = `%${safeQ}%`;

          const { data: obrasRows, error } = await supabase
            .from('obras')
            .select('id, nombre, cliente_id, direccion, estado, fecha_inicio, created_at')
            .eq('business_id', bid)
            .ilike('nombre', pat)
            .order('created_at', { ascending: false })
            .limit(20);

          if (error) return { error: error.message };

          const obras = obrasRows ?? [];
          const clienteIds = (obras as Array<{ cliente_id: string | null }>).map((o) => o.cliente_id).filter((id0): id0 is string => Boolean(id0));
          if (clienteIds.length === 0) {
            return {
              items: (obras as Array<{ id: string; nombre: string; direccion: string | null; estado: string | null; fecha_inicio: string | null }>).map((o) => ({
                id: o.id,
                nombre: o.nombre,
                cliente_nombre: null,
                direccion: o.direccion ?? null,
                estado: o.estado ?? null,
                fecha_inicio: o.fecha_inicio ?? null,
              })),
            };
          }

          const { data: clientesRows } = await supabase
            .from('clientes')
            .select('id, nombre')
            .eq('business_id', bid)
            .in('id', clienteIds);

          const clienteMap = new Map<string, string>();
          for (const c of (clientesRows ?? []) as Array<{ id: string; nombre: string }>) {
            clienteMap.set(c.id, c.nombre);
          }

          return {
            items: (obras as Array<{ id: string; nombre: string; cliente_id: string | null; direccion: string | null; estado: string | null; fecha_inicio: string | null }>).map((o) => ({
              id: o.id,
              nombre: o.nombre,
              cliente_nombre: o.cliente_id ? clienteMap.get(o.cliente_id) ?? null : null,
              direccion: o.direccion ?? null,
              estado: o.estado ?? null,
              fecha_inicio: o.fecha_inicio ?? null,
            })),
          };
        }
        case 'ver_ficha_obra': {
          const obraIdRaw = String(toolArgs.obra_id ?? '').trim();
          const obraNombreRaw = String(toolArgs.obra_nombre ?? '').trim();

          if (!obraIdRaw && !obraNombreRaw) {
            return { error: 'obra_id u obra_nombre es obligatorio' };
          }

          let obraId = obraIdRaw;
          let obraNombre = obraNombreRaw;

          if (!obraId) {
            const safeQ = obraNombre.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre, cliente_id')
              .eq('business_id', bid)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            if (!row?.id) return { error: 'No se encontró la obra' };
            obraId = row.id;
            obraNombre = row.nombre ?? obraNombre;
          }

          const { data: obraRow, error: obraErr } = await supabase
            .from('obras')
            .select('id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, descripcion')
            .eq('id', obraId)
            .maybeSingle();

          if (obraErr || !obraRow) return { error: 'Obra no encontrada' };

          const clienteId = (obraRow.cliente_id as string | null) ?? null;
          const { data: clienteRow } = clienteId
            ? await supabase
                .from('clientes')
                .select('id, nombre, telefono, email, direccion, nif, notas')
                .eq('id', clienteId)
                .maybeSingle()
            : { data: null };

          const [presRes, facRes, albRes, dioRes, gastRes] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('facturas')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('albaranes')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('diario_obra')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
            supabase
              .from('gastos')
              .select('*')
              .eq('obra_id', obraId)
              .order('fecha', { ascending: false }),
          ]);

          const presupuestos = presRes.data ?? [];
          const facturas = facRes.data ?? [];
          const albaranes = albRes.data ?? [];
          const entradasDiario = dioRes.data ?? [];
          const gastos = gastRes.data ?? [];

          const resumen = [
            `📋 **Ficha de obra**: ${obraRow.nombre}`,
            `Cliente: ${clienteRow?.nombre ?? '—'}`,
            `Estado: ${obraRow.estado ?? '—'}`,
            `Presupuestos: ${presupuestos.length}`,
            `Facturas: ${facturas.length}`,
            `Albaranes: ${albaranes.length}`,
            `Entradas diario: ${entradasDiario.length}`,
            `Gastos: ${gastos.length}`,
          ].join('\n');

          return {
            mensaje: resumen,
            accion: 'abrir_ficha_obra',
            obra_id: obraId,
            obra_nombre: obraNombre,
          };
        }
        case 'asociar_documentos_a_obra': {
          const obraIdRaw = String(toolArgs.obra_id ?? '').trim();
          const obraNombreRaw = String(toolArgs.obra_nombre ?? '').trim();

          const clienteIdRaw = String(toolArgs.cliente_id ?? '').trim();
          const clienteNombreRaw = String(toolArgs.cliente_nombre ?? '').trim();

          const tiposPermitidos = ['presupuestos', 'facturas', 'albaranes', 'gastos', 'diario'] as const;
          type TipoPermitido = typeof tiposPermitidos[number];
          const esTipoPermitido = (t: string): t is TipoPermitido =>
            (tiposPermitidos as readonly string[]).includes(t);
          const tiposFinal =
            Array.isArray(toolArgs.tipos) && toolArgs.tipos.length > 0
              ? (toolArgs.tipos as unknown[])
                  .map((t) => String(t).trim().toLowerCase())
                  .filter(esTipoPermitido)
              : [...tiposPermitidos];

          if (tiposFinal.length === 0) {
            return { error: 'tipos no válido' };
          }

          let obraId = obraIdRaw;
          let obraNombre = obraNombreRaw;

          if (!obraId && obraNombreRaw) {
            const safeQ = obraNombreRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre')
              .eq('business_id', bid)
              .ilike('nombre', pat)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            if (!row?.id) return { error: 'No se encontró la obra' };
            obraId = row.id;
            obraNombre = row.nombre ?? obraNombreRaw;
          }

          if (!obraId) {
            return { error: 'obra_id u obra_nombre es obligatorio' };
          }

          if (!obraNombre) {
            const { data: row, error: err } = await supabase
              .from('obras')
              .select('id, nombre')
              .eq('business_id', bid)
              .eq('id', obraId)
              .maybeSingle();
            if (err) return { error: err.message };
            obraNombre = row?.nombre ?? obraNombreRaw ?? '';
          }

          let clienteId = clienteIdRaw;
          if (!clienteId && clienteNombreRaw) {
            const safeQ = clienteNombreRaw.replace(/[%_*]/g, '').slice(0, 120);
            const pat = `%${safeQ}%`;
            const { data: row, error: err } = await supabase
              .from('clientes')
              .select('id, nombre')
              .eq('business_id', bid)
              .ilike('nombre', pat)
              .order('nombre', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (err) return { error: err.message };
            clienteId = row?.id ?? '';
          }

          const necesitaCliente =
            tiposFinal.some((t) => (['presupuestos', 'facturas', 'albaranes', 'gastos'] as readonly TipoPermitido[]).includes(t));
          if (necesitaCliente && !clienteId) {
            return { error: 'cliente_id o cliente_nombre es obligatorio para asociar presupuestos/facturas/albaranes/gastos' };
          }

          if (tiposFinal.includes('diario') && !clienteId && !(obraNombre || obraNombreRaw)) {
            return { error: 'obra_nombre o cliente_id es obligatorio para asociar entradas de diario' };
          }

          const updateNoDiario = async (table: string) => {
            const { data, error } = await supabase
              .from(table)
              .update({ obra_id: obraId })
              .eq('business_id', bid)
              .eq('cliente_id', clienteId)
              .is('obra_id', null)
              .select('id');
            if (error) throw new Error(error.message);
            return (data ?? []).length;
          };

          const updateDiario = async () => {
            let q = supabase
              .from('diario_obra')
              .update({ obra_id: obraId })
              .eq('business_id', bid)
              .is('obra_id', null);

            if (clienteId) {
              q = q.eq('cliente_id', clienteId);
            } else {
              const safeQ = (obraNombre || obraNombreRaw).replace(/[%_*]/g, '').slice(0, 120);
              const pat = `%${safeQ}%`;
              q = q.ilike('obra_nombre', pat);
            }

            const { data, error } = await q.select('id');
            if (error) throw new Error(error.message);
            return (data ?? []).length;
          };

          const [nPres, nFac, nAlb] = await Promise.all([
            tiposFinal.includes('presupuestos') ? updateNoDiario('presupuestos') : Promise.resolve(0),
            tiposFinal.includes('facturas') ? updateNoDiario('facturas') : Promise.resolve(0),
            tiposFinal.includes('albaranes') ? updateNoDiario('albaranes') : Promise.resolve(0),
            tiposFinal.includes('gastos') ? updateNoDiario('gastos') : Promise.resolve(0),
            tiposFinal.includes('diario') ? updateDiario() : Promise.resolve(0),
          ]);

          const mensaje = `Asociados ${nPres} presupuestos, ${nFac} facturas, ${nAlb} albaranes a la obra '${obraNombre}'.`;

          return { mensaje, ok: true };
        }
        case 'crear_cliente': {
          const nombreCli = String(toolArgs.nombre ?? '').trim();
          if (!nombreCli) {
            return { error: 'nombre es obligatorio' };
          }
          const { data: clientesRows, error: errCliList } = await supabase
            .from('clientes')
            .select('id, nombre')
            .eq('business_id', bid);
          if (errCliList) return { error: errCliList.message };
          const similar = buscarClienteSimilarExistente(nombreCli, clientesRows ?? []);
          if (similar) {
            return {
              id: similar.id,
              mensaje: `El cliente ${similar.nombre} ya existe, usando el existente.`,
              existente: true,
            };
          }
          const telefono =
            toolArgs.telefono != null ? String(toolArgs.telefono).trim() || null : null;
          const email = toolArgs.email != null ? String(toolArgs.email).trim() || null : null;
          const direccion =
            toolArgs.direccion != null ? String(toolArgs.direccion).trim() || null : null;
          const nif = toolArgs.nif != null ? String(toolArgs.nif).trim() || null : null;
          const notas = toolArgs.notas != null ? String(toolArgs.notas).trim() || null : null;

          const { data: insertedCli, error } = await supabase
            .from('clientes')
            .insert({
              business_id: bid,
              nombre: nombreCli,
              telefono,
              email,
              direccion,
              nif,
              notas,
            })
            .select('id')
            .maybeSingle();

          if (error) {
            console.error('[crear_cliente] insert failed:', error.message, error);
            return { error: error.message };
          }
          const nuevoId =
            insertedCli && typeof (insertedCli as { id?: string }).id === 'string'
              ? (insertedCli as { id: string }).id.trim()
              : '';
          if (!nuevoId) {
            console.error(
              '[crear_cliente] insert sin error pero sin id devuelto (revisa RLS o select)'
            );
            return {
              error: 'No se pudo confirmar el cliente creado. Revisa permisos o inténtalo de nuevo.',
            };
          }
          return {
            id: nuevoId,
            mensaje: `Cliente ${nombreCli} creado correctamente.`,
          };
        }
        case 'buscar_cliente': {
          const qBus = String(toolArgs.query ?? '').trim();
          if (!qBus) {
            return { error: 'query es obligatorio' };
          }
          const safeQ = qBus.replace(/[%_*]/g, '').slice(0, 120);
          if (!safeQ) {
            return { items: [] };
          }
          const pat = `%${safeQ}%`;
          const { data: rowsB, error: errB } = await supabase
            .from('clientes')
            .select('id, nombre, email, telefono')
            .eq('business_id', bid)
            .or(`nombre.ilike.${pat},email.ilike.${pat},telefono.ilike.${pat}`)
            .order('nombre', { ascending: true })
            .limit(50);
          if (errB) return { error: errB.message };
          const listB = rowsB ?? [];
          const idsB = listB.map((r: { id: string }) => r.id);
          if (idsB.length === 0) return { items: [] };

          const [presB, facB, albB] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('cliente_id')
              .eq('business_id', bid)
              .in('cliente_id', idsB),
            supabase
              .from('facturas')
              .select('cliente_id')
              .eq('business_id', bid)
              .in('cliente_id', idsB),
            supabase
              .from('albaranes')
              .select('cliente_id')
              .eq('business_id', bid)
              .in('cliente_id', idsB),
          ]);

          const acumDocs = (rows: { cliente_id: string | null }[] | null) => {
            const m = new Map<string, number>();
            for (const id0 of idsB) m.set(id0, 0);
            for (const r of rows ?? []) {
              const c = r.cliente_id;
              if (!c) continue;
              m.set(c, (m.get(c) ?? 0) + 1);
            }
            return m;
          };
          const mpB = acumDocs(presB.data as { cliente_id: string | null }[] | null);
          const mfB = acumDocs(facB.data as { cliente_id: string | null }[] | null);
          const maB = acumDocs(albB.data as { cliente_id: string | null }[] | null);

          return {
            items: listB.map(
              (r: {
                id: string;
                nombre: string;
                email: string | null;
                telefono: string | null;
              }) => ({
                id: r.id,
                nombre: r.nombre,
                email: r.email,
                telefono: r.telefono,
                num_documentos:
                  (mpB.get(r.id) ?? 0) + (mfB.get(r.id) ?? 0) + (maB.get(r.id) ?? 0),
              })
            ),
          };
        }
        case 'ver_cliente': {
          const idVer = String(toolArgs.cliente_id ?? '').trim();
          if (!idVer) {
            return { error: 'cliente_id es obligatorio' };
          }
          const { data: cliV, error: eCli } = await supabase
            .from('clientes')
            .select(
              'id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at'
            )
            .eq('id', idVer)
            .eq('business_id', bid)
            .maybeSingle();
          if (eCli) return { error: eCli.message };
          if (!cliV) return { error: 'Cliente no encontrado' };

          const [presV, facV, albV, dioV] = await Promise.all([
            supabase
              .from('presupuestos')
              .select('id, estado, importe_total, fecha')
              .eq('cliente_id', idVer)
              .eq('business_id', bid)
              .order('fecha', { ascending: false }),
            supabase
              .from('facturas')
              .select('id, estado, total, fecha, numero_factura')
              .eq('cliente_id', idVer)
              .eq('business_id', bid)
              .order('fecha', { ascending: false }),
            supabase
              .from('albaranes')
              .select('id, estado, fecha, total, numero_albaran')
              .eq('cliente_id', idVer)
              .eq('business_id', bid)
              .order('fecha', { ascending: false }),
            supabase
              .from('diario_obra')
              .select('id, obra_nombre, texto, fecha')
              .eq('cliente_id', idVer)
              .eq('business_id', bid)
              .order('fecha', { ascending: false }),
          ]);

          const c = cliV as Record<string, unknown>;
          const lineas: string[] = [];
          lineas.push(`**${String(c.nombre ?? '')}**`);
          lineas.push(`Teléfono: ${c.telefono != null && String(c.telefono) ? String(c.telefono) : '—'}`);
          lineas.push(`Email: ${c.email != null && String(c.email) ? String(c.email) : '—'}`);
          lineas.push(`Dirección: ${c.direccion != null && String(c.direccion) ? String(c.direccion) : '—'}`);
          lineas.push(`NIF: ${c.nif != null && String(c.nif) ? String(c.nif) : '—'}`);
          if (c.notas != null && String(c.notas).trim()) {
            lineas.push(`Notas: ${String(c.notas).trim()}`);
          }
          lineas.push('');
          lineas.push('### Presupuestos');
          const pv = presV.data ?? [];
          if (pv.length === 0) lineas.push('— Ninguno');
          else {
            for (const p of pv as { fecha?: string; estado?: string; importe_total?: number }[]) {
              lineas.push(
                `- ${p.fecha ?? '—'} · ${p.estado ?? '—'} · ${p.importe_total != null ? `${p.importe_total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Facturas');
          const fv = facV.data ?? [];
          if (fv.length === 0) lineas.push('— Ninguna');
          else {
            for (const f of fv as {
              fecha?: string;
              estado?: string;
              total?: number;
              numero_factura?: string | null;
            }[]) {
              lineas.push(
                `- ${f.numero_factura ?? '—'} · ${f.fecha ?? '—'} · ${f.estado ?? '—'} · ${f.total != null ? `${f.total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Albaranes');
          const av = albV.data ?? [];
          if (av.length === 0) lineas.push('— Ninguno');
          else {
            for (const a of av as {
              fecha?: string;
              estado?: string;
              total?: number | null;
              numero_albaran?: string | null;
            }[]) {
              lineas.push(
                `- ${a.numero_albaran ?? '—'} · ${a.fecha ?? '—'} · ${a.estado ?? '—'} · ${a.total != null ? `${a.total} €` : '—'}`
              );
            }
          }
          lineas.push('');
          lineas.push('### Diario de obra');
          const dv = dioV.data ?? [];
          if (dv.length === 0) lineas.push('— Sin entradas');
          else {
            for (const d of dv as { fecha?: string; obra_nombre?: string; texto?: string | null }[]) {
              const frag = d.texto != null && String(d.texto).trim() ? String(d.texto).slice(0, 80) : '';
              lineas.push(`- ${d.obra_nombre ?? 'Obra'} (${d.fecha ?? '—'})${frag ? `: ${frag}` : ''}`);
            }
          }

          return {
            ficha: lineas.join('\n'),
            cliente: cliV,
            presupuestos: presV.data ?? [],
            facturas: facV.data ?? [],
            albaranes: albV.data ?? [],
            diario_obra: dioV.data ?? [],
          };
        }
    default:
      return { error: `Tool de obras/clientes no soportada: ${toolName}` };
  }
}

