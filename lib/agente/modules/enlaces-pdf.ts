import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerEnlacePdfFactura } from '@/lib/mcp/facturas';
import { obtenerEnlacePdfPresupuesto } from '@/lib/presupuestos/enlace-pdf';
import { failClosed, parseNumeroDocumento } from '@/lib/agente/modules/grounding';
import type { McpContext } from '@/lib/mcp/context';

/**
 * Enlaces firmados a los PDF de facturas y presupuestos para el agente interno.
 * No duplican la lógica: reutilizan las funciones del MCP (`obtenerEnlacePdfFactura`,
 * `obtenerEnlacePdfPresupuesto`), que esperan un `McpContext` = { supabase, businessId, userId }.
 */
export const ENLACES_PDF_HANDLED_TOOLS = new Set(['obtener_enlace_pdf_factura', 'obtener_enlace_pdf_presupuesto']);

const parametros = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID del documento (si se conoce por una consulta previa)' },
    numero: { type: 'integer', description: 'Número del documento (nº de factura / nº de presupuesto)' },
    dias_validez: { type: 'integer', description: 'Días que dura el enlace (1 a 30, por defecto 7)' },
  },
  additionalProperties: false,
} as const;

export const ENLACES_PDF_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'obtener_enlace_pdf_factura',
      description:
        'Devuelve un enlace temporal para descargar el PDF de una factura (para enseñárselo o mandárselo al cliente). Pasa id o numero (nº de factura). Solo lectura: no crea ni cambia nada.',
      parameters: parametros,
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_enlace_pdf_presupuesto',
      description:
        'Devuelve un enlace temporal para descargar el PDF de un presupuesto (también en borrador: entonces avisa de que es un borrador). Pasa id o numero (nº de presupuesto). Solo lectura.',
      parameters: parametros,
    },
  },
];

type ResultadoEnlace = { ok: boolean; error?: string; url?: string; [k: string]: unknown };

export async function handleEnlacesPdf(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  const ctx: McpContext = { supabase, businessId, userId: userId ?? 'agente' };
  const args: Record<string, unknown> = {};
  if (toolArgs.id != null) args.id = toolArgs.id;
  if (toolArgs.numero != null) args.numero = parseNumeroDocumento(toolArgs.numero) ?? toolArgs.numero;
  if (toolArgs.dias_validez != null) args.dias_validez = toolArgs.dias_validez;

  const r = (toolName === 'obtener_enlace_pdf_factura'
    ? await obtenerEnlacePdfFactura(ctx, args)
    : await obtenerEnlacePdfPresupuesto(ctx, args, new Date(), { permitirBorrador: true })) as ResultadoEnlace;

  if (!r.ok) return failClosed(String(r.error ?? 'No se pudo generar el enlace al PDF.'));
  const tipo = toolName === 'obtener_enlace_pdf_factura' ? 'factura' : 'presupuesto';
  const numero = (r.numero_factura ?? r.numero_presupuesto) as number | null | undefined;
  // El enlace va en Markdown para que el panel lo pinte como enlace clicable.
  return {
    ...r,
    ok: true,
    mensaje:
      `[Descargar PDF de la ${tipo}${numero != null ? ` nº ${numero}` : ''}](${r.url}) (el enlace caduca en ${r.dias_validez} días).` +
      (r.borrador ? ' ⚠️ Es un BORRADOR: el presupuesto aún no está confirmado, el PDF no es definitivo.' : ''),
  };
}
