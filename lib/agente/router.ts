import type OpenAI from 'openai';
import { DIARIO_HANDLED_TOOLS } from '@/lib/agente/modules/diario';
import { PRESUPUESTOS_HANDLED_TOOLS } from '@/lib/agente/modules/presupuestos';
import { pareceConsultaListadoObras } from '@/lib/agente/modules/grounding';

export type AgentIntentCategory =
  | 'documentos'
  | 'emails'
  | 'agenda'
  | 'gastos'
  | 'diario'
  | 'clientes'
  | 'calculo'
  | 'operarios'
  | 'presupuesto'
  | 'general';

/** Categorías cerradas que Jev puede elegir. No genera texto. */
export const JEV_INTENT_CATEGORIES = [
  'presupuesto',
  'factura',
  'diario',
  'horas',
  'gastos',
  'obras',
  'clientes',
  'correo',
  'agenda',
  'general',
] as const;

export type JevIntentCategory = (typeof JEV_INTENT_CATEGORIES)[number];

/**
 * Jev habla el vocabulario de producto. El orquestador sigue filtrando tools
 * con las categorías internas que ya existían.
 */
export const JEV_TO_AGENT_INTENT: Record<JevIntentCategory, AgentIntentCategory> = {
  presupuesto: 'presupuesto',
  factura: 'documentos',
  diario: 'diario',
  horas: 'operarios',
  gastos: 'gastos',
  obras: 'documentos',
  clientes: 'clientes',
  correo: 'emails',
  agenda: 'agenda',
  general: 'general',
};

export const JEV_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_INTENT_MODEL = 'jev-latest';
/** Por debajo de este umbral (o si Jev no responde) el agente usa la categoría segura. */
export const JEV_INTENT_CONFIDENCE_MIN = 0.7;
const JEV_INTENT_TIMEOUT_MS = 2000;

const JEV_INTENT_CRITERIA: Record<JevIntentCategory, string> = {
  presupuesto:
    'Presupuesto, partidas, borrador, confirmar o cancelar un presupuesto, importes por partida. No horas, diario ni listar obras.',
  factura: 'Facturas o albaranes: listar, estados, editar, crear o convertir entre albarán y factura.',
  diario: 'Diario de obra, anotaciones, incidencias o foto de registro en obra. No un ticket de compra.',
  horas: 'Horas de operarios, jornada, fichar, parte de horas o control de horas en obra.',
  gastos: 'Ticket, gasto, foto de compra, registrar, modificar o vincular un gasto.',
  obras:
    'Obras del negocio: listar abiertas, crear, ficha, actualizar o asociar documentos a una obra. No es un presupuesto.',
  clientes: 'Ficha, búsqueda o historial de un cliente. No crear una obra.',
  correo: 'Correo electrónico: leer la bandeja o enviar un email.',
  agenda: 'Recordatorios, citas, calendario o el tiempo meteorológico para una visita.',
  general: 'Saludo, cálculo de medidas, memoria del negocio, varias áreas a la vez o petición ambigua.',
};

export type AgentIntentRouterContext = {
  borradorActivo?: boolean;
  ultimoAsistente?: string;
};

