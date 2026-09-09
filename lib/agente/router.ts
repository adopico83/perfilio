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

export const ROUTER_SYSTEM_PROMPT = `Eres un clasificador de intención (una sola categoría de salida).

PRIORIDAD DE SEÑALES EXPLÍCITAS (aplica la primera categoría coherente; no mezcles con otras salvo ambigüedad real):
- operarios: registrar o consultar horas de trabajo en obra, control de horas, horas de obra, horas de operarios, parte de horas, fichar jornada, convenio vs horas reales, "cuántas horas llevamos", etc. Incluye frases típicas: "registrar horas", "horas de obra", "control de horas", "jornada" (en sentido laboral en obra).
- diario: diario de obra, anotar en obra, incidencias o apuntes del día en obra, entrada del diario, "foto de obra" como registro de obra (no ticket de compra), PDF del diario, texto del diario. Incluye: "diario de obra", "anotar en obra", "foto de obra" (contexto obra).
- documentos: listar o consultar obras del negocio («qué obras tengo abiertas», obras en curso, obras activas, listar obras). NO es presupuesto ni clientes: no inicies un borrador. Usa buscar_obra.
- presupuesto: presupuesto, partidas, líneas del presupuesto, "añadir al presupuesto", importes por partida, listar o editar presupuestos, pendientes de presupuesto, cambiar estado de presupuesto, convertir presupuesto a albarán, confirmar o cancelar borrador de presupuesto, obtener borrador activo, presupuesto por voz cuando el foco es el importe/partidas (no confundir con horas, diario ni con listar obras abiertas).

Borrador de presupuesto en construcción (si el sistema te avisa de que existe):
- Solo debe sesgar hacia presupuesto cuando el mensaje sea ambiguo, muy corto sin tema claro, o siga claramente el hilo del presupuesto (partidas, importes, confirmaciones del borrador).
- NUNCA fuerces presupuesto por tener borrador activo si el usuario habla de horas/jornada/operarios, de diario de obra/fotos/anotaciones en obra, o de listar/consultar obras abiertas («qué obras tengo»): en esos casos la salida es operarios, diario o documentos.
- "cancelar presupuesto" o "salir del presupuesto" → presupuesto (gestión del flujo de presupuesto).

Mensajes muy cortos (sí, no, vale, ok, adelante, genial, perfecto, etc.):
- Debes basarte en el ÚLTIMO mensaje del asistente que recibes en el historial inmediato antes del mensaje del usuario. Si el asistente preguntaba por horas u operarios → operarios; si por diario/fotos/anotación en obra → diario; si por presupuesto, partidas o confirmación del borrador → presupuesto. Si no hay pista clara, entonces aplica la regla del borrador activo solo si aplica como mensaje ambiguo.

Responde SOLO con una palabra en minúsculas, sin comillas ni puntuación:
documentos | emails | agenda | gastos | diario | clientes | calculo | operarios | presupuesto | general

documentos: listar u consultar obras abiertas/en curso (buscar_obra), crear obra con cliente nuevo o existente (crear_obra + crear_cliente + actualizar_obra), facturas, albaranes, vincular documentos a una obra (asociar_documentos_a_obra), crear o actualizar obra (crear_obra, actualizar_obra), extras/modificados/imprevistos en obra, dictado de visita y presupuesto estructurado (generar_presupuesto_por_dictado, gestionar_tarifas), crear presupuesto ya redactado (crear_presupuesto), estados de facturas/albaranes, edición de facturas/albaranes, conversiones albarán↔factura, tiempo en obra.
presupuesto: ya detallado arriba cuando el foco es presupuesto/partidas/borrador de presupuesto (no operarios ni diario).
emails: Gmail, leer bandeja, enviar correo.
agenda: recordatorios, citas, eventos en calendario, tiempo meteorológico para obras o citas.
gastos: ticket, OCR, foto de compra, registrar gasto, vincular gasto.
diario: ya detallado arriba (diario de obra y registro en obra).
clientes: consultar ficha de cliente, buscar cliente, historial de cliente. NO usar para crear obras ni clientes nuevos.
calculo: metros cuadrados, m³, perímetro, dimensiones de obra.
operarios: ya detallado arriba (horas y jornada en obra).
general: saludos, varias áreas a la vez, mensajes pendientes del negocio, meteorología o tiempo, extras o imprevistos en obra (registrar_extra), vincular documentos a una obra, actualizar datos de obra (cliente, dirección, estado, actualizar_obra), memoria del negocio (guardar_memoria, eliminar_memoria), o petición ambigua sin encaje claro.`;

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

/** Sesgo de borrador activo: no pisa listados de obras ni horas/diario. */
export const ROUTER_BORRADOR_ACTIVO_PREFIX = `CONTEXTO: Hay un borrador de presupuesto en construcción (estado en_construccion). Úsalo solo como sesgo hacia intención presupuesto cuando el mensaje del usuario sea ambiguo o siga claramente el hilo del presupuesto/partidas/confirmación del borrador. NO fuerces presupuesto si el mensaje trata de horas de operarios, jornada, control de horas, diario de obra, anotaciones en obra, fotos de obra en sentido de registro de obra, ni de listar o consultar obras abiertas/en curso («qué obras tengo»): en esos casos clasifica operarios, diario o documentos.

`;

/** Señales que el LLM no debe pisar (p. ej. listar obras ≠ presupuesto). */
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

export function parseAgentIntentCategory(raw: string): AgentIntentCategory {
  const allowed: AgentIntentCategory[] = [
    'documentos',
    'emails',
    'agenda',
    'gastos',
    'diario',
    'clientes',
    'calculo',
    'operarios',
    'presupuesto',
    'general',
  ];
  const trimmed = raw.trim().toLowerCase();
  const first = trimmed.split(/[\s,.;]+/)[0] ?? '';
  if (allowed.includes(first as AgentIntentCategory)) {
    return first as AgentIntentCategory;
  }
  for (const c of allowed) {
    if (trimmed.includes(c)) return c;
  }
  return 'general';
}

export function toolsForAgentIntent(
  cat: AgentIntentCategory,
  all: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const names = INTENT_TOOL_NAMES[cat];
  if (!names) return all;
  return all.filter((t) => t.type === 'function' && names.has(t.function.name));
}
