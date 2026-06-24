import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/** El modelo a veces envía un objeto o string JSON en lugar de un array; sin esto capturarCanvas no rellena canvas. */
export function normalizarDatosCanvasVista(datos: unknown): unknown[] {
  if (Array.isArray(datos)) return datos;
  if (datos && typeof datos === 'object') return [datos];
  if (typeof datos === 'string') {
    const s = datos.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object') return [p];
    } catch {
      return [];
    }
  }
  return [];
}

export const CANVAS_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'mostrar_vista_visual',
      description:
        'Panel modal (tabla/canvas). Orden obligatorio: primero ejecuta la tool de listado que corresponda (listar_* o leer_emails_recientes); luego llama a esta con el array completo en datos (p. ej. items). No abras canvas sin datos ni sin petición explícita de vista/tabla/panel. Tras abrir, mensaje breve.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [
              'presupuestos',
              'facturas',
              'albaranes',
              'clientes',
              'emails',
              'gastos',
              'diario',
            ],
            description: 'Tipo de datos a mostrar',
          },
          titulo: {
            type: 'string',
            description: "Título del panel, ej: 'Últimos presupuestos', 'Emails recientes'",
          },
          datos: {
            type: 'array',
            description:
              'Array completo de filas obtenido en la respuesta de la tool de listado previa (p. ej. todos los elementos de "items"); no debe estar vacío.',
            items: { type: 'object' },
          },
        },
        required: ['tipo', 'titulo', 'datos'],
        additionalProperties: false,
      },
    },
  },
];

type RunToolFn = (toolName: string, toolArgs: Record<string, unknown>) => Promise<unknown>;

export async function handleMostrarVistaVisual(
  toolArgs: Record<string, unknown>,
  businessId: string,
  supabase: SupabaseClient,
  runTool: RunToolFn
): Promise<
  | { error: string }
  | {
      accion: 'abrir_canvas';
      tipo: string;
      titulo: string;
      datos: unknown[];
    }
> {
  const tipoRaw = String(toolArgs.tipo ?? '').trim();
  const titulo = String(toolArgs.titulo ?? '').trim();
  const datosRaw = toolArgs.datos;
  const allowed = new Set([
    'presupuestos',
    'facturas',
    'albaranes',
    'clientes',
    'emails',
    'gastos',
    'diario',
  ]);
  if (!allowed.has(tipoRaw)) {
    return {
      error: `tipo inválido; use uno de: ${[...allowed].join(', ')}`,
    };
  }
  if (!titulo) {
    return { error: 'titulo es obligatorio' };
  }
  let datosNorm = normalizarDatosCanvasVista(datosRaw);

  const extraerItems = (r: unknown): unknown[] | null => {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    return null;
  };

  if (datosNorm.length === 0) {
    switch (tipoRaw) {
      case 'presupuestos': {
        const r = await runTool('listar_presupuestos', {});
        const items = extraerItems(r);
        if (items) datosNorm = items;
        else if (r && typeof r === 'object' && 'error' in r) {
          console.error(
            '[agente] mostrar_vista_visual fallback presupuestos:',
            (r as { error: string }).error
          );
        }
        break;
      }
      case 'facturas': {
        const r = await runTool('listar_facturas', {});
        const items = extraerItems(r);
        if (items) datosNorm = items;
        else if (r && typeof r === 'object' && 'error' in r) {
          console.error(
            '[agente] mostrar_vista_visual fallback facturas:',
            (r as { error: string }).error
          );
        }
        break;
      }
      case 'albaranes': {
        const r = await runTool('listar_albaranes', {});
        const items = extraerItems(r);
        if (items) datosNorm = items;
        else if (r && typeof r === 'object' && 'error' in r) {
          console.error(
            '[agente] mostrar_vista_visual fallback albaranes:',
            (r as { error: string }).error
          );
        }
        break;
      }
      case 'clientes': {
        const bidC = businessId;
        if (bidC) {
          const { data: clist, error: errCl } = await supabase
            .from('clientes')
            .select('id, nombre, telefono, email')
            .eq('business_id', bidC)
            .order('nombre', { ascending: true })
            .limit(50);
          if (errCl) {
            console.error('[agente] mostrar_vista_visual fallback clientes:', errCl);
          } else {
            const rowsC = clist ?? [];
            const idsC = rowsC.map((row: { id: string }) => row.id);
            if (idsC.length === 0) {
              datosNorm = [];
            } else {
              const [pC, fC, aC] = await Promise.all([
                supabase
                  .from('presupuestos')
                  .select('cliente_id')
                  .eq('business_id', bidC)
                  .in('cliente_id', idsC),
                supabase
                  .from('facturas')
                  .select('cliente_id')
                  .eq('business_id', bidC)
                  .in('cliente_id', idsC),
                supabase
                  .from('albaranes')
                  .select('cliente_id')
                  .eq('business_id', bidC)
                  .in('cliente_id', idsC),
              ]);
              const cnt = (rows: { cliente_id: string | null }[] | null) => {
                const m = new Map<string, number>();
                for (const id0 of idsC) m.set(id0, 0);
                for (const row of rows ?? []) {
                  const cid = row.cliente_id;
                  if (!cid) continue;
                  m.set(cid, (m.get(cid) ?? 0) + 1);
                }
                return m;
              };
              const mPc = cnt(pC.data as { cliente_id: string | null }[] | null);
              const mFc = cnt(fC.data as { cliente_id: string | null }[] | null);
              const mAc = cnt(aC.data as { cliente_id: string | null }[] | null);
              datosNorm = rowsC.map(
                (row: {
                  id: string;
                  nombre: string;
                  telefono: string | null;
                  email: string | null;
                }) => ({
                  id: row.id,
                  nombre: row.nombre,
                  telefono: row.telefono,
                  email: row.email,
                  num_documentos:
                    (mPc.get(row.id) ?? 0) + (mFc.get(row.id) ?? 0) + (mAc.get(row.id) ?? 0),
                })
              );
            }
          }
        }
        break;
      }
      case 'emails': {
        const r = await runTool('leer_emails_recientes', {});
        const items = extraerItems(r);
        if (items) datosNorm = items;
        else if (r && typeof r === 'object' && 'error' in r) {
          console.error(
            '[agente] mostrar_vista_visual fallback emails:',
            (r as { error: string }).error
          );
        }
        break;
      }
      case 'gastos': {
        const bid = businessId;
        if (!bid) break;
        const { data, error } = await supabase
          .from('gastos')
          .select('id, proveedor, importe, iva, importe_total, fecha, descripcion')
          .eq('business_id', bid)
          .order('fecha', { ascending: false })
          .limit(10);
        if (error) {
          console.error('[agente] mostrar_vista_visual fallback gastos:', error);
        } else {
          datosNorm = data ?? [];
        }
        break;
      }
      case 'diario': {
        const bid = businessId;
        if (!bid) break;
        const { data, error } = await supabase
          .from('diario_obra')
          .select('id, obra_nombre, obra_direccion, texto, fotos, videos, fecha, created_at')
          .eq('business_id', bid)
          .order('fecha', { ascending: false })
          .limit(10);
        if (error) {
          console.error('[agente] mostrar_vista_visual fallback diario:', error);
        } else {
          datosNorm = data ?? [];
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    accion: 'abrir_canvas',
    tipo: tipoRaw,
    titulo,
    datos: datosNorm,
  };
}
