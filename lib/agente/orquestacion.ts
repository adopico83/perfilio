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
