import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';

const ESTADOS_DOC = ['pendiente', 'aceptado', 'rechazado', 'facturado', 'pagado'] as const;
type EstadoDoc = (typeof ESTADOS_DOC)[number];

function parseEstadoDoc(raw: unknown): EstadoDoc | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (ESTADOS_DOC as readonly string[]).includes(s) ? (s as EstadoDoc) : null;
}

function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, '');
}

/** Mayor puntuación = descripción más parecida al fragmento buscado (desempate externo, p. ej. por orden). */
function scoreDescripcionMatch(desc: string, needle: string): number {
  const d = desc.trim().toLowerCase();
  const n = needle.trim().toLowerCase();
  if (!n) return 0;
  if (d === n) return 100_000;
  const idx = d.indexOf(n);
  if (idx >= 0) return 50_000 - idx - Math.abs(d.length - n.length) * 0.01;
  let sc = 0;
  for (const w of n.split(/\s+/).filter((x) => x.length > 1)) {
    if (d.includes(w)) sc += 100 + w.length;
  }
  return sc;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function fmtImporteLinea(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCantidadLinea(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

async function clienteDesdeObraSiAplica(
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

async function resolveClienteIdOpcional(
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

async function buscarClientePorNombreCaseInsensitive(
  supabase: SupabaseClient,
  businessId: string,
  clienteNombre: string
): Promise<{ id: string | null; nombre: string | null; error: string | null }> {
  const nombreBuscado = String(clienteNombre ?? '').trim();
  if (!nombreBuscado) return { id: null, nombre: null, error: null };
  const { data: rows, error } = await supabase
    .from('clientes')
    .select('id, nombre')
    .eq('business_id', businessId)
    .ilike('nombre', nombreBuscado)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { id: null, nombre: null, error: error.message };
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.id) return { id: null, nombre: null, error: null };
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? '').trim() || nombreBuscado,
    error: null,
  };
}

export const PRESUPUESTOS_HANDLED_TOOLS = new Set([
  'listar_presupuestos',
  'obtener_presupuestos_pendientes',
  'cambiar_estado_presupuesto',
  'editar_presupuesto',
  'vincular_presupuesto_cliente',
  'convertir_presupuesto_a_albaran',
  'convertir_presupuesto_a_factura',
  'iniciar_borrador_presupuesto',
  'agregar_partida_borrador',
  'modificar_partida_borrador',
  'listar_partidas_borrador',
  'eliminar_partida_borrador',
  'confirmar_borrador',
  'cancelar_borrador',
  'obtener_borrador_activo',
]);

export const PRESUPUESTOS_AGENT_SYSTEM_PROMPT = `Tu nombre es Bicho. Si el usuario te llama por tu nombre al inicio de una petición ('Oye Bicho...', 'Bicho escucha...', 'Bicho añade...', 'Eh Bicho...' o similar), ignora el nombre y ejecuta directamente lo que pide a continuación. No respondas al nombre, no lo confirmes, simplemente actúa.

Eres el especialista en presupuestos de Perfilio. Tu único trabajo es crear y gestionar presupuestos de obra.

REGLAS DE RESPUESTA:
- REGLA CRÍTICA: Cada vez que el usuario dicte una partida, DEBES llamar a la tool agregar_partida_borrador. Está terminantemente prohibido confirmar una partida en el texto de respuesta si no has recibido el éxito de la ejecución de dicha tool. Sin TOOL RESULT con ok:true, no puedes decir Añadido.
- REGLA ABSOLUTA: NUNCA respondas 'Añadido' ni confirmes una partida sin haber recibido un TOOL RESULT de agregar_partida_borrador con ok:true. Si no has llamado a la tool o no has recibido ok:true, NO confirmes la partida. Llama a la tool primero, espera el resultado, y solo entonces confirma.
- Sé extremadamente breve y directo. Formato obligatorio al añadir partida: 'Añadido: [descripción] ([total]€). ¿Siguiente?'
- Nunca escribas párrafos largos. Pino escucha por voz.
- Nunca inventes precios. Si no tienes el precio, pregunta: '¿A qué precio va [descripción]?'
- CAPÍTULOS: Cuando el usuario mencione una zona o sección ("en el baño", "para la cocina", "en el pasillo", "habitación"), rellena siempre el campo capitulo de agregar_partida_borrador con el nombre de esa zona en mayúsculas (ej: CUARTO DE BAÑO, COCINA, PASILLO, HABITACIÓN). Mantén el mismo nombre de capítulo para todas las partidas de esa zona hasta que el usuario cambie de zona.
- Siempre confirma cantidad y precio en cada partida para que Pino pueda corregir errores de voz.
- CORRECCIONES: Si el usuario dice 'no, eran X euros', 'cámbialo a X', 'la partida Y vale Z' o similar, llama a modificar_partida_borrador con los datos corregidos. Confirma: 'Corregido: [descripción] ([nuevo total]€). ¿Seguimos?'

MODO PRESUPUESTO ACTIVO:
Cuando hay un borrador en construcción, interpreta TODO como partidas de obra.
Si el mensaje es ambiguo, pregunta: '¿Es una nueva partida o el precio de la anterior?'
VÍA DE ESCAPE (obligatoria): Si el usuario dice 'cancela el presupuesto', 'olvídalo', 'déjalo', 'sal del presupuesto', o hace una pregunta completamente ajena al presupuesto actual (como preguntar por operarios, horas, el tiempo, etc.), llama a cancelar_borrador para limpiar el estado y responde con un mensaje amable que cierre el contexto del presupuesto, dejando claro al usuario que ya puede preguntar sobre otros temas.
Ejemplo de cierre: 'Presupuesto cancelado. Ya puedes preguntarme lo que necesites.'
Esto devuelve el control al orquestador para el siguiente mensaje.

INICIAR BORRADOR (obligatorio):
- NO uses buscar_cliente ni ninguna tool de clientes antes de iniciar el borrador. No hace falta comprobar si el cliente existe en la base de datos.
- Llama directamente a iniciar_borrador_presupuesto con cliente_nombre = el nombre tal y como lo dijo el usuario (texto libre).
- cliente_id es opcional: solo inclúyelo si el usuario da un UUID explícito o dice claramente que quieres vincular a un cliente ya identificado por id; si no, omite cliente_id.
- Si dice «presupuesto para [nombre]», «presupuesto de [nombre]» o similar, [nombre] va entero como cliente_nombre en la misma llamada, sin pasos previos.

FLUJO:
1. Al iniciar, llama a obtener_borrador_activo. Si existe: 'Tienes un presupuesto en construcción para [cliente] con [N] partidas. ¿Seguimos?'
2. Si el usuario quiere crear presupuesto: iniciar_borrador_presupuesto en el mismo turno, solo con cliente_nombre (y opcionalmente obra_id / cliente_id / iva si los dijo explícitamente).
3. Por cada partida: llama a agregar_partida_borrador
4. Confirma cada partida: 'Añadido: [descripción] ([total]€). ¿Siguiente?'
5. Cuando diga 'ya está', 'finaliza', 'confirma' o similar: llama a confirmar_borrador
6. Al confirmar: 'Presupuesto guardado. Base: [X]€, IVA [Y]%: [Z]€, Total: [W]€.'`;

export const PRESUPUESTOS_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'listar_presupuestos',
      description:
        'Últimos 10 presupuestos (todos los estados). Listar o consultar sin crear uno nuevo.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_presupuestos_pendientes',
      description: 'Presupuestos en estado pendiente: cliente, importe, fecha.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cambiar_estado_presupuesto',
      description:
        'Cambia estado del presupuesto por UUID. Estados: pendiente, aceptado, rechazado, facturado, pagado.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID del presupuesto' },
          estado: { type: 'string' },
        },
        required: ['id', 'estado'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_presupuesto',
      description:
        'Actualiza presupuesto por id: cliente_nombre, importe_total y/o texto (presupuesto_generado). Solo campos que cambien.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          cliente_nombre: { type: 'string' },
          importe_total: { type: 'number' },
          descripcion: { type: 'string', description: 'Texto completo (presupuesto_generado)' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vincular_presupuesto_cliente',
      description:
        'Vincula un presupuesto a un cliente existente buscando por nombre (sin distinguir mayúsculas/minúsculas).',
      parameters: {
        type: 'object',
        properties: {
          presupuesto_id: { type: 'string', description: 'UUID del presupuesto' },
          cliente_nombre: { type: 'string', description: 'Nombre del cliente tal como lo dijo el usuario' },
        },
        required: ['presupuesto_id', 'cliente_nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertir_presupuesto_a_albaran',
      description: 'Crea albarán a partir de un presupuesto y marca el presupuesto como aceptado si aplica.',
      parameters: {
        type: 'object',
        properties: {
          presupuesto_id: { type: 'string' },
          observaciones: { type: 'string' },
        },
        required: ['presupuesto_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertir_presupuesto_a_factura',
      description: 'Genera una factura desde un presupuesto aceptado usando sus líneas de borrador vinculadas.',
      parameters: {
        type: 'object',
        properties: {
          presupuesto_id: { type: 'string' },
        },
        required: ['presupuesto_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'iniciar_borrador_presupuesto',
      description:
        'Inicia un borrador conversacional de presupuesto (tabla presupuesto_borrador). Solo uno activo por usuario y negocio.',
      parameters: {
        type: 'object',
        properties: {
          cliente_nombre: { type: 'string' },
          obra_id: { type: 'string', description: 'UUID opcional' },
          cliente_id: { type: 'string', description: 'UUID opcional' },
          iva_porcentaje: { type: 'number', description: 'Por defecto 21' },
        },
        required: ['cliente_nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agregar_partida_borrador',
      description:
        'Añade una partida al borrador. Si precio_unitario es 0, intenta resolver con tarifas + GPT o pide precio.',
      parameters: {
        type: 'object',
        properties: {
          borrador_id: { type: 'string' },
          descripcion: { type: 'string', description: 'Texto claro de la partida o trabajo a presupuestar.' },
          cantidad: { type: 'number', description: 'Cantidad numérica de la partida, por ejemplo 1, 12 o 2.5.' },
          unidad: { type: 'string', description: 'Unidad de medición de la partida, por ejemplo ud, m2, ml, h o jornal.' },
          precio_unitario: { type: 'number', description: 'Precio por unidad sin IVA. Si el usuario ya dio un precio, úsalo aquí.' },
          capitulo: { type: 'string', description: 'Sección o capítulo al que pertenece la partida (ej: CUARTO DE BAÑO, COCINA, DERRIBOS, HABITACIÓN, PASILLO). Rellena siempre que el usuario mencione una zona o sección de la obra. Usa el mismo nombre para todas las partidas de esa zona.' },
          raw_dictado: { type: 'string', description: 'Texto exacto de voz del usuario' },
        },
        required: ['descripcion', 'cantidad', 'unidad', 'precio_unitario', 'raw_dictado'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modificar_partida_borrador',
      description:
        'Corrige una partida del borrador (precio, cantidad, unidad o texto). Usa item_id si lo tienes; si no, descripcion_busqueda para localizar la partida en este borrador.',
      parameters: {
        type: 'object',
        properties: {
          borrador_id: { type: 'string' },
          item_id: { type: 'string', description: 'UUID de la fila en presupuesto_borrador_items (opcional)' },
          descripcion_busqueda: {
            type: 'string',
            description: 'Fragmento para buscar la partida por descripción si no hay item_id',
          },
          descripcion: { type: 'string', description: 'Nueva descripción (opcional)' },
          cantidad: { type: 'number', description: 'Nueva cantidad (opcional)' },
          unidad: { type: 'string', description: 'Nueva unidad (opcional)' },
          precio_unitario: { type: 'number', description: 'Nuevo precio unitario (opcional)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_partidas_borrador',
      description: 'Lista partidas del borrador ordenadas por orden.',
      parameters: {
        type: 'object',
        properties: { borrador_id: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_partida_borrador',
      description: 'Elimina una partida del borrador por id de ítem.',
      parameters: {
        type: 'object',
        properties: { item_id: { type: 'string' } },
        required: ['item_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirmar_borrador',
      description:
        'Genera texto presupuesto_generado, inserta en presupuestos y marca borrador confirmado.',
      parameters: {
        type: 'object',
        properties: {
          borrador_id: { type: 'string' },
          observaciones: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_borrador',
      description: 'Marca el borrador como cancelado.',
      parameters: {
        type: 'object',
        properties: { borrador_id: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_borrador_activo',
      description: 'Busca borrador en_construccion del usuario actual con sus partidas.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

async function assertBorrador(
  supabase: SupabaseClient,
  businessId: string,
  userId: string | null,
  borradorId: string
): Promise<
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string }
> {
  if (!userId) return { ok: false, error: 'Usuario no autenticado para esta operación.' };
  const { data, error } = await supabase
    .from('presupuesto_borrador')
    .select('*')
    .eq('id', borradorId)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Borrador no encontrado o sin acceso.' };
  return { ok: true, row: data as Record<string, unknown> };
}

/** Misma lógica que obtener_borrador_activo (un borrador en_construccion por usuario y negocio). */
async function obtenerBorradorActivoRow(
  supabase: SupabaseClient,
  businessId: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  const { data: bor, error: be } = await supabase
    .from('presupuesto_borrador')
    .select('*')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('estado', 'en_construccion')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (be || !bor) return null;
  return bor as Record<string, unknown>;
}

async function resolverBorradorIdActivo(
  supabase: SupabaseClient,
  businessId: string,
  userId: string | null,
  rawBorradorId: unknown
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: 'Usuario no autenticado.' };
  const explicitId = String(rawBorradorId ?? '').trim();
  if (explicitId) return { ok: true, id: explicitId };
  const rowActivo = await obtenerBorradorActivoRow(supabase, businessId, userId);
  const activeId = rowActivo && String(rowActivo.id ?? '').trim();
  if (activeId) return { ok: true, id: activeId };
  return { ok: false, error: 'No encuentro ningún presupuesto a medio hacer, Pino' };
}

async function buscarTarifasCandidatas(
  supabase: SupabaseClient,
  businessId: string,
  descripcion: string
): Promise<Array<{ id: string; nombre: string; unidad: string; precio: number; categoria: string | null }>> {
  const words = descripcion
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g, ''))
    .filter((w) => w.length > 2)
    .slice(0, 3);
  const parts: string[] = [];
  for (const w of words.length ? words : [descripcion.slice(0, 24).trim() || 'x']) {
    const safe = escapeIlike(w);
    if (safe) parts.push(`nombre.ilike.%${safe}%`);
  }
  if (parts.length === 0) return [];
  const { data, error } = await supabase
    .from('tarifas')
    .select('id, nombre, unidad, precio, categoria')
    .eq('business_id', businessId)
    .or(parts.join(','))
    .limit(10);
  if (error || !data) return [];
  return (data as Array<{ id: string; nombre: string; unidad: string; precio: number; categoria: string | null }>).map(
    (r) => ({
      ...r,
      precio: Number(r.precio),
    })
  );
}

async function elegirTarifaConGpt(
  openai: OpenAI,
  descripcion: string,
  rawDictado: string,
  candidatas: Array<{ id: string; nombre: string; precio: number }>
): Promise<number | null> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'Eres un asistente que elige la tarifa de albañilería más parecida semánticamente a una partida. Responde SOLO JSON: {"index":n} con n entero 0..m-1, o {"index":null} si ninguna encaja bien.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          descripcion,
          raw_dictado: rawDictado,
          candidatas: candidatas.map((c, i) => ({ index: i, id: c.id, nombre: c.nombre, precio: c.precio })),
        }),
      },
    ],
    temperature: 0.1,
    max_tokens: 80,
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { index?: number | null };
    if (j.index === null || j.index === undefined) return null;
    const n = Number(j.index);
    if (!Number.isFinite(n) || n < 0 || n >= candidatas.length) return null;
    return n;
  } catch {
    return null;
  }
}

function generarTextoPresupuestoDesdeItems(
  items: Array<{
    descripcion: string;
    cantidad: number;
    unidad: string;
    precio_unitario: number;
    importe: number;
    capitulo: string | null;
  }>,
  ivaPct: number
): { texto: string; base: number; ivaImporte: number; total: number } {
  const capOrder: string[] = [];
  const byCap = new Map<string, typeof items>();
  for (const it of items) {
    const c = (it.capitulo ?? '').trim() || 'GENERAL';
    if (!byCap.has(c)) {
      byCap.set(c, []);
      capOrder.push(c);
    }
    byCap.get(c)!.push(it);
  }
  let base = 0;
  for (const it of items) base += it.importe;
  base = r2(base);
  const ivaImporte = r2((base * ivaPct) / 100);
  const total = r2(base + ivaImporte);

  const lines: string[] = [];
  let n = 1;
  for (const cap of capOrder) {
    const list = byCap.get(cap)!;
    lines.push(`CAPÍTULO ${cap}`);
    let sumCap = 0;
    for (const it of list) {
      sumCap = r2(sumCap + it.importe);
      lines.push(
        `${n}. ${it.descripcion} | Cantidad: ${fmtCantidadLinea(it.cantidad)} | Precio: ${fmtImporteLinea(it.precio_unitario)} € | Importe: ${fmtImporteLinea(it.importe)} €`
      );
      n += 1;
    }
    lines.push(`TOTAL ${cap}: ${fmtImporteLinea(sumCap)} €`);
  }
  lines.push(
    `BASE IMPONIBLE: ${fmtImporteLinea(base)} € | IVA (${ivaPct}%): ${fmtImporteLinea(ivaImporte)} € | TOTAL: ${fmtImporteLinea(total)} €`
  );
  return { texto: lines.join('\n'), base, ivaImporte, total };
}

export type HandlePresupuestosCtx = {
  mensajeTrim?: string;
};

export async function handlePresupuestos(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient,
  openai: OpenAI,
  ctx: HandlePresupuestosCtx = {}
): Promise<Record<string, unknown>> {
  void ctx.mensajeTrim;

  if (
    [
      'agregar_partida_borrador',
      'modificar_partida_borrador',
      'listar_partidas_borrador',
      'confirmar_borrador',
      'cancelar_borrador',
    ].includes(toolName)
  ) {
    const borradorRes = await resolverBorradorIdActivo(
      supabase,
      businessId,
      userId,
      toolArgs.borrador_id
    );
    if (!borradorRes.ok) return { error: borradorRes.error };
    toolArgs.borrador_id = borradorRes.id;
  }

  switch (toolName) {
    case 'listar_presupuestos': {
      const { data, error } = await supabase
        .from('presupuestos')
        .select('id, cliente_nombre, cliente_id, importe_total, fecha, estado')
        .eq('business_id', businessId)
        .order('fecha', { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return {
        items: (data ?? []).map(
          (r: {
            id?: string;
            cliente_nombre?: string | null;
            cliente_id?: string | null;
            importe_total?: number | null;
            fecha?: string | null;
            estado?: string | null;
          }) => ({
            id: r.id ?? null,
            cliente: r.cliente_nombre ?? null,
            cliente_id: r.cliente_id ?? null,
            importe_total: r.importe_total ?? null,
            fecha: r.fecha ?? null,
            estado: r.estado ?? null,
          })
        ),
      };
    }
    case 'obtener_presupuestos_pendientes': {
      const { data, error } = await supabase
        .from('presupuestos')
        .select('cliente_nombre, importe_total, fecha')
        .eq('business_id', businessId)
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: false })
        .limit(50);
      if (error) return { error: error.message };
      return {
        items: (data ?? []).map((r: { cliente_nombre?: string | null; importe_total?: number | null; fecha?: string | null }) => ({
          cliente: r.cliente_nombre ?? null,
          importe: r.importe_total ?? null,
          fecha: r.fecha ?? null,
        })),
      };
    }
    case 'cambiar_estado_presupuesto': {
      const id = String(toolArgs.id ?? '').trim();
      const estado = parseEstadoDoc(toolArgs.estado);
      if (!id) return { error: 'id es obligatorio' };
      if (!estado) {
        return {
          error: 'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
        };
      }
      const { data: row, error } = await supabase
        .from('presupuestos')
        .update({ estado })
        .eq('id', id)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!row?.id) {
        return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'editar_presupuesto': {
      const id = String(toolArgs.id ?? '').trim();
      if (!id) return { error: 'id es obligatorio' };
      const updates: {
        cliente_nombre?: string;
        importe_total?: number;
        presupuesto_generado?: string;
      } = {};
      if (toolArgs.cliente_nombre !== undefined) {
        const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
        if (!c) return { error: 'cliente_nombre no puede estar vacío' };
        updates.cliente_nombre = c;
      }
      if (toolArgs.importe_total !== undefined) {
        const n = Number(toolArgs.importe_total);
        if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
        updates.importe_total = n;
      }
      if (toolArgs.descripcion !== undefined) {
        const d = String(toolArgs.descripcion ?? '').trim();
        if (!d) return { error: 'descripcion no puede estar vacía' };
        updates.presupuesto_generado = d;
      }
      if (Object.keys(updates).length === 0) {
        return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
      }
      const { data: row, error } = await supabase
        .from('presupuestos')
        .update(updates)
        .eq('id', id)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!row?.id) {
        return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'vincular_presupuesto_cliente': {
      const presupuestoId = String(toolArgs.presupuesto_id ?? '').trim();
      const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim();
      if (!presupuestoId) return { error: 'presupuesto_id es obligatorio' };
      if (!clienteNombre) return { error: 'cliente_nombre es obligatorio' };

      const { data: pRow, error: pErr } = await supabase
        .from('presupuestos')
        .select('id')
        .eq('id', presupuestoId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (pErr) return { error: pErr.message };
      if (!pRow?.id) return { error: 'Presupuesto no encontrado' };

      const clienteMatch = await buscarClientePorNombreCaseInsensitive(
        supabase,
        businessId,
        clienteNombre
      );
      if (clienteMatch.error) return { error: clienteMatch.error };
      if (!clienteMatch.id) {
        return {
          error: `No existe un cliente con nombre «${clienteNombre}» en este negocio.`,
        };
      }

      const { data: updated, error: updErr } = await supabase
        .from('presupuestos')
        .update({
          cliente_id: clienteMatch.id,
          cliente_nombre: clienteMatch.nombre,
        })
        .eq('id', presupuestoId)
        .eq('business_id', businessId)
        .select('id, cliente_id, cliente_nombre')
        .maybeSingle();
      if (updErr) return { error: updErr.message };
      if (!updated?.id) return { error: 'No se pudo actualizar el presupuesto.' };

      return {
        ok: true,
        presupuesto_id: String(updated.id),
        cliente_id: String(updated.cliente_id ?? ''),
        cliente_nombre: String(updated.cliente_nombre ?? ''),
      };
    }

    case 'convertir_presupuesto_a_albaran': {
      const presupuestoId = String(toolArgs.presupuesto_id ?? '').trim();
      const observaciones =
        toolArgs.observaciones != null ? String(toolArgs.observaciones).trim() : '';
      if (!presupuestoId) return { error: 'presupuesto_id es obligatorio' };

      const { data: pRow, error: pErr } = await supabase
        .from('presupuestos')
        .select('id, estado, cliente_nombre, cliente_id, presupuesto_generado, importe_total, obra_id')
        .eq('id', presupuestoId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (pErr) return { error: pErr.message };
      if (!pRow) return { error: 'Presupuesto no encontrado' };

      const clienteNombre = (pRow.cliente_nombre ?? '') as string;
      const totalNum =
        pRow.importe_total != null && Number.isFinite(Number(pRow.importe_total))
          ? Number(pRow.importe_total)
          : 0;
      const texto = (pRow.presupuesto_generado ?? '') as string;

      const { error: insertErr } = await supabase.from('albaranes').insert({
        business_id: businessId,
        cliente_nombre: clienteNombre || null,
        cliente_id: pRow.cliente_id ?? null,
        obra_id: (pRow as { obra_id?: string | null }).obra_id ?? null,
        descripcion_trabajos: texto || null,
        total: totalNum,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        observaciones: observaciones.length > 0 ? observaciones : 'Generado desde presupuesto',
      });

      if (insertErr) return { error: insertErr.message };

      if ((pRow.estado ?? '').toLowerCase() !== 'aceptado') {
        const { error: updErr } = await supabase
          .from('presupuestos')
          .update({ estado: 'aceptado' })
          .eq('id', presupuestoId)
          .eq('business_id', businessId)
          .select('id')
          .maybeSingle();
        if (updErr) return { error: updErr.message };
      }

      return {
        mensaje:
          `Albarán creado correctamente a partir del presupuesto de ${clienteNombre}.\n` +
          'El presupuesto ha sido marcado como aceptado.',
      };
    }
    case 'convertir_presupuesto_a_factura': {
      const presupuestoId = String(toolArgs.presupuesto_id ?? '').trim();
      if (!presupuestoId) return { error: 'presupuesto_id es obligatorio' };

      const { data: pRow, error: pErr } = await supabase
        .from('presupuestos')
        .select('id, estado, cliente_nombre, cliente_id, obra_id')
        .eq('id', presupuestoId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (pErr) return { error: pErr.message };
      if (!pRow) return { error: 'Presupuesto no encontrado' };

      if ((pRow.estado ?? '').toLowerCase() === 'facturado') {
        return { error: 'Este presupuesto ya tiene una factura generada.' };
      }
      if ((pRow.estado ?? '').toLowerCase() !== 'aceptado') {
        return { error: 'Solo se puede convertir a factura un presupuesto en estado aceptado.' };
      }

      const { data: borRow, error: borErr } = await supabase
        .from('presupuesto_borrador')
        .select('id, iva_porcentaje')
        .eq('presupuesto_id', presupuestoId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (borErr) return { error: borErr.message };
      if (!borRow?.id) {
        return { error: 'No se encontraron las líneas del presupuesto para generar la factura.' };
      }

      const { data: items, error: itemsErr } = await supabase
        .from('presupuesto_borrador_items')
        .select('id, orden, capitulo, descripcion, cantidad, unidad, precio_unitario, importe')
        .eq('borrador_id', borRow.id)
        .order('orden', { ascending: true });
      if (itemsErr) return { error: itemsErr.message };
      const lineItems = (items ?? []) as Array<{ importe?: number | string | null }>;
      if (lineItems.length === 0) {
        return { error: 'No se encontraron las líneas del presupuesto para generar la factura.' };
      }

      const clienteId = (pRow as { cliente_id?: string | null }).cliente_id ?? null;
      if (!clienteId) {
        return { error: 'No puedo generar la factura: el cliente no tiene NIF o dirección configurados.' };
      }
      const { data: cli, error: cliErr } = await supabase
        .from('clientes')
        .select('id, nif, direccion')
        .eq('id', clienteId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (cliErr) return { error: cliErr.message };
      const nif = String((cli as { nif?: string | null } | null)?.nif ?? '').trim();
      const direccion = String((cli as { direccion?: string | null } | null)?.direccion ?? '').trim();
      if (!nif || !direccion) {
        return { error: 'No puedo generar la factura: el cliente no tiene NIF o dirección configurados.' };
      }

      const { data: lastFactura, error: lastFacturaErr } = await supabase
        .from('facturas')
        .select('numero_factura')
        .eq('business_id', businessId)
        .order('numero_factura', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastFacturaErr) return { error: lastFacturaErr.message };
      const numeroFactura = (Number((lastFactura as { numero_factura?: number | null } | null)?.numero_factura) || 0) + 1;

      const sumaImportes = lineItems.reduce((acc, item) => acc + (Number(item.importe) || 0), 0);
      const baseImponible = Math.round(sumaImportes * 100) / 100;
      const ivaPorcentaje = Number((borRow as { iva_porcentaje?: number | null }).iva_porcentaje ?? 21);
      const ivaPct = Number.isFinite(ivaPorcentaje) ? ivaPorcentaje : 21;
      const iva = Math.round(baseImponible * (ivaPct / 100) * 100) / 100;
      const total = Math.round((baseImponible + iva) * 100) / 100;

      const { error: insFacErr } = await supabase.from('facturas').insert({
        business_id: businessId,
        numero_factura: numeroFactura,
        cliente_nombre: (pRow as { cliente_nombre?: string | null }).cliente_nombre ?? null,
        cliente_direccion: direccion,
        cliente_nif: nif,
        lineas: JSON.stringify(items ?? []),
        base_imponible: baseImponible,
        iva,
        total,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        albaran_id: null,
        obra_id: (pRow as { obra_id?: string | null }).obra_id ?? null,
        cliente_id: clienteId,
      });
      if (insFacErr) {
        if (insFacErr.code === '23505') {
          return { error: 'Colisión al generar número de factura. Inténtalo de nuevo.' };
        }
        return { error: insFacErr.message };
      }

      const { error: updPresErr } = await supabase
        .from('presupuestos')
        .update({ estado: 'facturado' })
        .eq('id', presupuestoId)
        .eq('business_id', businessId);
      if (updPresErr) return { error: updPresErr.message };

      return {
        ok: true,
        numero_factura: numeroFactura,
        total,
        cliente_nombre: (pRow as { cliente_nombre?: string | null }).cliente_nombre ?? null,
      };
    }
    case 'iniciar_borrador_presupuesto': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
      if (!clienteNombre) return { error: 'cliente_nombre es obligatorio' };
      const obraIdRaw =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;
      const cr = await resolveClienteIdOpcional(supabase, businessId, toolArgs.cliente_id);
      if (!cr.ok) return { error: cr.error };
      let obraIdFinal: string | null = null;
      if (obraIdRaw) {
        const { data: ob, error: obe } = await supabase
          .from('obras')
          .select('id')
          .eq('business_id', businessId)
          .eq('id', obraIdRaw)
          .maybeSingle();
        if (obe) return { error: obe.message };
        if (!ob?.id) return { error: 'La obra indicada no existe en este negocio.' };
        obraIdFinal = obraIdRaw;
      }
      let clienteIdFinal = cr.id;
      let clienteNombreDoc = clienteNombre;
      if (obraIdFinal && clienteIdFinal == null) {
        const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
          supabase,
          businessId,
          obraIdFinal
        );
        if (cidO) {
          clienteIdFinal = cidO;
          if (cnO) clienteNombreDoc = cnO;
        }
      }
      const ivaRaw = toolArgs.iva_porcentaje;
      const ivaPct =
        ivaRaw != null && Number.isFinite(Number(ivaRaw)) ? Number(ivaRaw) : 21;

      const { data: yaActivo, error: exErr } = await supabase
        .from('presupuesto_borrador')
        .select('id')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .eq('estado', 'en_construccion')
        .maybeSingle();
      if (exErr) return { error: exErr.message };
      if (yaActivo?.id) {
        return { ok: true, borrador_id: yaActivo.id as string, ya_existia: true };
      }

      const { data: ins, error: insErr } = await supabase
        .from('presupuesto_borrador')
        .insert({
          business_id: businessId,
          user_id: userId,
          cliente_nombre: clienteNombreDoc,
          obra_id: obraIdFinal,
          cliente_id: clienteIdFinal,
          iva_porcentaje: ivaPct,
          estado: 'en_construccion',
        })
        .select('id')
        .single();
      if (insErr) {
        if (insErr.code === '23505' || insErr.message.includes('idx_presupuesto_borrador_unico_activo')) {
          const { data: trasCarrera, error: eRace } = await supabase
            .from('presupuesto_borrador')
            .select('id')
            .eq('business_id', businessId)
            .eq('user_id', userId)
            .eq('estado', 'en_construccion')
            .maybeSingle();
          if (!eRace && trasCarrera?.id) {
            return { ok: true, borrador_id: trasCarrera.id as string, ya_existia: true };
          }
          return {
            error:
              'Ya tienes un presupuesto en construcción. Usa obtener_borrador_activo o cancelar_borrador antes de iniciar otro.',
          };
        }
        return { error: insErr.message };
      }
      return { ok: true, borrador_id: (ins as { id: string }).id, ya_existia: false };
    }
    case 'agregar_partida_borrador': {
      const args = toolArgs;
      console.log('[PRESUPUESTOS] agregar_partida_borrador llamado con:', JSON.stringify(args));
      const fin = (resultado: Record<string, unknown>) => {
        console.log('[PRESUPUESTOS] agregar_partida_borrador resultado:', JSON.stringify(resultado));
        return resultado;
      };
      if (!userId) return fin({ error: 'Usuario no autenticado.' });
      const borradorId = String(toolArgs.borrador_id ?? '').trim();
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      const rawDictado = String(toolArgs.raw_dictado ?? '').trim();
      const textoFinal = rawDictado || descripcion;
      const capitulo =
        toolArgs.capitulo != null && String(toolArgs.capitulo).trim()
          ? String(toolArgs.capitulo).trim().slice(0, 200)
          : null;
      const unidad = String(toolArgs.unidad ?? 'ud').trim().slice(0, 32) || 'ud';
      const cantidad = Number(toolArgs.cantidad);
      let precioUnitario = Number(toolArgs.precio_unitario);
      if (!borradorId) return fin({ error: 'borrador_id es obligatorio' });
      if (!descripcion) return fin({ error: 'descripcion es obligatoria' });
      if (!Number.isFinite(cantidad) || cantidad < 0) return fin({ error: 'cantidad inválida' });
      if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
        return fin({ error: 'precio_unitario inválido' });
      }

      let borradorEfectivoId = borradorId;
      let br = await assertBorrador(supabase, businessId, userId, borradorEfectivoId);
      if (!br.ok && br.error === 'Borrador no encontrado o sin acceso.') {
        const rowActivo = await obtenerBorradorActivoRow(supabase, businessId, userId);
        if (rowActivo) {
          borradorEfectivoId = String(rowActivo.id ?? '').trim();
          br = { ok: true, row: rowActivo };
        }
      }
      if (!br.ok) {
        if (br.error === 'Borrador no encontrado o sin acceso.') {
          return fin({ error: 'Borrador no encontrado. Inicia un nuevo presupuesto.' });
        }
        return fin({ error: br.error });
      }
      if (String(br.row.estado) !== 'en_construccion') {
        return fin({ error: 'El borrador no está en construcción.' });
      }

      let mensajeTarifa: string | null = null;
      if (precioUnitario === 0) {
        const candidatas = await buscarTarifasCandidatas(supabase, businessId, descripcion);
        if (candidatas.length === 0) {
          return fin({
            mensaje: `No hay tarifas candidatas para «${descripcion}». Indica el precio unitario antes de insertar la partida.`,
            pendiente_precio: true,
          });
        }
        const idx = await elegirTarifaConGpt(openai, descripcion, textoFinal, candidatas);
        if (idx == null) {
          return fin({
            mensaje:
              'No encontré una tarifa clara para esta partida. ¿A qué precio unitario va «' +
              descripcion +
              '»?',
            pendiente_precio: true,
          });
        }
        const elegida = candidatas[idx]!;
        precioUnitario = Number(elegida.precio);
        mensajeTarifa = `Coincidencia con tarifa «${elegida.nombre}» (${fmtImporteLinea(precioUnitario)} €/u).`;
      }

      const importe = r2(cantidad * precioUnitario);
      const { count } = await supabase
        .from('presupuesto_borrador_items')
        .select('id', { count: 'exact', head: true })
        .eq('borrador_id', borradorEfectivoId);
      const orden = (count ?? 0) + 1;

      const insertPayload = {
        borrador_id: borradorEfectivoId,
        business_id: businessId,
        orden,
        capitulo,
        descripcion,
        cantidad,
        unidad,
        precio_unitario: precioUnitario,
        raw_dictado: textoFinal,
      };
      console.log('ID BORRADOR USADO:', borradorEfectivoId);
      console.log('DATOS A INSERTAR:', { descripcion, cantidad, importe });
      const { error: insErr } = await supabase.from('presupuesto_borrador_items').insert(insertPayload);
      if (insErr) {
        console.error('ERROR CRÍTICO SUPABASE:', insErr);
        throw new Error(`ERROR CRÍTICO SUPABASE: ${insErr.message}`);
      }

      await supabase
        .from('presupuesto_borrador')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', borradorEfectivoId);

      return fin({
        ok: true,
        borrador_id: borradorEfectivoId,
        orden,
        importe,
        mensaje: mensajeTarifa,
      });
    }
    case 'modificar_partida_borrador': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const borradorId = String(toolArgs.borrador_id ?? '').trim();
      const itemIdIn = String(toolArgs.item_id ?? '').trim();
      const busquedaRaw =
        toolArgs.descripcion_busqueda != null ? String(toolArgs.descripcion_busqueda).trim() : '';
      if (!borradorId) return { error: 'borrador_id es obligatorio' };
      const br = await assertBorrador(supabase, businessId, userId, borradorId);
      if (!br.ok) return { error: br.error };
      if (String(br.row.estado) !== 'en_construccion') {
        return { error: 'El borrador no está en construcción.' };
      }

      const tienePatch =
        toolArgs.descripcion !== undefined ||
        toolArgs.cantidad !== undefined ||
        toolArgs.unidad !== undefined ||
        toolArgs.precio_unitario !== undefined;
      if (!tienePatch) {
        return { error: 'Indica al menos un campo a modificar: descripcion, cantidad, unidad o precio_unitario.' };
      }

      type ItemRow = {
        id: string;
        descripcion: string;
        cantidad: number;
        unidad: string;
        precio_unitario: number;
        importe: number;
        orden: number;
      };

      let itemRow: ItemRow | null = null;

      if (itemIdIn) {
        const { data: row, error: fe } = await supabase
          .from('presupuesto_borrador_items')
          .select('id, borrador_id, descripcion, cantidad, unidad, precio_unitario, importe, orden')
          .eq('id', itemIdIn)
          .eq('business_id', businessId)
          .maybeSingle();
        if (fe) return { error: fe.message };
        if (!row) return { error: 'Partida no encontrada.' };
        if (String((row as { borrador_id: string }).borrador_id) !== borradorId) {
          return { error: 'La partida no pertenece a este borrador.' };
        }
        itemRow = row as ItemRow;
      } else if (busquedaRaw) {
        const safe = escapeIlike(busquedaRaw);
        if (!safe) return { error: 'descripcion_busqueda no válida.' };
        const { data: candidatas, error: ce } = await supabase
          .from('presupuesto_borrador_items')
          .select('id, descripcion, cantidad, unidad, precio_unitario, importe, orden')
          .eq('borrador_id', borradorId)
          .eq('business_id', businessId)
          .ilike('descripcion', `%${safe}%`)
          .order('orden', { ascending: true });
        if (ce) return { error: ce.message };
        const list = (candidatas ?? []) as ItemRow[];
        if (list.length === 0) {
          return { error: 'No encontré ninguna partida que coincida con la descripción indicada.' };
        }
        let best = list[0]!;
        let bestScore = scoreDescripcionMatch(best.descripcion, busquedaRaw);
        for (let i = 1; i < list.length; i++) {
          const it = list[i]!;
          const sc = scoreDescripcionMatch(it.descripcion, busquedaRaw);
          if (sc > bestScore || (sc === bestScore && it.orden < best.orden)) {
            best = it;
            bestScore = sc;
          }
        }
        itemRow = best;
      } else {
        return { error: 'Indica item_id o descripcion_busqueda para localizar la partida.' };
      }

      let nuevaDesc = String(itemRow.descripcion ?? '').trim();
      if (toolArgs.descripcion !== undefined) {
        const nd = String(toolArgs.descripcion ?? '').trim();
        if (!nd) return { error: 'descripcion no puede quedar vacía.' };
        nuevaDesc = nd.slice(0, 2000);
      }

      let nuevaCant = Number(itemRow.cantidad);
      if (toolArgs.cantidad !== undefined) {
        nuevaCant = Number(toolArgs.cantidad);
        if (!Number.isFinite(nuevaCant) || nuevaCant < 0) return { error: 'cantidad inválida' };
      }

      let nuevaUnidad = String(itemRow.unidad ?? 'ud').trim().slice(0, 32) || 'ud';
      if (toolArgs.unidad !== undefined) {
        const u = String(toolArgs.unidad ?? '').trim().slice(0, 32);
        if (!u) return { error: 'unidad no puede quedar vacía.' };
        nuevaUnidad = u;
      }

      let nuevoPu = Number(itemRow.precio_unitario);
      if (toolArgs.precio_unitario !== undefined) {
        nuevoPu = Number(toolArgs.precio_unitario);
        if (!Number.isFinite(nuevoPu) || nuevoPu < 0) return { error: 'precio_unitario inválido' };
      }

      const nuevoImporte = r2(nuevaCant * nuevoPu);

      const patch: Record<string, unknown> = {};
      if (toolArgs.descripcion !== undefined) patch.descripcion = nuevaDesc;
      if (toolArgs.cantidad !== undefined) patch.cantidad = nuevaCant;
      if (toolArgs.unidad !== undefined) patch.unidad = nuevaUnidad;
      if (toolArgs.precio_unitario !== undefined) patch.precio_unitario = nuevoPu;
      if (toolArgs.cantidad !== undefined || toolArgs.precio_unitario !== undefined) {
        patch.importe = nuevoImporte;
      }

      const { error: upErr } = await supabase
        .from('presupuesto_borrador_items')
        .update(patch)
        .eq('id', itemRow.id)
        .eq('business_id', businessId);

      if (upErr) return { error: upErr.message };

      await supabase
        .from('presupuesto_borrador')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', borradorId);

      return {
        ok: true,
        descripcion: nuevaDesc,
        cantidad: nuevaCant,
        unidad: nuevaUnidad,
        precio_unitario: nuevoPu,
        importe: nuevoImporte,
      };
    }
    case 'listar_partidas_borrador': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const borradorId = String(toolArgs.borrador_id ?? '').trim();
      if (!borradorId) return { error: 'borrador_id es obligatorio' };
      const br = await assertBorrador(supabase, businessId, userId, borradorId);
      if (!br.ok) return { error: br.error };
      const { data, error } = await supabase
        .from('presupuesto_borrador_items')
        .select('id, orden, capitulo, descripcion, cantidad, unidad, precio_unitario, importe, raw_dictado')
        .eq('borrador_id', borradorId)
        .order('orden', { ascending: true });
      if (error) return { error: error.message };
      return { items: data ?? [] };
    }
    case 'eliminar_partida_borrador': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const itemId = String(toolArgs.item_id ?? '').trim();
      if (!itemId) return { error: 'item_id es obligatorio' };
      const { data: row, error: fe } = await supabase
        .from('presupuesto_borrador_items')
        .select('borrador_id')
        .eq('id', itemId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (fe) return { error: fe.message };
      if (!row) return { error: 'Partida no encontrada.' };
      const br = await assertBorrador(supabase, businessId, userId, String((row as { borrador_id: string }).borrador_id));
      if (!br.ok) return { error: br.error };
      const { error: delErr } = await supabase.from('presupuesto_borrador_items').delete().eq('id', itemId);
      if (delErr) return { error: delErr.message };
      return { ok: true };
    }
    case 'confirmar_borrador': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const borradorId = String(toolArgs.borrador_id ?? '').trim();
      const observaciones =
        toolArgs.observaciones != null ? String(toolArgs.observaciones).trim() : '';
      if (!borradorId) return { error: 'borrador_id es obligatorio' };
      const br = await assertBorrador(supabase, businessId, userId, borradorId);
      if (!br.ok) return { error: br.error };
      if (String(br.row.estado) !== 'en_construccion') {
        return { error: 'El borrador no está en construcción.' };
      }
      const { data: items, error: ie } = await supabase
        .from('presupuesto_borrador_items')
        .select('descripcion, cantidad, unidad, precio_unitario, importe, capitulo')
        .eq('borrador_id', borradorId)
        .order('orden', { ascending: true });
      if (ie) return { error: ie.message };
      const list = (items ?? []) as Array<{
        descripcion: string;
        cantidad: number;
        unidad: string;
        precio_unitario: number;
        importe: number;
        capitulo: string | null;
      }>;
      if (list.length === 0) return { error: 'No hay partidas en el borrador.' };
      const ivaPct = Number(br.row.iva_porcentaje ?? 21);
      const ivaNum = Number.isFinite(ivaPct) ? ivaPct : 21;
      const { texto, base, ivaImporte, total } = generarTextoPresupuestoDesdeItems(
        list.map((r) => ({
          ...r,
          cantidad: Number(r.cantidad),
          precio_unitario: Number(r.precio_unitario),
          importe: Number(r.importe),
        })),
        ivaNum
      );
      let textoFinal = texto;
      if (observaciones) {
        textoFinal += `\n\nObservaciones: ${observaciones}`;
      }
      const textoGenerado = textoFinal;
      const baseImponible = total;
      const presupuestoIdExistente = br.row.presupuesto_id ?? null;
      let presId = '';

      let clienteNombreFinal = String(br.row.cliente_nombre ?? '').trim() || null;
      let clienteIdFinal = String(br.row.cliente_id ?? '').trim() || null;
      if (clienteNombreFinal) {
        const clienteMatch = await buscarClientePorNombreCaseInsensitive(
          supabase,
          businessId,
          clienteNombreFinal
        );
        if (clienteMatch.error) return { error: clienteMatch.error };
        if (clienteMatch.id) {
          clienteIdFinal = clienteMatch.id;
          clienteNombreFinal = clienteMatch.nombre;
        }
      }

      if (presupuestoIdExistente) {
        const { data: presUpd, error: pUpdErr } = await supabase
          .from('presupuestos')
          .update({
            presupuesto_generado: textoGenerado,
            importe_total: baseImponible,
            estado: 'borrador',
            cliente_nombre: clienteNombreFinal,
            cliente_id: clienteIdFinal,
            obra_id: br.row.obra_id ?? null,
          })
          .eq('id', String(presupuestoIdExistente))
          .eq('business_id', businessId)
          .select('id')
          .maybeSingle();
        if (pUpdErr) return { error: pUpdErr.message };
        if (!presUpd?.id) return { error: 'No se encontró el presupuesto vinculado para actualizar.' };
        presId = String(presupuestoIdExistente);
      } else {
        const { data: lastPres, error: lastPresErr } = await supabase
          .from('presupuestos')
          .select('numero_presupuesto')
          .eq('business_id', businessId)
          .order('numero_presupuesto', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastPresErr) return { error: lastPresErr.message };
        const numeroPresupuesto =
          (Number((lastPres as { numero_presupuesto?: number | null } | null)?.numero_presupuesto) || 0) + 1;

        const { data: pres, error: pInsErr } = await supabase
          .from('presupuestos')
          .insert({
            business_id: businessId,
            numero_presupuesto: numeroPresupuesto,
            presupuesto_generado: textoGenerado,
            importe_total: baseImponible,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'borrador',
            mensaje_cliente: 'Presupuesto generado desde borrador conversacional',
            ...(clienteNombreFinal ? { cliente_nombre: clienteNombreFinal } : {}),
            ...(clienteIdFinal ? { cliente_id: clienteIdFinal } : {}),
            ...(br.row.obra_id ? { obra_id: br.row.obra_id as string } : {}),
          })
          .select('id')
          .single();
        if (pInsErr) {
          if (pInsErr.code === '23505') {
            return { error: 'Colisión al generar número de presupuesto. Inténtalo de nuevo.' };
          }
          return { error: pInsErr.message };
        }
        presId = (pres as { id: string }).id;
      }
      const { error: upB } = await supabase
        .from('presupuesto_borrador')
        .update({ estado: 'confirmado', presupuesto_id: presId, updated_at: new Date().toISOString() })
        .eq('id', borradorId);
      if (upB) return { error: upB.message };
      return {
        mensaje: `Presupuesto guardado. Base: ${fmtImporteLinea(base)}€, IVA ${ivaNum}%: ${fmtImporteLinea(ivaImporte)}€, Total: ${fmtImporteLinea(total)}€.`,
        presupuesto_id: presId,
        importe_total: total,
        agente_accion_finalizada: true,
        borrador_finalizado: true,
      };
    }
    case 'cancelar_borrador': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const borradorId = String(toolArgs.borrador_id ?? '').trim();
      if (!borradorId) return { error: 'borrador_id es obligatorio' };
      const br = await assertBorrador(supabase, businessId, userId, borradorId);
      if (!br.ok) return { error: br.error };
      const { error } = await supabase
        .from('presupuesto_borrador')
        .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
        .eq('id', borradorId);
      if (error) return { error: error.message };
      return { ok: true, agente_accion_finalizada: true, borrador_finalizado: true };
    }
    case 'obtener_borrador_activo': {
      if (!userId) return { error: 'Usuario no autenticado.' };
      const { data: bor, error: be } = await supabase
        .from('presupuesto_borrador')
        .select('*')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .eq('estado', 'en_construccion')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (be) return { error: be.message };
      if (!bor) return { borrador: null, items: [] };
      const bid = (bor as { id: string }).id;
      const { data: its, error: ie } = await supabase
        .from('presupuesto_borrador_items')
        .select('id, orden, capitulo, descripcion, cantidad, unidad, precio_unitario, importe, raw_dictado')
        .eq('borrador_id', bid)
        .order('orden', { ascending: true });
      if (ie) return { error: ie.message };
      return { borrador: bor, items: its ?? [] };
    }
    default:
      return { error: `Tool de presupuestos no soportada: ${toolName}` };
  }
}
