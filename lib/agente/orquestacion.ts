import type OpenAI from 'openai';
import type { PlannedTool } from '@/lib/agente/guardrails';

/** Completion del agente con tools: determinista (anti-alucinación). */
export const AGENTE_TOOLS_TEMPERATURE = 0;

/** Respuesta final de prosa al usuario. */
export const AGENTE_PROSA_TEMPERATURE = 0.7;

export type PlanFuente = 'tool_calls_nativos' | 'reintento_required' | 'ninguno';

const SOLO_SALUDO =
  /^(hola|buenas(?:\s+(d[ií]as|tardes|noches))?|buenos\s+d[ií]as|aupa|hey|qu[eé]\s+tal|gracias(?:\s+compa)?|ok|vale|perfecto|genial|muy\s+bien|nada|nop)[\s!.?¿¡]*$/i;

const CONFIRMACION_EXPLICITA =
  /^(s[ií]|adelante|gen[eé]ralo|confirmo|confirm(?:a|ar)|hazlo|procede|dale)[\s!.]*$/i;

const VERBOS_ACCION =
  /\b(registr(?:a|ar|o)|crea(?:r)?|a[nñ]ad(?:e|ir)|agreg(?:a|ar)|list(?:a|ar)|muestr(?:a|ame)|ens(?:e|é)[nñ](?:a|ame)|busca(?:r)?|consult(?:a|ar)|elimin(?:a|ar)|borr(?:a|ar)|cambi(?:a|ar)|edit(?:a|ar)|gener(?:a|ar)|confirm(?:a|ar)|guard(?:a|ar)|anot(?:a|ar)|apunt(?:a|ar)|calcul(?:a|ar)|env[ií]a(?:r)?|lee(?:r)?|abr(?:e|ir)|convert(?:i[r]?|ir)|vincul(?:a|ar)|actualiz(?:a|ar)|marc(?:a|ar)|ficha(?:r)?|dict(?:a|ar))\w*/i;

const SENAL_DOMINIO_ACCION =
  /\b(horas|jornada|diario|partida[s]?|presupuesto[s]?|factura[s]?|albar[aá]n(?:es)?|ticket|gasto[s]?|recordatorio[s]?|agenda|operario[s]?|obra[s]?)\b/i;

/**
 * Heurística de un solo reintento: el mensaje parece pedir una acción
 * (no es solo un saludo / cortesía).
 */
export function pareceAccionQueRequiereTool(mensaje: string): boolean {
  const t = mensaje.trim();
  if (!t) return false;
  if (SOLO_SALUDO.test(t)) return false;
  if (CONFIRMACION_EXPLICITA.test(t)) return true;
  if (VERBOS_ACCION.test(t)) return true;
  return SENAL_DOMINIO_ACCION.test(t) && t.split(/\s+/).length >= 3;
}

export function plannedToolsFromAssistantToolCalls(
  toolCalls:
    | OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
    | null
    | undefined
): PlannedTool[] {
  if (!toolCalls?.length) return [];
  const out: PlannedTool[] = [];
  for (const tc of toolCalls) {
    if (tc.type !== 'function') continue;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      parsedArgs = {};
    }
    out.push({ tool: tc.function.name, args: parsedArgs });
  }
  return out;
}

export function idsParaPlanEjecutado(
  plan: PlannedTool[],
  originalCalls:
    | OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
    | null
    | undefined
): string[] {
  const used = new Set<string>();
  return plan.map((step, i) => {
    const match = originalCalls?.find(
      (tc) =>
        tc.type === 'function' && tc.function.name === step.tool && !used.has(tc.id)
    );
    if (match && match.type === 'function') {
      used.add(match.id);
      return match.id;
    }
    return `call_${i}`;
  });
}

const CAMPOS_SENSIBLES =
  /^(access_token|refresh_token|password|secret|api_key|authorization|cuerpo|body|token)$/i;

/** Resumen de resultado de tool para logs (sin secretos ni cuerpos largos). */
export function resumirToolResultParaLog(result: unknown): unknown {
  if (result == null) return null;
  if (typeof result !== 'object') {
    const s = String(result);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  }
  if (Array.isArray(result)) return { items: result.length };
  const o = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ('error' in o) out.error = o.error;
  if ('ok' in o) out.ok = o.ok;
  if ('id' in o) out.id = o.id;
  if (typeof o.mensaje === 'string') {
    out.mensaje = o.mensaje.length > 160 ? `${o.mensaje.slice(0, 160)}…` : o.mensaje;
  }
  if (Array.isArray(o.items)) out.items = o.items.length;
  for (const [k, v] of Object.entries(o)) {
    if (CAMPOS_SENSIBLES.test(k)) continue;
    if (k in out) continue;
    if (typeof v === 'string' && v.length > 80) continue;
    if (k === 'tipo' || k === 'accion' || k === 'existente') out[k] = v;
  }
  return out;
}

export type AgenteTurnoLog = {
  evento: 'agente_turno';
  intent: string;
  tools_pedidas: string[];
  plan: {
    fuente: PlanFuente;
    ejecutado: string[];
  };
  result: {
    n: number;
    resumen: Array<{ tool: string; result: unknown }>;
  };
};

export function logAgenteTurno(payload: AgenteTurnoLog): void {
  console.info('[agente]', JSON.stringify(payload));
}

const PREFIJO_MUTACION =
  /^(crear_|actualizar_|modificar_|guardar_|registrar_|confirmar_|convertir_|agregar_|editar_|vincular_|asociar_|cambiar_estado_|eliminar_|borrar_|iniciar_)/;

export function esToolMutacion(name: string): boolean {
  return PREFIJO_MUTACION.test(String(name ?? ''));
}

