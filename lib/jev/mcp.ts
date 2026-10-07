/**
 * Puente del MCP (Grok Bot) con el ejecutor .jev: las herramientas de ESCRITURA del MCP construyen la misma
 * orden que saldría del chat y pasan por el mismo camino: validar y resolver (ejecutor) → orden pendiente →
 * confirmar → ejecutar con los mismos handlers que el chat. En el MCP quien llama ya ha confirmado con el
 * usuario (lo dicen las descripciones de las tools), así que la orden pendiente se confirma en el acto, en
 * memoria: no hay botón, pero sí las mismas validaciones y exactamente la misma escritura.
 */
import type { McpContext } from '@/lib/mcp/context';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { prepararOrden, type CtxEjecutor } from '@/lib/jev/ejecutor';
import { crearRunToolJev } from '@/lib/jev/despacho';

export type ResultadoMcp =
  | { ok: true; tool: string; resultado: Record<string, unknown>; resumen: string }
  | { ok: false; error: string; opciones?: Array<{ id: string; etiqueta: string }> };

export async function ejecutarOrdenMcp(
  orden: OrdenJev,
  ctx: McpContext,
  opciones: {
    /** Lo que «dijo» el usuario (para comprobar que los importes aparecen en el texto). */
    mensajes: string[];
    ahora?: Date;
    /** Entidades ya resueltas por la herramienta del MCP (id comprobado contra el negocio). */
    resueltos?: CtxEjecutor['resueltos'];
    descripcionCita?: string;
    fotosAdjuntas?: string[];
  }
): Promise<ResultadoMcp> {
  const runTool = crearRunToolJev({ supabase: ctx.supabase, businessId: ctx.businessId, userId: ctx.userId });
  const r = await prepararOrden(orden, {
    supabase: ctx.supabase,
    businessId: ctx.businessId,
    userId: ctx.userId,
    ahora: opciones.ahora ?? new Date(),
    mensajes: opciones.mensajes,
    resueltos: { ...(opciones.resueltos ?? {}) },
    descripcionCita: opciones.descripcionCita,
    modoMcp: true,
    fotosAdjuntas: opciones.fotosAdjuntas,
    runTool,
  });
  if (r.tipo === 'pendiente') {
    // «Confirmar» la orden pendiente: se ejecuta EXACTAMENTE la acción cerrada que devolvió el ejecutor.
    const resultado = (await runTool(r.accion.tool, r.accion.args)) as Record<string, unknown>;
    if (typeof resultado.error === 'string' || resultado.ok === false) {
      return { ok: false, error: String(resultado.error ?? resultado.mensaje ?? 'No se pudo guardar') };
    }
    return { ok: true, tool: r.accion.tool, resultado, resumen: r.resumen };
  }
  if (r.tipo === 'pregunta') return { ok: false, error: r.texto, opciones: r.opciones };
  if (r.tipo === 'error') return { ok: false, error: r.texto };
  return { ok: true, tool: 'consulta', resultado: r.extra ?? {}, resumen: r.texto };
}
