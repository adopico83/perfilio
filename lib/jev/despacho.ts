/**
 * Despacho de las herramientas que usa el ejecutor .jev, SIN contexto de chat (sin fotos adjuntas). Lo usan los
 * tests y las herramientas de escritura del MCP, para que el chat y el MCP ejecuten lo mismo con los mismos
 * handlers (`lib/agente/modules/*`).
 */
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENDA_HANDLED_TOOLS, handleAgenda } from '@/lib/agente/modules/agenda';
import { DIARIO_HANDLED_TOOLS, handleDiario } from '@/lib/agente/modules/diario';
import { DOCUMENTOS_HANDLED_TOOLS, handleDocumentosAgent } from '@/lib/agente/modules/documentos';
import { ENLACES_PDF_HANDLED_TOOLS, handleEnlacesPdf } from '@/lib/agente/modules/enlaces-pdf';
import { GASTOS_HANDLED_TOOLS, handleGastosAgent } from '@/lib/agente/modules/gastos';
import { OBRAS_CLIENTES_HANDLED_TOOLS, handleObrasClientesAgent } from '@/lib/agente/modules/obras-clientes';
import { ejecutarRegistrarJornada } from '@/lib/agente/modules/operarios';
import { PRESUPUESTOS_HANDLED_TOOLS, handlePresupuestos } from '@/lib/agente/modules/presupuestos';

export function crearRunToolJev(p: {
  supabase: SupabaseClient;
  businessId: string;
  userId: string | null;
  openai?: OpenAI;
}): (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> {
  const { supabase, businessId, userId } = p;
  const openai = (p.openai ?? {}) as OpenAI;
  // Las órdenes .jev ya vienen resueltas: los handlers no deducen nada del mensaje.
  const ctx = { mensajeTrim: '', mensaje: '' };
  return async (tool, args) => {
    if (tool === 'registrar_jornada') return ejecutarRegistrarJornada(supabase, businessId, args, '');
    if (PRESUPUESTOS_HANDLED_TOOLS.has(tool)) return handlePresupuestos(tool, args, businessId, userId, supabase, openai, ctx);
    if (DIARIO_HANDLED_TOOLS.has(tool)) return handleDiario(tool, args, businessId, userId, supabase, openai, ctx);
    if (AGENDA_HANDLED_TOOLS.has(tool)) return handleAgenda(tool, args, businessId, userId, supabase, openai, ctx);
    if (GASTOS_HANDLED_TOOLS.has(tool)) return handleGastosAgent(tool, args, businessId, userId, supabase, openai, ctx);
    if (OBRAS_CLIENTES_HANDLED_TOOLS.has(tool)) return handleObrasClientesAgent(tool, args, businessId, userId, supabase);
    if (DOCUMENTOS_HANDLED_TOOLS.has(tool)) return handleDocumentosAgent(tool, args, businessId, userId, supabase, openai, ctx);
    if (ENLACES_PDF_HANDLED_TOOLS.has(tool)) return handleEnlacesPdf(tool, args, businessId, userId, supabase);
    return { ok: false, error: `Herramienta no soportada por el ejecutor .jev: ${tool}` };
  };
}