export function esResultadoToolExito(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  if (o.ok === true) return true;
  if (o.ok === false) return false;
  if (typeof o.error === 'string' && o.error.trim()) return false;
  if (o.necesita_aclaracion === true) return false;
  if (o.pendiente_precio === true || o.pendiente_confirmacion === true) return false;
  return true;
}

export function esResultadoToolFallo(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  if (o.ok === false) return true;
  if (typeof o.error === 'string' && o.error.trim()) return true;
  return false;
}

export function esResultadoToolPendiente(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  return o.pendiente_precio === true || o.pendiente_confirmacion === true || o.necesita_aclaracion === true;
}

export type HechoMutacion = { tool: string; result: unknown };

export type HechosMutacion = {
  exitos: HechoMutacion[];
  fallos: HechoMutacion[];
  pendientes: HechoMutacion[];
};

export function hechosMutacionDesdeEjecutado(
  executed: Array<{ tool: string; result: unknown }>
): HechosMutacion {
  const exitos: HechoMutacion[] = [];
  const fallos: HechoMutacion[] = [];
  const pendientes: HechoMutacion[] = [];
  for (const e of executed) {
    if (!esToolMutacion(e.tool)) continue;
    if (esResultadoToolExito(e.result)) exitos.push({ tool: e.tool, result: e.result });
    else if (esResultadoToolPendiente(e.result)) pendientes.push({ tool: e.tool, result: e.result });
    else if (esResultadoToolFallo(e.result)) fallos.push({ tool: e.tool, result: e.result });
  }
  return { exitos, fallos, pendientes };
}

function errorDeResultado(result: unknown): string {
  if (result != null && typeof result === 'object' && !Array.isArray(result)) {
    const o = result as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
    if (typeof o.mensaje === 'string' && o.mensaje.trim()) return o.mensaje.trim();
  }
  return 'No se pudo completar la acción.';
}

export function prosaFailClosedDesdeHechos(hechos: HechosMutacion): string {
  const partes = hechos.fallos.map((f) => errorDeResultado(f.result));
  const unico = [...new Set(partes.filter(Boolean))];
  if (unico.length === 0) {
    return 'No he encontrado ese cliente ni ese presupuesto. No he añadido ninguna partida ni he creado ficha ni presupuesto.';
  }
  return unico.join('\n');
}

/** Si todas las mutaciones fallaron (y no hay pendientes), la prosa no pasa por el modelo. */
export function prosaFailClosedSiAplica(hechos: HechosMutacion): string | null {
  if (hechos.fallos.length === 0) return null;
  if (hechos.exitos.length > 0) return null;
  if (hechos.pendientes.length > 0) return null;
  return prosaFailClosedDesdeHechos(hechos);
}

/** Fail-closed o pregunta de aclaración: no dejar que el modelo invente éxito. */
export function prosaAncladaDirectaSiAplica(hechos: HechosMutacion): string | null {
  const fail = prosaFailClosedSiAplica(hechos);
  if (fail) return fail;
  if (hechos.exitos.length > 0) return null;
  if (hechos.pendientes.length === 0) return null;
  const partes = hechos.pendientes.map((p) => errorDeResultado(p.result));
  const unico = [...new Set(partes.filter(Boolean))];
  return unico.length > 0 ? unico.join('\n') : null;
}

export function buildMensajeSistemaProsaAnclada(hechos: HechosMutacion): string {
  const exitos = hechos.exitos.map((e) => ({
    tool: e.tool,
    ok: true,
    resumen: resumirToolResultParaLog(e.result),
  }));
  const fallos = hechos.fallos.map((e) => ({
    tool: e.tool,
    ok: false,
    error: errorDeResultado(e.result),
  }));
  return `ANCLAJE DE PROSA (obligatorio):
Solo puedes afirmar mutaciones que estén en ÉXITOS (ok:true). Si una tool falló o no encontró la entidad, dilo en castellano. PROHIBIDO narrar que has añadido, creado, editado o vinculado nada que no aparezca en ÉXITOS. No inventes IDs, clientes, obras ni presupuestos.
ÉXITOS: ${JSON.stringify(exitos)}
FALLOS: ${JSON.stringify(fallos)}`;
}

const RE_EXITO_INVENTADO =
  /\b(a[nñ]adid[oa]|he a[nñ]adido|partida a[nñ]adida|presupuesto creado|cliente creado|listo[,:]?\s+a[nñ]ad)/i;

/**
 * Red de seguridad: si el modelo afirma éxito y no hay mutación ok:true, sustituye por fail-closed.
 */
export function anclarProsaAHechos(prosaModelo: string, hechos: HechosMutacion): string {
  const t = String(prosaModelo ?? '').trim();
  const fail = prosaFailClosedSiAplica(hechos);
  if (fail) return fail;
  if (hechos.exitos.length === 0 && RE_EXITO_INVENTADO.test(t)) {
    return (
      prosaFailClosedDesdeHechos(hechos) ||
      'No he podido confirmar esa acción en el sistema. No he añadido ni creado nada.'
    );
  }
  return t || prosaModelo;
}

export function buildToolLoopMessages(
  baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  executed: Array<{
    id: string;
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
    executed.map((e) => ({
      id: e.id,
      type: 'function',
      function: {
        name: e.tool,
        arguments: JSON.stringify(e.args),
      },
    }));

  return [
    ...baseMessages,
    {
      role: 'assistant',
      content: null,
      tool_calls: assistantToolCalls,
    },
    ...executed.map((e) => ({
      role: 'tool' as const,
      tool_call_id: e.id,
      content: JSON.stringify(e.result),
    })),
  ];
}