export const INTENT_TOOL_NAMES_DOCUMENTOS = new Set([
  'obtener_facturas_pendientes',
  'obtener_albaranes_pendientes',
  'listar_facturas',
  'listar_albaranes',
  'cambiar_estado_factura',
  'cambiar_estado_albaran',
  'editar_factura',
  'editar_albaran',
  'generar_presupuesto_por_dictado',
  'gestionar_tarifas',
  'crear_presupuesto',
  'crear_factura',
  'crear_albaran',
  'crear_obra',
  'actualizar_obra',
  'buscar_obra',
  'ver_ficha_obra',
  'asociar_documentos_a_obra',
  'convertir_albaran_a_factura',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
  'albaranes_sin_facturar',
  'consultar_tiempo',
  'registrar_extra',
  'listar_extras',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_EMAILS = new Set([
  'leer_emails_recientes',
  'enviar_email',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_AGENDA = new Set([
  'obtener_agenda',
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
  'buscar_cliente',
  'buscar_obra',
  'crear_cliente',
  'ver_cliente',
  'ver_ficha_obra',
  'get_directions',
  'consultar_tiempo',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_GASTOS = new Set([
  'registrar_gasto_ticket',
  'vincular_gasto',
  'eliminar_gasto',
  'modificar_gasto',
  'listar_facturas',
  'listar_albaranes',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_DIARIO = new Set([
  ...DIARIO_HANDLED_TOOLS,
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_CLIENTES = new Set([
  'crear_cliente',
  'buscar_cliente',
  'ver_cliente',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_CALCULO = new Set([
  'calcular_medicion',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_OPERARIOS = new Set([
  'registrar_jornada',
  'listar_operarios',
  'consultar_horas_obra',
  'consultar_horas_operario',
  'eliminar_registro_jornada',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

export const INTENT_TOOL_NAMES_PRESUPUESTO = new Set([
  ...PRESUPUESTOS_HANDLED_TOOLS,
  'generar_presupuesto_por_dictado',
  'buscar_cliente',
  'ver_cliente',
  'buscar_obra',
  'ver_ficha_obra',
  'mostrar_vista_visual',
  'get_directions',
  'guardar_memoria',
  'eliminar_memoria',
]);

/** Señales que el clasificador no debe pisar (p. ej. listar obras ≠ presupuesto). */
export function intentPorSenalExplicita(mensaje: string): AgentIntentCategory | null {
  if (pareceConsultaListadoObras(mensaje)) return 'documentos';
  return null;
}

/** Prefijo del system prompt de presupuesto (route); el cuerpo viene de presupuestos.ts */
export const PRESUPUESTOS_AGENT_SYSTEM_PROMPT_PREFIX = `REGLA CRÍTICA — DICTADO COMPLETO:
Si el mensaje del usuario contiene múltiples partidas o trabajos descritos de golpe (con o sin precios), DEBES usar generar_presupuesto_por_dictado con TODO el texto como dictado. NO uses iniciar_borrador_presupuesto ni agregar_partida_borrador en ese caso.
Solo usa el flujo borrador conversacional (iniciar_borrador + agregar_partida) cuando el usuario añade partidas de una en una interactivamente Y ya hay un borrador activo con partidas guardadas.

`;

export const INTENT_TOOL_NAMES: Record<AgentIntentCategory, Set<string> | null> = {
  documentos: INTENT_TOOL_NAMES_DOCUMENTOS,
  emails: INTENT_TOOL_NAMES_EMAILS,
  agenda: INTENT_TOOL_NAMES_AGENDA,
  gastos: INTENT_TOOL_NAMES_GASTOS,
  diario: INTENT_TOOL_NAMES_DIARIO,
  clientes: INTENT_TOOL_NAMES_CLIENTES,
  calculo: INTENT_TOOL_NAMES_CALCULO,
  operarios: INTENT_TOOL_NAMES_OPERARIOS,
  presupuesto: INTENT_TOOL_NAMES_PRESUPUESTO,
  general: null,
};

export function mapJevChoiceToAgentIntent(choice: unknown, confidence: unknown): AgentIntentCategory {
  const score = typeof confidence === 'number' ? confidence : Number.NaN;
  if (!(score >= JEV_INTENT_CONFIDENCE_MIN)) return 'general';
  const key = String(choice ?? '').trim().toLowerCase();
  if (!(JEV_INTENT_CATEGORIES as readonly string[]).includes(key)) return 'general';
  return JEV_TO_AGENT_INTENT[key as JevIntentCategory];
}

/** Estado corto: el mensaje y, si el turno ya lo conoce, borrador activo y último asistente. */
export function buildJevIntentState(mensaje: string, context?: AgentIntentRouterContext): string {
  const texto = mensaje.trim() || '(sin texto)';
  const parts = [`Mensaje del usuario:\n${texto}`];
  if (context?.borradorActivo) {
    parts.push(
      'Contexto: hay un borrador de presupuesto en construcción. Sesga a presupuesto solo si el mensaje es ambiguo o sigue ese hilo. No lo hagas si habla de horas, diario de obra o de listar obras.'
    );
  }
  const ultimo = context?.ultimoAsistente?.trim();
  if (ultimo) {
    parts.push(`Último mensaje del asistente:\n${ultimo.slice(0, 500)}`);
  }
  return parts.join('\n\n');
}

type JevChoiceAnswer = {
  type?: string;
  choice?: unknown;
  confidence?: unknown;
};

/**
 * Clasifica el mensaje con TypeSafe Jev (question `choice`).
 * Fail-closed: sin key, red, HTTP o confidence < 0.7 → `general`.
 */
export async function parseAgentIntentCategory(
  mensaje: string,
  context?: AgentIntentRouterContext
): Promise<AgentIntentCategory> {
  const apiKey = process.env.JEV_API_KEY?.trim() ?? '';
  if (!apiKey) return 'general';

  try {
    const res = await fetch(JEV_SYSTEMONE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JEV_INTENT_MODEL,
        state: buildJevIntentState(mensaje, context),
        questions: {
          intent: {
            type: 'choice',
            instructions:
              'Elige la única categoría del mensaje de un encargado de obra. Usa solo una de las opciones.',
            criteria: JEV_INTENT_CRITERIA,
          },
        },
      }),
      signal: AbortSignal.timeout(JEV_INTENT_TIMEOUT_MS),
    });
    if (!res.ok) return 'general';
    const data = (await res.json()) as { answers?: { intent?: JevChoiceAnswer } };
    const answer = data.answers?.intent;
    if (!answer || answer.type !== 'choice') return 'general';
    return mapJevChoiceToAgentIntent(answer.choice, answer.confidence);
  } catch {
    return 'general';
  }
}

export function toolsForAgentIntent(
  cat: AgentIntentCategory,
  all: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const names = INTENT_TOOL_NAMES[cat];
  if (!names) return all;
  return all.filter((t) => t.type === 'function' && names.has(t.function.name));
}
