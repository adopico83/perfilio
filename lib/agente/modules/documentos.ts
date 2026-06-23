import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  diasDesdeFechaHasta,
  hoyYmdEnZona,
  listarAlbaranesSinFacturar,
} from '@/lib/albaranes-sin-facturar';
import {
  estructurarDictadoEnPartidas,
  formatearBorradorPresupuestoDictado,
  type TarifaReferencia,
} from '@/lib/dictado-presupuesto';
import { TARIFAS_BASE_ALBANILERIA } from '@/lib/tarifas-base';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';
import {
  clienteDesdeObraSiAplica,
  resolveClienteIdOpcional,
} from '@/lib/agente/modules/obras-clientes';

export const ESTADOS_DOC = ['pendiente', 'aceptado', 'rechazado', 'facturado', 'pagado'] as const;
export type EstadoDoc = (typeof ESTADOS_DOC)[number];

export function parseEstadoDoc(raw: unknown): EstadoDoc | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (ESTADOS_DOC as readonly string[]).includes(s) ? (s as EstadoDoc) : null;
}

export async function editar_factura(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>
): Promise<{ ok: true; id: string } | { error: string }> {
  const id = String(toolArgs.id ?? '').trim();
  if (!id) return { error: 'id es obligatorio' };
  const updates: {
    cliente_nombre?: string;
    total?: number;
    base_imponible?: number;
    iva?: number;
    descripcion_trabajos?: string;
  } = {};
  if (toolArgs.cliente_nombre !== undefined) {
    const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
    if (!c) return { error: 'cliente_nombre no puede estar vacío' };
    updates.cliente_nombre = c;
  }
  if (toolArgs.importe_total !== undefined) {
    const totalNum = Number(toolArgs.importe_total);
    if (!Number.isFinite(totalNum)) {
      return { error: 'importe_total debe ser un número válido' };
    }
    const baseImponible = totalNum ? totalNum / 1.21 : 0;
    const iva = totalNum ? totalNum - baseImponible : 0;
    updates.total = totalNum;
    updates.base_imponible = Number.isFinite(baseImponible) ? baseImponible : 0;
    updates.iva = Number.isFinite(iva) ? iva : 0;
  }

  const descripcionRaw =
    toolArgs.descripcion !== undefined ? toolArgs.descripcion : toolArgs.descripcion_trabajos;
  if (descripcionRaw !== undefined) {
    const d = String(descripcionRaw ?? '').trim();
    if (!d) return { error: 'descripcion_trabajos no puede estar vacía' };
    updates.descripcion_trabajos = d;
  }
  if (Object.keys(updates).length === 0) {
    return {
      error:
        'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion_trabajos)',
    };
  }
  const { data: row, error } = await supabase
    .from('facturas')
    .update(updates)
    .eq('id', id)
    .eq('business_id', businessId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row?.id) {
    return { error: 'No se encontró la factura o no pertenece a este negocio' };
  }
  return { ok: true, id: row.id as string };
}

