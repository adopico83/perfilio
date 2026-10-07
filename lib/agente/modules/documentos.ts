import { ymdHoyMadrid } from '@/lib/fechas-madrid';
import { insertarFacturaConNumeroCorrelativo } from '@/lib/facturas/numero';
import { crearFacturaDesdeAlbaran } from '@/lib/facturas/desde-albaran';
import { actualizarFactura } from '@/lib/facturas/editar';
import { ESTADOS_FACTURA, cambiarEstadoFactura } from '@/lib/facturas/estado';
import { ivaPorcentajeDeFactura } from '@/lib/facturas/iva';
import { ESTADOS_ALBARAN_EDITABLES, actualizarAlbaranNoFacturado, cambiarEstadoAlbaran } from '@/lib/albaranes/estado';
import { failClosed, resolverClientesPorNombre, resultadoResolveATool } from '@/lib/agente/modules/grounding';
import { localizarDesdeArgs } from '@/lib/agente/modules/documentos-localizar';
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  diasDesdeFechaHasta,
  hoyYmdEnZona,
  listarAlbaranesSinFacturar,
} from '@/lib/albaranes-sin-facturar';
import {
  estructurarDictadoEnPartidas,
  corregirPartidasConDictado,
  validarPartidasContraDictado,
  formatearBorradorPresupuestoDictado,
  type TarifaReferencia,
} from '@/lib/dictado-presupuesto';
import { insertarPresupuestoConNumeroCorrelativo } from '@/lib/presupuestos/numero';
import { generarTextoCanonico } from '@/lib/presupuestos/texto-canonico';
import { TARIFAS_BASE_ALBANILERIA } from '@/lib/tarifas-base';
import { resolverObraDocumentoAgente, aclaracionObra } from '@/lib/obras-context';
import {
  clienteDesdeObraSiAplica,
  resolveClienteIdOpcional,
} from '@/lib/agente/modules/obras-clientes';

/**
 * Edita una factura pendiente reutilizando `actualizarFactura` (la misma función que el editor de
 * Facturas y `PATCH /api/facturas/[id]`): mismas validaciones y el servidor recalcula base, IVA y total.
 * Se localiza por id, número o cliente (`cliente`); `cliente_nombre` es el nombre NUEVO.
 */
export async function editar_factura(
  supabase: SupabaseClient,
  businessId: string,
  toolArgs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const loc = await localizarDesdeArgs(supabase, businessId, 'factura', toolArgs);
  if (!loc.ok) return loc;
  const id = loc.match.id;

  const { data: f, error: errLeer } = await supabase
    .from('facturas')
    .select('id, numero_factura, estado, cliente_nombre, descripcion_trabajos, base_imponible, iva, lineas')
    .eq('id', id)
    .eq('business_id', businessId)
    .maybeSingle();
  if (errLeer) return { error: errLeer.message };
  if (!f) return { error: 'No se encontró la factura o no pertenece a este negocio' };
  const fila = f as Record<string, unknown>;
  const estado = String(fila.estado ?? 'pendiente');
  if (estado !== 'pendiente') {
    return { error: `Solo se pueden editar facturas pendientes; esta está «${estado}».` };
  }

  const clienteNuevo = toolArgs.cliente_nombre !== undefined ? String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255) : undefined;
  if (clienteNuevo !== undefined && !clienteNuevo) return { error: 'cliente_nombre no puede estar vacío' };
  const descripcionRaw = toolArgs.descripcion !== undefined ? toolArgs.descripcion : toolArgs.descripcion_trabajos;
  const descripcionNueva = descripcionRaw !== undefined ? String(descripcionRaw ?? '').trim() : undefined;
  if (descripcionNueva !== undefined && !descripcionNueva) return { error: 'La descripción no puede estar vacía' };
  const lineasArgs = Array.isArray(toolArgs.lineas) ? (toolArgs.lineas as unknown[]) : null;
  const hayTotal = toolArgs.importe_total !== undefined;
  const ivaPct = toolArgs.iva_porcentaje !== undefined ? Number(toolArgs.iva_porcentaje) : undefined;

  if (clienteNuevo === undefined && !lineasArgs && !hayTotal && descripcionNueva === undefined && ivaPct === undefined) {
    return { error: 'Indica qué cambiar: cliente_nombre, lineas, iva_porcentaje, importe_total o descripcion.' };
  }

  const lineasActuales = Array.isArray(fila.lineas) ? (fila.lineas as Array<Record<string, unknown>>) : [];
  let lineas: unknown[];
  if (lineasArgs) {
    lineas = lineasArgs;
  } else if (lineasActuales.length > 0) {
    // Con líneas guardadas, cambiar solo el total o el texto dejaría el PDF (que lee las líneas) distinto del total.
    if (hayTotal || descripcionNueva !== undefined) {
      return {
        error:
          'Esta factura tiene líneas de detalle: dime las líneas nuevas (descripción, cantidad y precio) para que el PDF y el total coincidan.',
      };
    }
    lineas = lineasActuales.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      unidad: l.unidad,
      capitulo: l.capitulo,
    }));
  } else {
    // Factura sin líneas (antigua): se guarda como una sola línea con el texto y la base.
    const textoActual = String(fila.descripcion_trabajos ?? '').split('\n')[0]?.trim();
    const descripcion = descripcionNueva ?? (textoActual || 'Trabajos realizados');
    let base = Number(fila.base_imponible);
    if (hayTotal) {
      const total = Number(toolArgs.importe_total);
      if (!Number.isFinite(total) || total < 0) return { error: 'importe_total debe ser un número válido' };
      const pct = ivaPct ?? ivaPorcentajeDeFactura(fila.base_imponible, fila.iva);
      base = Math.round((total / (1 + pct / 100)) * 100) / 100;
    }
    lineas = [{ descripcion, cantidad: 1, precio_unitario: Number.isFinite(base) ? base : 0 }];
  }

  const r = await actualizarFactura(supabase, businessId, id, {
    cliente_nombre: clienteNuevo ?? String(fila.cliente_nombre ?? ''),
    lineas,
    ...(ivaPct !== undefined ? { iva_porcentaje: ivaPct } : {}),
  });
  if (!r.ok) return { error: r.error };
  const total = Number(r.factura.total);
  return {
    ok: true,
    id,
    mensaje: `Factura${fila.numero_factura != null ? ` nº ${fila.numero_factura}` : ''} actualizada: total ${total.toFixed(2)} € (IVA incluido).`,
  };
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
            'Cambia el estado de una factura: pendiente, pagada o vencida (NO existe «pagado», «aceptado» ni «facturado» en facturas). Localízala por numero o cliente; no pidas UUIDs al usuario.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID (solo si ya lo tienes de una consulta anterior)' },
              numero: { type: 'number', description: 'Número del documento tal como lo dice el usuario (p. ej. 3)' },
              cliente: { type: 'string', description: 'Cliente del documento, si el usuario no dice el número' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_FACTURA],
                description: 'Nuevo estado de la factura',
              },
            },
            required: ['estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_albaran',
          description:
            'Cambia el estado de un albarán: pendiente o entregado. NO sirve para facturar (para eso, convertir_albaran_a_factura) y un albarán ya facturado no cambia. Localízalo por numero o cliente.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID (solo si ya lo tienes de una consulta anterior)' },
              numero: { type: 'number', description: 'Número del documento tal como lo dice el usuario (p. ej. 3)' },
              cliente: { type: 'string', description: 'Cliente del documento, si el usuario no dice el número' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_ALBARAN_EDITABLES],
                description: 'Nuevo estado del albarán',
              },
            },
            required: ['estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_factura',
          description:
            'Edita una factura PENDIENTE. Localízala por numero o cliente. Para cambiar importes manda las lineas completas (descripcion, cantidad, precio_unitario) y, si cambia, iva_porcentaje (0, 4, 10 o 21): el servidor recalcula base, IVA y total. cliente_nombre es el nombre NUEVO del cliente.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID (solo si ya lo tienes de una consulta anterior)' },
              numero: { type: 'number', description: 'Número del documento tal como lo dice el usuario (p. ej. 3)' },
              cliente: { type: 'string', description: 'Cliente del documento, si el usuario no dice el número' },
              cliente_nombre: { type: 'string', description: 'Nombre NUEVO del cliente en la factura' },
              lineas: {
                type: 'array',
                description: 'Líneas completas de la factura (sustituyen a las actuales)',
                items: {
                  type: 'object',
                  properties: {
                    descripcion: { type: 'string' },
                    cantidad: { type: 'number' },
                    precio_unitario: { type: 'number', description: 'Precio por unidad SIN IVA' },
                    unidad: { type: 'string' },
                  },
                  required: ['descripcion', 'cantidad', 'precio_unitario'],
                  additionalProperties: false,
                },
              },
              iva_porcentaje: { type: 'number', enum: [0, 4, 10, 21], description: 'IVA de la factura' },
              importe_total: { type: 'number', description: 'Solo facturas antiguas sin líneas: total con IVA (se recalcula base e IVA)' },
              descripcion: { type: 'string', description: 'Solo facturas antiguas sin líneas: texto del trabajo' },
            },
            required: [],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_albaran',
          description:
            'Edita un albarán que NO esté facturado: cliente_nombre (nombre NUEVO), importe_total (IVA incluido) o descripcion. Localízalo por numero o cliente.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID (solo si ya lo tienes de una consulta anterior)' },
              numero: { type: 'number', description: 'Número del documento tal como lo dice el usuario (p. ej. 3)' },
              cliente: { type: 'string', description: 'Cliente del documento, si el usuario no dice el número' },
              cliente_nombre: { type: 'string', description: 'Nombre NUEVO del cliente' },
              importe_total: { type: 'number', description: 'Total con IVA incluido' },
              descripcion: { type: 'string', description: 'Descripción de trabajos' },
            },
            required: [],
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
              total: { type: 'number', description: 'Total con IVA. Solo el que haya dicho el usuario: si no lo dijo, pregúntaselo' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente (se busca su ficha; si no existe o hay varios, se pregunta)' },
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
            'Albarán → factura (copia datos, calcula base e IVA y marca el albarán facturado; es idempotente: si ya tiene factura la devuelve). Localiza el albarán por numero o cliente. El total del albarán se entiende con IVA incluido.',
          parameters: {
            type: 'object',
            properties: {
              albaran_id: { type: 'string', description: 'UUID del albarán (solo si ya lo tienes de una consulta anterior)' },
              numero: { type: 'number', description: 'Número del albarán tal como lo dice el usuario' },
              cliente: { type: 'string', description: 'Cliente del albarán, si el usuario no dice el número' },
              iva: { type: 'number', enum: [0, 4, 10, 21], description: 'Porcentaje de IVA: 0, 4, 10 o 21 (por defecto 21)' },
              observaciones: { type: 'string', description: 'Observaciones para la factura' },
            },
            required: [],
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
      const loc = await localizarDesdeArgs(supabase, businessId, 'factura', toolArgs);
      if (!loc.ok) return loc;
      // La regla del estado vive en lib/facturas/estado.ts (la misma que usa la API de Facturas).
      const r = await cambiarEstadoFactura(supabase, businessId, loc.match.id, toolArgs.estado);
      if (!r.ok) return { error: r.error };
      return { ok: true, id: r.id, estado: r.estado, mensaje: `Factura${loc.match.numero != null ? ` nº ${loc.match.numero}` : ''} marcada como «${r.estado}».` };
    }
    case 'cambiar_estado_albaran': {
      const loc = await localizarDesdeArgs(supabase, businessId, 'albaran', toolArgs);
      if (!loc.ok) return loc;
      // Misma regla que la API: solo pendiente/entregado y un albarán facturado no cambia.
      const r = await cambiarEstadoAlbaran(supabase, businessId, loc.match.id, toolArgs.estado);
      if (!r.ok) return { error: r.error };
      return { ok: true, id: r.id, mensaje: `Albarán${loc.match.numero != null ? ` nº ${loc.match.numero}` : ''} actualizado.` };
    }
    case 'editar_factura': {
      return editar_factura(supabase, String(businessId ?? ''), toolArgs);
    }
    case 'editar_albaran': {
      const loc = await localizarDesdeArgs(supabase, businessId, 'albaran', toolArgs);
      if (!loc.ok) return loc;
      const updates: { cliente_nombre?: string; total?: number; descripcion_trabajos?: string } = {};
      if (toolArgs.cliente_nombre !== undefined) {
        const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
        if (!c) return { error: 'cliente_nombre no puede estar vacío' };
        updates.cliente_nombre = c;
      }
      if (toolArgs.importe_total !== undefined) {
        const n = Number(toolArgs.importe_total);
        if (!Number.isFinite(n) || n < 0) return { error: 'importe_total debe ser un número válido' };
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
      // Un albarán facturado no se edita (y la condición va en el propio UPDATE).
      const r = await actualizarAlbaranNoFacturado(supabase, businessId, loc.match.id, updates);
      if (!r.ok) return { error: r.error };
      return { ok: true, id: r.id, mensaje: `Albarán${loc.match.numero != null ? ` nº ${loc.match.numero}` : ''} actualizado.` };
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
        if (!obraRes.ok) return aclaracionObra(obraRes);
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

      // Con número correlativo del negocio (antes se guardaba sin número y salía «—» en el PDF).
      const creado = await insertarPresupuestoConNumeroCorrelativo(
        supabase,
        businessId,
        {
          mensaje_cliente: mensajeOriginal,
          presupuesto_generado: texto,
          fecha: ymdHoyMadrid(),
          estado: 'borrador',
          ...(importe_total != null && { importe_total }),
          ...(clienteNombreFinal.length > 0 && { cliente_nombre: clienteNombreFinal }),
          ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
          ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
        },
        'id'
      );

      if (!creado.ok) return { error: creado.error };
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

      // Cliente por nombre (sin inventar): una coincidencia → su ficha; ninguna o varias → se pregunta.
      let clienteIdFactura = cr.id;
      let clienteNombreFactura = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
      if (clienteIdFactura == null && clienteNombreFactura) {
        const res = await resolverClientesPorNombre(supabase, businessId, clienteNombreFactura);
        if (res.status === 'none') {
          return failClosed(`No tengo a «${clienteNombreFactura}» entre tus clientes. ¿Lo creo primero o es otro nombre?`);
        }
        const r = resultadoResolveATool(res, clienteNombreFactura, 'cliente');
        if (!r.ok) return r;
        clienteIdFactura = r.match.id;
        clienteNombreFactura = r.match.nombre ?? clienteNombreFactura;
      } else if (clienteIdFactura != null && !clienteNombreFactura) {
        const { data: cli } = await supabase.from('clientes').select('nombre').eq('id', clienteIdFactura).eq('business_id', businessId).maybeSingle();
        clienteNombreFactura = String((cli as { nombre?: string | null } | null)?.nombre ?? '').trim();
      }

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
      if (!obraRes.ok) return aclaracionObra(obraRes);
      const obraIdFinal = obraRes.obra_id ?? '';

      let clienteIdFinal = clienteIdFactura;
      let clienteNombreFinal: string | null = clienteNombreFactura || null;
      if (obraIdFinal && clienteIdFinal == null) {
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

      // Número correlativo POR NEGOCIO (antes cogía el contador global de la base de datos).
      const ins = await insertarFacturaConNumeroCorrelativo(
        supabase,
        businessId,
        {
          cliente_nombre: clienteNombreFinal,
          descripcion_trabajos: desc,
          base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
          iva: Number.isFinite(iva) ? iva : 0,
          total: Number.isFinite(totalNum) ? totalNum : 0,
          fecha: ymdHoyMadrid(),
          estado: 'pendiente',
          ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
          ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
        },
        'id, numero_factura'
      );

      if (!ins.ok) return { error: ins.error };
      return { ok: true, numero_factura: ins.data.numero_factura ?? null };
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
      if (!obraRes.ok) return aclaracionObra(obraRes);
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
        fecha: ymdHoyMadrid(),
        estado: 'pendiente',
        ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
        ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
      });

      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'convertir_albaran_a_factura': {
      const ivaPct = Number(toolArgs.iva ?? 21);
      if (!Number.isFinite(ivaPct)) return { error: 'iva debe ser un número' };
      // Por id, número o cliente (entre los NO facturados si se busca por cliente).
      const loc = await localizarDesdeArgs(
        supabase,
        businessId,
        'albaran',
        { ...toolArgs, id: toolArgs.albaran_id ?? toolArgs.id, cliente: toolArgs.cliente ?? toolArgs.cliente_nombre },
        { excluirEstado: 'facturado' }
      );
      if (!loc.ok) return loc;

      // Misma función que usa la pantalla de albaranes: valida el IVA y es idempotente.
      const r = await crearFacturaDesdeAlbaran(supabase, businessId, loc.match.id, {
        iva_porcentaje: ivaPct,
        observaciones: toolArgs.observaciones != null ? String(toolArgs.observaciones) : null,
      });
      if (!r.ok) return { error: r.error };
      const cliente = r.cliente_nombre ?? '';
      const base = r.ya_existia
        ? `Ese albarán ya tenía factura (nº ${r.numero_factura}, ${r.total.toFixed(2)}€): no se ha creado otra.`
        : r.aviso
          ? `Factura creada a partir del albarán de ${cliente}.\nTotal: ${r.total.toFixed(2)}€.`
          : `Factura creada correctamente a partir del albarán de ${cliente}.\n` +
            `Total: ${r.total.toFixed(2)}€. El albarán ha sido marcado como facturado.`;
      return { mensaje: r.aviso ? `${base}\nAviso: ${r.aviso}` : base };
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
      if (!obraExtraRes.ok) return aclaracionObra(obraExtraRes);
      const obraIdExtra = obraExtraRes.obra_id ?? '';

      // Los extras también son filas de `presupuestos`: llevan su propio número correlativo.
      const extraCreado = await insertarPresupuestoConNumeroCorrelativo(
        supabase,
        businessId,
        {
          parent_id: parent.id,
          es_extra: true,
          presupuesto_generado: descripcion,
          importe_total: importeNum,
          cliente_nombre: clienteNombreFinal,
          cliente_id: parent.cliente_id ?? null,
          fecha: ymdHoyMadrid(),
          estado: 'pendiente',
          mensaje_cliente: `EXTRA/MODIFICADO: ${descripcion}`,
          ...(obraIdExtra ? { obra_id: obraIdExtra } : {}),
        },
        'id'
      );

      if (!extraCreado.ok) return { error: extraCreado.error };

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
        if (!obraRes.ok) return aclaracionObra(obraRes);
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
      // Al confirmar con el botón llegan las partidas que se ENSEÑARON en la vista previa: no se vuelve a
      // llamar al modelo (daría otras distintas).
      const resueltas = Array.isArray(toolArgs.partidas_resueltas)
        ? (toolArgs.partidas_resueltas as Array<Record<string, unknown>>)
            .map((p) => ({
              descripcion: String(p.descripcion ?? '').trim(),
              cantidad: Number(p.cantidad),
              unidad: String(p.unidad ?? 'ud'),
              precio_unitario: Number(p.precio_unitario),
              total: Number(p.total),
              categoria: String(p.categoria ?? 'varios'),
            }))
            .filter((p) => p.descripcion && Number.isFinite(p.cantidad) && Number.isFinite(p.precio_unitario))
        : [];
      if (resueltas.length > 0) {
        partidas = resueltas;
      } else {
        try {
          partidas = await estructurarDictadoEnPartidas(dictado, tarifasForApi);
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Error al estructurar el dictado' };
        }
        // Los números que dijo el usuario mandan: se corrigen o se pregunta, nunca se guarda otro precio.
        partidas = corregirPartidasConDictado(dictado, partidas);
      }

      const IVA_DICTADO = 21;
      const canon = generarTextoCanonico(
        partidas.map((p) => ({
          concepto: p.descripcion,
          cantidad: p.cantidad,
          precio: p.precio_unitario,
        })),
        IVA_DICTADO
      );
      if (!canon.ok) return { error: canon.error };
      if (resueltas.length === 0) {
        const noCuadra = validarPartidasContraDictado(dictado, partidas);
        if (noCuadra) return { ok: false, error: noCuadra };
      }

      const partidasValidadas = partidas.map((p, i) => ({
        ...p,
        cantidad: canon.partidas[i].cantidad,
        precio_unitario: canon.partidas[i].precio,
        total: canon.partidas[i].importe,
      }));
      const { texto: textoVistaPrevia } = formatearBorradorPresupuestoDictado(
        partidasValidadas,
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
          mensaje: `Borrador (sin guardar aún):\n\n${textoVistaPrevia}`,
          partidas: partidasValidadas,
          importe_total: canon.total,
          pendiente_confirmacion: true,
          args_resueltos: {
            partidas_resueltas: partidasValidadas,
            ...(clienteIdFinal ? { cliente_id: clienteIdFinal } : {}),
            ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
            ...(clienteNombreParaDoc ? { cliente_nombre: clienteNombreParaDoc } : {}),
          },
        };
      }

      const creado = await insertarPresupuestoConNumeroCorrelativo(
        supabase,
        businessId,
        {
          presupuesto_generado: canon.texto,
          importe_total: canon.total,
          fecha: ymdHoyMadrid(),
          estado: 'borrador',
          mensaje_cliente: mensajeClienteDictado,
          ...(clienteNombreParaDoc.length > 0 && { cliente_nombre: clienteNombreParaDoc }),
          ...(clienteIdFinal != null && { cliente_id: clienteIdFinal }),
          ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
        },
        'id, numero_presupuesto'
      );
      if (!creado.ok) return { error: creado.error };

      const numeroCreado = creado.data.numero_presupuesto == null ? null : Number(creado.data.numero_presupuesto);
      return {
        mensaje:
          `Presupuesto${numeroCreado != null ? ` nº ${numeroCreado}` : ''}${clienteNombreParaDoc ? ` de ${clienteNombreParaDoc}` : ''} guardado como borrador (revisa importes y textos).\n\n${textoVistaPrevia}`,
        ok: true,
        presupuesto_id: String(creado.data.id),
        numero_presupuesto: numeroCreado,
        cliente_nombre: clienteNombreParaDoc || null,
        partidas: partidasValidadas,
        importe_total: canon.total,
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