export const DOCUMENTOS_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'obtener_facturas_pendientes',
      description: 'Facturas en estado pendiente: cliente, importe, fecha.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
        type: 'function',
        function: {
          name: 'obtener_albaranes_pendientes',
          description: 'Albaranes pendientes: cliente y fecha.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_facturas',
          description: 'Últimas 10 facturas. Consultar o listar sin crear.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_albaranes',
          description: 'Últimos 10 albaranes. Consultar o listar sin crear.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'albaranes_sin_facturar',
          description:
            'Albaranes sin factura vinculada (facturas.albaran_id) con más de 7 días desde la fecha del albarán. Saludo matinal o facturación pendiente.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_factura',
          description:
            'Cambia estado de la factura por UUID. Mismos estados que presupuestos. Si no tienes el UUID, primero listar_facturas y usa el id correcto.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_albaran',
          description:
            'Cambia estado del albarán por UUID. Mismos estados. Si no tienes el UUID, primero listar_albaranes y usa el id correcto.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_factura',
          description:
            'Actualiza factura por id: cliente_nombre, total con IVA, descripcion_trabajos. Solo campos que cambien. Si no tienes UUID, listar_facturas antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total con IVA (actualiza base e IVA al 21%)' },
              descripcion: { type: 'string', description: 'Descripción / conceptos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_albaran',
          description:
            'Actualiza albarán por id: cliente_nombre, importe_total, descripcion_trabajos. Solo campos que cambien. Si no tienes UUID, listar_albaranes antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total' },
              descripcion: { type: 'string', description: 'Descripción de trabajos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generar_presupuesto_por_dictado',
          description:
            "Usar SIEMPRE que el usuario pida crear un presupuesto describiendo trabajos, aunque la descripción sea breve. Ejemplos: 'presupuesto para enfoscado exterior 2500€', 'presupuesto para reforma de baño', 'presupuesto para pintar el salón de García'. También para dictado de visita: 'genera un presupuesto', 'haz un presupuesto de lo que he visto', 'acabo de visitar una obra'. Estructura el presupuesto en partidas automáticamente. SDD obligatorio: no ejecutar sin datos críticos completos; muestra resumen en lenguaje natural y espera confirmación explícita del usuario ('sí', 'adelante', 'genéralo'). Cliente identificado; al menos una partida con descripción y precio; nunca partidas a 0€; si dice 'precios estándar' usa tarifas del perfil o memoria del negocio; si falta precio, pregunta antes. Si faltan datos, no ejecutes ni crees borradores vacíos. Incluye SIEMPRE obra_nombre si la obra es conocida en la conversación (no infieras la obra solo del texto del dictado).",
          parameters: {
            type: 'object',
            properties: {
              dictado: {
                type: 'string',
                description: 'Descripción libre de los trabajos a realizar (dictado)',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              cliente_id: { type: 'string', description: 'UUID del cliente si se conoce' },
              direccion_obra: { type: 'string', description: 'Dirección de la obra' },
              obra_nombre: {
                type: 'string',
                description:
                  'Nombre exacto de la obra a la que se asocia el presupuesto. Usar siempre que la obra sea conocida.',
              },
              obra_id: {
                type: 'string',
                description:
                  'UUID de la obra (opcional). Si no se envía, usa obra_nombre y contexto del cliente; no uses el dictado de partidas para resolver obra.',
              },
              solo_vista_previa: {
                type: 'boolean',
                description:
                  'Si true, solo muestra el borrador sin guardarlo en BD. Usar true en la primera llamada para mostrar al usuario. Usar false (o omitir) solo cuando el usuario haya confirmado explícitamente.',
              },
            },
            required: ['dictado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gestionar_tarifas',
          description:
            'Añade, edita, elimina o lista las tarifas del negocio para generar presupuestos automáticos.',
          parameters: {
            type: 'object',
            properties: {
              accion: {
                type: 'string',
                enum: ['listar', 'añadir', 'editar', 'eliminar'],
                description: 'Operación a realizar',
              },
              nombre: { type: 'string' },
              unidad: { type: 'string' },
              precio: { type: 'number' },
              categoria: { type: 'string' },
              tarifa_id: { type: 'string', description: 'UUID de la tarifa (editar/eliminar)' },
              nombre_tarifa: {
                type: 'string',
                description: 'Nombre o fragmento para buscar la tarifa a eliminar si no se tiene tarifa_id',
              },
              confirmar_eliminacion: {
                type: 'boolean',
                description:
                  'Confirmación explícita para ejecutar el borrado. Si no es true, solo devuelve vista previa.',
              },
            },
            required: ['accion'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_presupuesto',
          description:
            'Solo cuando el presupuesto ya viene estructurado con partidas y totales definidos; si describe trabajos en natural, usar generar_presupuesto_por_dictado. Guarda presupuesto nuevo (texto completo). SDD obligatorio: datos críticos completos; resumen al usuario + confirmación explícita antes de llamar; cliente identificado; partidas con precio; nunca 0€; sin borradores vacíos.',
          parameters: {
            type: 'object',
            properties: {
              texto_presupuesto: {
                type: 'string',
                description: 'Texto completo del presupuesto a guardar',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente si se conoce' },
              importe_total: { type: 'number', description: 'Importe total si se conoce' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['texto_presupuesto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_factura',
          description:
            'Registra factura nueva. Solo si pidió crear/generar factura. SDD obligatorio: cliente, importe/concepto completos; resumen + confirmación explícita del usuario antes de ejecutar; sin borradores vacíos.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción o conceptos de la factura',
              },
              total: { type: 'number', description: 'Total con IVA si aplica' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_albaran',
          description:
            'Registra albarán nuevo. Solo si pidió crear/generar albarán. SDD obligatorio: cliente y descripción del trabajo; resumen + confirmación explícita antes de ejecutar; sin borradores vacíos.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción de trabajos o entrega',
              },
              total: { type: 'number', description: 'Total opcional' },
              cliente_nombre: { type: 'string', description: 'Cliente si se conoce' },
              cliente_id: {
                type: 'string',
                description: 'UUID de ficha de cliente si existe en el sistema',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
              },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
  {
    type: 'function',
    function: {
      name: 'registrar_extra',
          description:
            "Registra un trabajo extra o modificado sobre un presupuesto existente. Usar cuando el usuario diga 'registra un extra', 'ha surgido un imprevisto', 'añade un modificado' o similar. Crea un presupuesto hijo vinculado al presupuesto original.",
          parameters: {
            type: 'object',
            properties: {
              descripcion: {
                type: 'string',
                description: 'Descripción del trabajo extra o imprevisto',
              },
              importe: {
                type: 'number',
                description: 'Coste adicional (IVA no incluido)',
              },
              presupuesto_parent_id: {
                type: 'string',
                description: 'UUID del presupuesto original, si se conoce',
              },
              cliente_nombre: {
                type: 'string',
                description: 'Nombre del cliente para localizar el presupuesto si no hay id',
              },
              notificar_cliente: {
                type: 'boolean',
                description: 'Si preparar borrador de email al cliente (por defecto true)',
              },
              obra_id: {
                type: 'string',
                description: 'UUID de la obra (opcional; si no, se detecta por contexto o mensaje)',
              },
            },
            required: ['descripcion', 'importe'],
            additionalProperties: false,
          },
        },
      },
  {
    type: 'function',
    function: {
      name: 'listar_extras',
          description:
            'Lista extras y modificados registrados, opcionalmente por cliente o presupuesto padre.',
          parameters: {
            type: 'object',
            properties: {
              cliente_nombre: { type: 'string', description: 'Filtrar por nombre de cliente' },
              presupuesto_parent_id: {
                type: 'string',
                description: 'Filtrar por UUID del presupuesto original',
              },
            },
            additionalProperties: false,
          },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertir_albaran_a_factura',
          description:
            'Albarán → factura (copia datos; IVA opcional; marca albarán facturado).',
          parameters: {
            type: 'object',
            properties: {
              albaran_id: {
                type: 'string',
                description: 'UUID del albarán a convertir',
              },
              iva: {
                type: 'number',
                description: 'Porcentaje de IVA (por defecto 21)',
              },
              observaciones: {
                type: 'string',
                description: 'Observaciones para la factura',
              },
            },
            required: ['albaran_id'],
            additionalProperties: false,
          },
        },
      },
];

export const DOCUMENTOS_HANDLED_TOOLS = new Set([
  'obtener_facturas_pendientes',
  'obtener_albaranes_pendientes',
  'listar_facturas',
  'listar_albaranes',
  'albaranes_sin_facturar',
  'cambiar_estado_factura',
  'cambiar_estado_albaran',
  'editar_factura',
  'editar_albaran',
  'generar_presupuesto_por_dictado',
  'gestionar_tarifas',
  'crear_presupuesto',
  'crear_factura',
  'crear_albaran',
  'registrar_extra',
  'listar_extras',
  'convertir_albaran_a_factura',
]);

export type HandleDocumentosCtx = {
  mensajeTrim?: string;
  mensaje?: string;
};


export async function handleDocumentosAgent(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  authUserId: string | null,
  supabase: SupabaseClient,
  _openai: OpenAI,
  ctx: HandleDocumentosCtx = {}
): Promise<Record<string, unknown>> {
  void authUserId;
  void _openai;
  const mensajeTrim = ctx.mensajeTrim ?? '';
  const mensajeOriginal = ctx.mensaje ?? mensajeTrim;

  switch (toolName) {
    case 'obtener_facturas_pendientes': {
      const { data, error } = await supabase
        .from('facturas')
        .select('cliente_nombre, total, fecha')
        .eq('business_id', businessId)
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: false })
        .limit(50);
      if (error) return { error: error.message };
      return {
        items: ((data ?? []) as Array<{ cliente_nombre: string | null; total: number | null; fecha: string | null }>).map((r) => ({
          cliente: r.cliente_nombre ?? null,
          importe: r.total ?? null,
          fecha: r.fecha ?? null,
        })),
      };
    }
    case 'obtener_albaranes_pendientes': {
      const { data, error } = await supabase
        .from('albaranes')
        .select('cliente_nombre, fecha')
        .eq('business_id', businessId)
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: false })
        .limit(50);
      if (error) return { error: error.message };
      return {
        items: ((data ?? []) as Array<{ cliente_nombre: string | null; fecha: string | null }>).map((r) => ({
          cliente: r.cliente_nombre ?? null,
          fecha: r.fecha ?? null,
        })),
      };
    }
    case 'listar_facturas': {
      const { data, error } = await supabase
        .from('facturas')
        .select('id, numero_factura, cliente_nombre, cliente_id, total, fecha, estado')
        .eq('business_id', businessId)
        .order('fecha', { ascending: false })
        .limit(10);
      if (error) {
        console.error('[agente] listar_facturas Supabase:', error);
        return { error: error.message };
      }
      return {
        items: (data ?? []).map((r: {
          id?: string;
          numero_factura?: string | null;
          cliente_nombre?: string | null;
          cliente_id?: string | null;
          total?: number | null;
          fecha?: string | null;
          estado?: string | null;
        }) => ({
          id: r.id ?? null,
          numero_factura: r.numero_factura ?? null,
          cliente: r.cliente_nombre ?? null,
          cliente_id: r.cliente_id ?? null,
          importe_total: r.total ?? null,
          fecha: r.fecha ?? null,
          estado: r.estado ?? null,
        })),
      };
    }
    case 'listar_albaranes': {
      const { data, error } = await supabase
        .from('albaranes')
        .select('id, numero_albaran, cliente_nombre, cliente_id, total, fecha, estado')
        .eq('business_id', businessId)
        .order('fecha', { ascending: false })
        .limit(10);
      if (error) {
        console.error('[agente] listar_albaranes Supabase:', error);
        return { error: error.message };
      }
      return {
        items: (data ?? []).map((r: {
          id?: string;
          numero_albaran?: string | null;
          cliente_nombre?: string | null;
          cliente_id?: string | null;
          total?: number | null;
          fecha?: string | null;
          estado?: string | null;
        }) => ({
          id: r.id ?? null,
          numero_albaran: r.numero_albaran ?? null,
          cliente: r.cliente_nombre ?? null,
          cliente_id: r.cliente_id ?? null,
          importe_total: r.total ?? null,
          fecha: r.fecha ?? null,
          estado: r.estado ?? null,
        })),
      };
    }
    case 'albaranes_sin_facturar': {
      try {
        const { albaranes, total } = await listarAlbaranesSinFacturar(
          supabase,
          businessId
        );
        if (total === 0) {
          return { mensaje: 'No hay albaranes pendientes de facturar.' };
        }
        const hoyYmd = hoyYmdEnZona();
        const items = albaranes.map((a) => {
          const dias = diasDesdeFechaHasta(a.fecha, hoyYmd);
          return {
            id: a.id,
            numero_albaran: a.numero_albaran,
            cliente: a.cliente_nombre,
            importe: a.total,
            fecha: a.fecha,
            estado: a.estado,
            dias_transcurridos: dias,
          };
        });
        const lineas = items.map((i) => {
          const imp =
            i.importe != null && Number.isFinite(Number(i.importe))
              ? `${Number(i.importe).toFixed(2)}€`
              : '—';
          const ref = i.numero_albaran ?? String(i.id).slice(0, 8);
          return `- ${i.cliente ?? 'Cliente'} (albarán ${ref}): ${imp} (hace ${i.dias_transcurridos} días)`;
        });
        return {
          total,
          items,
          mensaje: `${total} albarán(es) sin factura vinculada (más de 7 días):\n${lineas.join('\n')}`,
        };
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : 'Error al listar albaranes sin facturar',
        };
      }
    }
    case 'cambiar_estado_factura': {
      const id = String(toolArgs.id ?? '').trim();
      const estado = parseEstadoDoc(toolArgs.estado);
      if (!id) return { error: 'id es obligatorio' };
      if (!estado) {
        return {
          error:
            'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
        };
      }
      const { data: row, error } = await supabase
        .from('facturas')
        .update({ estado })
        .eq('id', id)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!row?.id) {
        return { error: 'No se encontró la factura o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'cambiar_estado_albaran': {
      const id = String(toolArgs.id ?? '').trim();
      const estado = parseEstadoDoc(toolArgs.estado);
      if (!id) return { error: 'id es obligatorio' };
      if (!estado) {
        return {
          error:
            'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
        };
      }
      const { data: row, error } = await supabase
        .from('albaranes')
        .update({ estado })
        .eq('id', id)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!row?.id) {
        return { error: 'No se encontró el albarán o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'editar_factura': {
      return editar_factura(supabase, String(businessId ?? ''), toolArgs);
    }
    case 'editar_albaran': {
      const id = String(toolArgs.id ?? '').trim();
      if (!id) return { error: 'id es obligatorio' };
      const updates: { cliente_nombre?: string; total?: number; descripcion_trabajos?: string } =
        {};
      if (toolArgs.cliente_nombre !== undefined) {
        const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
        if (!c) return { error: 'cliente_nombre no puede estar vacío' };
        updates.cliente_nombre = c;
      }
      if (toolArgs.importe_total !== undefined) {
        const n = Number(toolArgs.importe_total);
        if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
        updates.total = n;
      }
      if (toolArgs.descripcion !== undefined) {
        const d = String(toolArgs.descripcion ?? '').trim();
        if (!d) return { error: 'descripcion no puede estar vacía' };
        updates.descripcion_trabajos = d;
      }
      if (Object.keys(updates).length === 0) {
        return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
      }
      const { data: row, error } = await supabase
        .from('albaranes')
        .update(updates)
        .eq('id', id)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!row?.id) {
        return { error: 'No se encontró el albarán o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'crear_presupuesto': {
      const texto = String(toolArgs.texto_presupuesto ?? '').trim();
      if (!texto) {
        return { error: 'texto_presupuesto es obligatorio' };
      }
      const clienteNombre =
        toolArgs.cliente_nombre != null
          ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
          : '';
      const importeRaw = toolArgs.importe_total;
      const importe_total =
        importeRaw != null && Number.isFinite(Number(importeRaw))
          ? Number(importeRaw)
          : null;

      const cr = await resolveClienteIdOpcional(supabase, businessId, toolArgs.cliente_id);
      if (!cr.ok) return { error: cr.error };

      const explicitObra =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;

      type ObraClienteSelect = {
        id: string;
        cliente_id?: string | null;
        clientes?: { nombre?: string | null } | null;
      };
      let obraIdFinal = '';
      let obraClienteDesdeExplicita: ObraClienteSelect | null = null;

      if (explicitObra) {
        const { data: obraRow, error: obraErr } = await supabase
          .from('obras')
          .select('id, cliente_id, clientes ( nombre )')
          .eq('business_id', businessId)
          .eq('id', explicitObra)
          .in('estado', ['abierta', 'en_curso'])
          .maybeSingle();
        if (obraErr || !obraRow?.id) {
          return { error: 'La obra indicada no existe o no está abierta.' };
        }
        obraIdFinal = (obraRow as ObraClienteSelect).id;
        obraClienteDesdeExplicita = obraRow as ObraClienteSelect;
      } else {
        const textoObra = [texto, clienteNombre, mensajeTrim].filter(Boolean).join(' ').trim();
        const obraRes = await resolverObraDocumentoAgente(
          supabase,
          businessId,
          undefined,
          textoObra,
          'documento'
        );
        if (!obraRes.ok) return { mensaje: obraRes.mensaje };
        obraIdFinal = obraRes.obra_id ?? '';
      }

      let clienteIdFinal = cr.id;
      let clienteNombreFinal = clienteNombre;

      if (
        obraClienteDesdeExplicita &&
        clienteIdFinal == null &&
        obraClienteDesdeExplicita.cliente_id
      ) {
        const cidHint = String(obraClienteDesdeExplicita.cliente_id).trim();
        if (cidHint) {
          clienteIdFinal = cidHint;
          const cliJoin = obraClienteDesdeExplicita.clientes;
          const cnHint =
            cliJoin && typeof cliJoin === 'object'
              ? String((cliJoin as { nombre?: string | null }).nombre ?? '').trim()
              : '';
          if (cnHint) clienteNombreFinal = cnHint;
        }
      }

      if (obraIdFinal && clienteIdFinal == null) {
        const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
          supabase,
          businessId,
          obraIdFinal
        );
        if (cidO) {
          clienteIdFinal = cidO;
          if (cnO) clienteNombreFinal = cnO;
        }
      }

      const tieneClientePresupuesto =
        clienteIdFinal != null ||
        (typeof clienteNombreFinal === 'string' && clienteNombreFinal.trim().length > 0);
      if (!tieneClientePresupuesto) {
        return {
          error:
            'Falta el cliente. Créalo primero antes de generar el presupuesto.',
        };
      }

      const { error } = await supabase.from('presupuestos').insert({
        business_id: businessId,
        mensaje_cliente: mensajeOriginal,
        presupuesto_generado: texto,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'borrador',
        ...(importe_total != null && { importe_total }),
        ...(clienteNombreFinal.length > 0 && { cliente_nombre: clienteNombreFinal }),
        ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
        ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
      });

      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'crear_factura': {
      const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
      if (!desc) {
        return { error: 'descripcion_trabajos es obligatorio' };
      }
      const totalRaw = toolArgs.total;
      const totalNum =
        totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : 0;
      const baseImponible = totalNum ? totalNum / 1.21 : 0;
      const iva = totalNum ? totalNum - baseImponible : 0;

      const cr = await resolveClienteIdOpcional(supabase, businessId, toolArgs.cliente_id);
      if (!cr.ok) return { error: cr.error };

      const explicitObra =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;
      const textoObra = [desc, mensajeTrim].filter(Boolean).join(' ').trim();
      const obraRes = await resolverObraDocumentoAgente(
        supabase,
        businessId,
        explicitObra,
        textoObra,
        'documento'
      );
      if (!obraRes.ok) return { mensaje: obraRes.mensaje };
      const obraIdFinal = obraRes.obra_id ?? '';

      let clienteIdFinal = cr.id;
      let clienteNombreFinal: string | null = null;
      if (obraIdFinal && cr.id == null) {
        const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
          supabase,
          businessId,
          obraIdFinal
        );
        if (cidO) {
          clienteIdFinal = cidO;
          clienteNombreFinal = cnO;
        }
      }

      const { error } = await supabase.from('facturas').insert({
        business_id: businessId,
        cliente_nombre: clienteNombreFinal,
        descripcion_trabajos: desc,
        base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
        iva: Number.isFinite(iva) ? iva : 0,
        total: Number.isFinite(totalNum) ? totalNum : 0,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
        ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
      });

      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'crear_albaran': {
      const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
      if (!desc) {
        return { error: 'descripcion_trabajos es obligatorio' };
      }
      const totalRaw = toolArgs.total;
      const totalNum =
        totalRaw != null && Number.isFinite(Number(totalRaw))
          ? Number(totalRaw)
          : null;
      const clienteAlb =
        toolArgs.cliente_nombre != null
          ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
          : '';

      const cr = await resolveClienteIdOpcional(supabase, businessId, toolArgs.cliente_id);
      if (!cr.ok) return { error: cr.error };

      const explicitObra =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;
      const textoObra = [desc, clienteAlb, mensajeTrim].filter(Boolean).join(' ').trim();
      const obraRes = await resolverObraDocumentoAgente(
        supabase,
        businessId,
        explicitObra,
        textoObra,
        'documento'
      );
      if (!obraRes.ok) return { mensaje: obraRes.mensaje };
      const obraIdFinal = obraRes.obra_id ?? '';

      let clienteIdFinal = cr.id;
      let clienteNombreFinal = clienteAlb.length > 0 ? clienteAlb : null;
      if (obraIdFinal && cr.id == null) {
        const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
          supabase,
          businessId,
          obraIdFinal
        );
        if (cidO) {
          clienteIdFinal = cidO;
          if (cnO) clienteNombreFinal = cnO;
        }
      }

      const { error } = await supabase.from('albaranes').insert({
        business_id: businessId,
        cliente_nombre: clienteNombreFinal,
        descripcion_trabajos: desc,
        total: totalNum,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
        ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
      });

      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'convertir_albaran_a_factura': {
      const albaranId = String(toolArgs.albaran_id ?? '').trim();
      const ivaPctRaw = toolArgs.iva ?? 21;
      const observaciones =
        toolArgs.observaciones != null ? String(toolArgs.observaciones).trim() : '';

      if (!albaranId) return { error: 'albaran_id es obligatorio' };
      const iva_porcentaje = Number(ivaPctRaw);
      if (!Number.isFinite(iva_porcentaje)) return { error: 'iva debe ser un número' };

      const { data: aRow, error: aErr } = await supabase
        .from('albaranes')
        .select(
          'id, estado, cliente_nombre, cliente_id, cliente_direccion, descripcion_trabajos, lineas, total'
        )
        .eq('id', albaranId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (aErr) return { error: aErr.message };
      if (!aRow) return { error: 'Albarán no encontrado' };

      const clienteNombre = (aRow.cliente_nombre ?? '') as string;
      const totalNum =
        aRow.total != null && Number.isFinite(Number(aRow.total))
          ? Number(aRow.total)
          : 0;

      const round2 = (n: number) => Math.round(n * 100) / 100;

      let extrasRows: Array<{
        importe_total?: number | null;
        presupuesto_generado?: string | null;
        mensaje_cliente?: string | null;
      }> = [];

      const cidAlb = aRow.cliente_id ?? null;
      const cnTrim = clienteNombre.trim();
      if (cidAlb || cnTrim) {
        let extrasQuery = supabase
          .from('presupuestos')
          .select('importe_total, presupuesto_generado, mensaje_cliente')
          .eq('business_id', businessId)
          .eq('es_extra', true)
          .eq('estado', 'aceptado');
        if (cidAlb) {
          extrasQuery = extrasQuery.eq('cliente_id', cidAlb);
        } else {
          extrasQuery = extrasQuery.ilike('cliente_nombre', cnTrim);
        }
        const { data: extraData, error: exErr } = await extrasQuery;
        if (exErr) return { error: exErr.message };
        extrasRows = (extraData ?? []) as typeof extrasRows;
      }

      let extrasSum = 0;
      const extraLines: string[] = [];
      for (const ex of extrasRows) {
        const imp =
          ex.importe_total != null && Number.isFinite(Number(ex.importe_total))
            ? Number(ex.importe_total)
            : 0;
        extrasSum += imp;
        const texto =
          (ex.presupuesto_generado ?? '').trim() ||
          (ex.mensaje_cliente ?? '').trim() ||
          'Extra';
        extraLines.push(`- ${texto} (${round2(imp).toFixed(2)} €)`);
      }

      const totalConExtras = totalNum + extrasSum;

      let descripcionTrabajos = (aRow.descripcion_trabajos ?? '') || '';
      if (extraLines.length > 0) {
        const bloque = `Extras aceptados (IVA no incluido en importes de extra):\n${extraLines.join('\n')}`;
        descripcionTrabajos = descripcionTrabajos.trim()
          ? `${descripcionTrabajos.trim()}\n\n${bloque}`
          : bloque;
      }

      const base_imponible = round2(totalConExtras / (1 + iva_porcentaje / 100));
      const iva_importe = round2(totalConExtras - base_imponible);

      const { error: insertErr } = await supabase.from('facturas').insert({
        business_id: businessId,
        albaran_id: albaranId,
        cliente_nombre: clienteNombre || null,
        cliente_id: aRow.cliente_id ?? null,
        cliente_direccion: aRow.cliente_direccion ?? null,
        descripcion_trabajos: descripcionTrabajos || null,
        lineas: aRow.lineas ?? null,
        base_imponible,
        iva: iva_importe,
        total: totalConExtras,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        observaciones:
          observaciones.length > 0 ? observaciones : 'Generada desde albarán',
      });

      if (insertErr) return { error: insertErr.message };

      const { error: updErr } = await supabase
        .from('albaranes')
        .update({ estado: 'facturado' })
        .eq('id', albaranId)
        .eq('business_id', businessId)
        .select('id')
        .maybeSingle();

      if (updErr) return { error: updErr.message };

      const extraNote =
        extrasSum > 0
          ? ` (incluye extras aceptados: ${round2(extrasSum).toFixed(2)}€)`
          : '';

      return {
        mensaje:
          `Factura creada correctamente a partir del albarán de ${clienteNombre}.\n` +
          `Total: ${round2(totalConExtras).toFixed(2)}€${extraNote}. El albarán ha sido marcado como facturado.`,
      };
    }
    case 'registrar_extra': {
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      const importeNum = Number(toolArgs.importe);
      const parentIdRaw = String(toolArgs.presupuesto_parent_id ?? '').trim();
      const clienteNombreParam =
        toolArgs.cliente_nombre != null
          ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
          : '';
      const notificar = toolArgs.notificar_cliente !== false;
      const explicitObraExtra =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;

      if (!descripcion) return { error: 'descripcion es obligatoria' };
      if (!Number.isFinite(importeNum) || importeNum < 0) {
        return { error: 'importe debe ser un número válido' };
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const impFmt = r2(importeNum).toFixed(2);

      type ParentRow = {
        id: string;
        cliente_nombre: string | null;
        cliente_id: string | null;
      };

      let parent: ParentRow | null = null;

      if (parentIdRaw) {
        const { data: p, error: pe } = await supabase
          .from('presupuestos')
          .select('id, cliente_nombre, cliente_id')
          .eq('id', parentIdRaw)
          .eq('business_id', businessId)
          .maybeSingle();
        if (pe) return { error: pe.message };
        if (!p) return { error: 'No se encontró el presupuesto padre' };
        parent = p as ParentRow;
      } else if (clienteNombreParam) {
        const safe = clienteNombreParam.replace(/[%_]/g, '').slice(0, 120);
        if (!safe) return { error: 'cliente_nombre no válido' };
        const pat = `%${safe}%`;
        const { data: p, error: pe } = await supabase
          .from('presupuestos')
          .select('id, cliente_nombre, cliente_id')
          .eq('business_id', businessId)
          .eq('es_extra', false)
          .neq('estado', 'rechazado')
          .ilike('cliente_nombre', pat)
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pe) return { error: pe.message };
        if (!p) {
          return {
            error:
              'No se encontró un presupuesto activo reciente para ese cliente. Indica presupuesto_parent_id o crea el presupuesto antes.',
          };
        }
        parent = p as ParentRow;
      } else {
        return {
          error:
            'Indica presupuesto_parent_id o cliente_nombre para vincular el extra al presupuesto original.',
        };
      }

      const clienteNombreFinal =
        (parent.cliente_nombre && String(parent.cliente_nombre).trim()) ||
        clienteNombreParam ||
        'Cliente';

      const textoObraExtra = [descripcion, clienteNombreParam, mensajeTrim]
        .filter(Boolean)
        .join(' ')
        .trim();
      const obraExtraRes = await resolverObraDocumentoAgente(
        supabase,
        businessId,
        explicitObraExtra,
        textoObraExtra,
        'extra'
      );
      if (!obraExtraRes.ok) return { mensaje: obraExtraRes.mensaje };
      const obraIdExtra = obraExtraRes.obra_id ?? '';

      const { error: insErr } = await supabase.from('presupuestos').insert({
        business_id: businessId,
        parent_id: parent.id,
        es_extra: true,
        presupuesto_generado: descripcion,
        importe_total: importeNum,
        cliente_nombre: clienteNombreFinal,
        cliente_id: parent.cliente_id ?? null,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        mensaje_cliente: `EXTRA/MODIFICADO: ${descripcion}`,
        ...(obraIdExtra ? { obra_id: obraIdExtra } : {}),
      });

      if (insErr) return { error: insErr.message };

      const baseMsg =
        `Extra registrado correctamente: '${descripcion}' por ${impFmt}€, vinculado al presupuesto de ${clienteNombreFinal}.`;

      if (!notificar) {
        return { mensaje: baseMsg };
      }

      let emailCliente: string | null = null;
      if (parent.cliente_id) {
        const { data: cli, error: cErr } = await supabase
          .from('clientes')
          .select('email')
          .eq('id', parent.cliente_id)
          .eq('business_id', businessId)
          .maybeSingle();
        if (!cErr && cli?.email != null) {
          const em = String(cli.email).trim();
          if (em) emailCliente = em;
        }
      }

      if (!emailCliente) {
        return {
          mensaje:
            baseMsg +
            ' No hay email del cliente en ficha: no se preparó borrador de notificación.',
        };
      }

      const cuerpo =
        `Hola ${clienteNombreFinal}, según lo hablado en obra, se ha detectado el siguiente imprevisto: ${descripcion}. El coste adicional será de ${impFmt}€ (IVA no incluido). Por favor, confírmenos su aprobación para proceder. Quedamos a su disposición.`;

      return {
        mensaje:
          baseMsg +
          ' He preparado un borrador de notificación al cliente. ¿Lo enviamos?',
        tipo: 'email_pendiente_aprobacion',
        para: emailCliente,
        asunto: `Imprevisto / extra en obra — ${clienteNombreFinal}`,
        cuerpo,
      };
    }
    case 'listar_extras': {
      const cn =
        toolArgs.cliente_nombre != null
          ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
          : '';
      const pid =
        toolArgs.presupuesto_parent_id != null
          ? String(toolArgs.presupuesto_parent_id).trim()
          : '';

      let q = supabase
        .from('presupuestos')
        .select('id, presupuesto_generado, importe_total, cliente_nombre, fecha, estado, parent_id')
        .eq('business_id', businessId)
        .eq('es_extra', true)
        .order('fecha', { ascending: false })
        .limit(50);

      if (pid) {
        q = q.eq('parent_id', pid);
      }
      if (cn) {
        const safe = cn.replace(/[%_]/g, '').slice(0, 120);
        if (safe) {
          const pat = `%${safe}%`;
          q = q.ilike('cliente_nombre', pat);
        }
      }

      const { data, error } = await q;
      if (error) return { error: error.message };
      return {
        items: (data ?? []).map(
          (r: {
            id?: string;
            presupuesto_generado?: string | null;
            importe_total?: number | null;
            cliente_nombre?: string | null;
            fecha?: string | null;
            estado?: string | null;
          }) => ({
            id: r.id ?? null,
            descripcion: r.presupuesto_generado ?? null,
            importe: r.importe_total ?? null,
            cliente: r.cliente_nombre ?? null,
            fecha: r.fecha ?? null,
            estado: r.estado ?? null,
          })
        ),
      };
    }
    case 'generar_presupuesto_por_dictado': {
      const dictado = String(toolArgs.dictado ?? '').trim();
      const clienteNombre =
        toolArgs.cliente_nombre != null
          ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
          : '';
      const direccionObra =
        toolArgs.direccion_obra != null
          ? String(toolArgs.direccion_obra).trim().slice(0, 500)
          : '';

      if (!dictado) return { error: 'dictado es obligatorio' };

      const cr = await resolveClienteIdOpcional(supabase, businessId, toolArgs.cliente_id);
      if (!cr.ok) return { error: cr.error };

      const explicitObra =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;

      let obraIdFinal = '';
      if (explicitObra) {
        const { data: obraRow, error: obraErr } = await supabase
          .from('obras')
          .select('id')
          .eq('business_id', businessId)
          .eq('id', explicitObra)
          .in('estado', ['abierta', 'en_curso'])
          .maybeSingle();
        if (obraErr || !obraRow?.id) {
          return { error: 'La obra indicada no existe o no está abierta.' };
        }
        obraIdFinal = obraRow.id;
      } else {
        const obraNombreExplicito =
          typeof toolArgs.obra_nombre === 'string' && toolArgs.obra_nombre.trim()
            ? toolArgs.obra_nombre.trim()
            : '';
        const textoObra = [obraNombreExplicito, clienteNombre, direccionObra]
          .filter(Boolean)
          .join(' ')
          .trim() || mensajeTrim;
        const obraRes = await resolverObraDocumentoAgente(
          supabase,
          businessId,
          undefined,
          textoObra,
          'documento'
        );
        if (!obraRes.ok) return { mensaje: obraRes.mensaje };
        obraIdFinal = obraRes.obra_id ?? '';
      }

      let clienteIdFinal = cr.id;
      let clienteNombreParaDoc = clienteNombre;
      if (obraIdFinal && cr.id == null) {
        const { cliente_id: cidO, cliente_nombre: cnO } = await clienteDesdeObraSiAplica(
          supabase,
          businessId,
          obraIdFinal
        );
        if (cidO) {
          clienteIdFinal = cidO;
          if (cnO) clienteNombreParaDoc = cnO;
        }
      }

      const { data: tarifasRows, error: tErr } = await supabase
        .from('tarifas')
        .select('nombre, unidad, precio, categoria')
        .eq('business_id', businessId)
        .order('nombre', { ascending: true });

      if (tErr) return { error: tErr.message };

      const tarifasPropias = (tarifasRows ?? []) as Array<{
        nombre: string;
        unidad: string;
        precio: number | string;
        categoria: string | null;
      }>;

      const tarifasForApi: TarifaReferencia[] =
        tarifasPropias.length > 0
          ? tarifasPropias.map((r) => ({
              nombre: r.nombre,
              unidad: r.unidad,
              precio: Number(r.precio),
              categoria: (r.categoria ?? '').trim() || 'varios',
            }))
          : TARIFAS_BASE_ALBANILERIA.map((r) => ({
              nombre: r.nombre,
              unidad: r.unidad,
              precio: r.precio,
              categoria: r.categoria,
            }));

      let partidas;
      try {
        partidas = await estructurarDictadoEnPartidas(dictado, tarifasForApi);
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Error al estructurar el dictado' };
      }

      const { texto, totalConIva } = formatearBorradorPresupuestoDictado(
        partidas,
        clienteNombreParaDoc,
        direccionObra
      );

      const mensajeClienteDictado =
        typeof mensajeOriginal === 'string' && mensajeOriginal.trim().length > 0
          ? mensajeOriginal.trim().slice(0, 2000)
          : 'Presupuesto generado por dictado de visita';

      const soloVista = toolArgs.solo_vista_previa === true;
      if (soloVista) {
        return {
          mensaje: `Borrador (sin guardar aún):\n\n${texto}`,
          partidas,
          importe_total: totalConIva,
          pendiente_confirmacion: true,
        };
      }

      const { error: insErr } = await supabase.from('presupuestos').insert({
        business_id: businessId,
        presupuesto_generado: texto,
        importe_total: totalConIva,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'borrador',
        mensaje_cliente: mensajeClienteDictado,
        ...(clienteNombreParaDoc.length > 0 && { cliente_nombre: clienteNombreParaDoc }),
        ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
        ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
      });

      if (insErr) return { error: insErr.message };

      return {
        mensaje:
          `Borrador generado y guardado (revisa importes y textos).\n\n${texto}`,
        partidas,
        importe_total: totalConIva,
      };
    }
    case 'gestionar_tarifas': {
      const accion = String(toolArgs.accion ?? '').trim().toLowerCase();
      if (!['listar', 'añadir', 'editar', 'eliminar'].includes(accion)) {
        return { error: 'accion debe ser listar, añadir, editar o eliminar' };
      }

      if (accion === 'listar') {
        const { data, error } = await supabase
          .from('tarifas')
          .select('id, nombre, unidad, precio, categoria, created_at')
          .eq('business_id', businessId)
          .order('nombre', { ascending: true });
        if (error) return { error: error.message };
        return {
          items: (data ?? []).map(
            (r: {
              id: string;
              nombre: string;
              unidad: string;
              precio: number | string;
              categoria: string | null;
              created_at?: string;
            }) => ({
              id: r.id,
              nombre: r.nombre,
              unidad: r.unidad,
              precio: r.precio != null ? Number(r.precio) : null,
              categoria: r.categoria,
              created_at: r.created_at ?? null,
            })
          ),
        };
      }

      if (accion === 'añadir') {
        const nombre = String(toolArgs.nombre ?? '').trim();
        const unidad = String(toolArgs.unidad ?? '').trim();
        const precio = Number(toolArgs.precio);
        const categoria =
          toolArgs.categoria != null ? String(toolArgs.categoria).trim().slice(0, 120) : '';
        if (!nombre) return { error: 'nombre es obligatorio para añadir' };
        if (!unidad) return { error: 'unidad es obligatoria para añadir' };
        if (!Number.isFinite(precio) || precio < 0) {
          return { error: 'precio debe ser un número válido' };
        }

        const { data: row, error } = await supabase
          .from('tarifas')
          .insert({
            business_id: businessId,
            nombre,
            unidad,
            precio,
            ...(categoria ? { categoria } : { categoria: null }),
          })
          .select('id')
          .single();
        if (error) return { error: error.message };
        return { ok: true, id: row?.id as string, mensaje: `Tarifa "${nombre}" añadida.` };
      }

      if (accion === 'editar') {
        const tarifaId = String(toolArgs.tarifa_id ?? '').trim();
        if (!tarifaId) return { error: 'tarifa_id es obligatorio para editar' };
        const updates: Record<string, unknown> = {};
        if (toolArgs.nombre !== undefined) {
          const n = String(toolArgs.nombre).trim();
          if (!n) return { error: 'nombre no puede estar vacío' };
          updates.nombre = n;
        }
        if (toolArgs.unidad !== undefined) {
          const u = String(toolArgs.unidad).trim();
          if (!u) return { error: 'unidad no puede estar vacía' };
          updates.unidad = u;
        }
        if (toolArgs.precio !== undefined) {
          const pr = Number(toolArgs.precio);
          if (!Number.isFinite(pr) || pr < 0) return { error: 'precio inválido' };
          updates.precio = pr;
        }
        if (toolArgs.categoria !== undefined) {
          updates.categoria = String(toolArgs.categoria).trim() || null;
        }
        if (Object.keys(updates).length === 0) {
          return {
            error:
              'Indica al menos un campo a editar (nombre, unidad, precio, categoria)',
          };
        }
        updates.updated_at = new Date().toISOString();
        const { data: row, error } = await supabase
          .from('tarifas')
          .update(updates)
          .eq('id', tarifaId)
          .eq('business_id', businessId)
          .select('id')
          .maybeSingle();
        if (error) return { error: error.message };
        if (!row?.id) return { error: 'Tarifa no encontrada' };
        return { ok: true, id: row.id as string, mensaje: 'Tarifa actualizada.' };
      }

      if (accion === 'eliminar') {
        const tarifaId = String(toolArgs.tarifa_id ?? '').trim();
        const nombreTarifa = String(toolArgs.nombre_tarifa ?? '').trim();
        const confirmarEliminacion = toolArgs.confirmar_eliminacion === true;

        type TarifaDeleteRow = {
          id: string;
          nombre: string;
          unidad: string;
          precio: number | string;
        };

        let candidatas: TarifaDeleteRow[] = [];

        if (tarifaId) {
          const { data, error } = await supabase
            .from('tarifas')
            .select('id, nombre, unidad, precio')
            .eq('id', tarifaId)
            .eq('business_id', businessId)
            .limit(1);
          if (error) return { error: error.message };
          candidatas = (data ?? []) as TarifaDeleteRow[];
        } else {
          if (!nombreTarifa) {
            return { error: 'Para eliminar, indica tarifa_id o nombre_tarifa.' };
          }
          const safeNombre = nombreTarifa.replace(/[%_]/g, '').trim();
          if (!safeNombre) return { error: 'nombre_tarifa no válido.' };
          const { data, error } = await supabase
            .from('tarifas')
            .select('id, nombre, unidad, precio')
            .eq('business_id', businessId)
            .ilike('nombre', `%${safeNombre}%`)
            .order('nombre', { ascending: true })
            .limit(10);
          if (error) return { error: error.message };
          candidatas = (data ?? []) as TarifaDeleteRow[];
        }

        if (candidatas.length === 0) {
          return { error: 'No se encontró ninguna tarifa que coincida para eliminar.' };
        }

        if (candidatas.length > 1) {
          return {
            requiere_confirmacion: true,
            multiple_candidatas: true,
            mensaje:
              'He encontrado varias tarifas. Indica tarifa_id (o un nombre más específico) y confirma explícitamente para eliminar.',
            candidatas: candidatas.map((r) => ({
              id: r.id,
              nombre: r.nombre,
              unidad: r.unidad,
              precio: r.precio != null ? Number(r.precio) : null,
            })),
          };
        }

        const candidata = candidatas[0]!;
        if (!confirmarEliminacion) {
          return {
            requiere_confirmacion: true,
            mensaje:
              'Vista previa de eliminación. Si quieres borrarla, vuelve a llamar con confirmar_eliminacion=true.',
            tarifa: {
              id: candidata.id,
              nombre: candidata.nombre,
              unidad: candidata.unidad,
              precio: candidata.precio != null ? Number(candidata.precio) : null,
            },
          };
        }

        const { data: deletedRows, error: delErr } = await supabase
          .from('tarifas')
          .delete()
          .eq('id', candidata.id)
          .eq('business_id', businessId)
          .select('id, nombre, precio')
          .limit(1);
        if (delErr) return { error: delErr.message };
        const deleted = (deletedRows ?? [])[0] as { id: string; nombre: string; precio: number | string } | undefined;
        if (!deleted?.id) return { error: 'Tarifa no encontrada o sin permisos para eliminar.' };
        return {
          ok: true,
          id: deleted.id,
          mensaje: `Tarifa eliminada: "${deleted.nombre}" (${Number(deleted.precio)} €).`,
        };
      }

      return { error: 'accion no reconocida' };
    }
    default:
      return { error: `Tool de documentos no soportada: ${toolName}` };
  }
}
