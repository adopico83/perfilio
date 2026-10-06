/**
 * Modelo de OpenAI que usa el agente interno.
 *
 * Se puede cambiar SIN tocar código poniendo la variable de entorno `AGENTE_MODELO`
 * (p. ej. `gpt-4.1-mini` o `gpt-5-mini`). Sin variable, `gpt-4o-mini` (el de siempre).
 *
 * Solo lo usan las tres llamadas del turno del agente (`app/api/agente/route.ts`). Las dos tareas
 * pequeñas auxiliares (`elegirTarifaConGpt` y `lib/dictado-presupuesto.ts`) siguen con
 * `AGENTE_MODELO_POR_DEFECTO` a propósito: son tareas acotadas que no ganan nada con un modelo más
 * caro y así subir el modelo del agente no multiplica el coste de cada partida dictada.
 */
export const AGENTE_MODELO_POR_DEFECTO = 'gpt-4o-mini';

export function modeloAgente(): string {
  return process.env.AGENTE_MODELO?.trim() || AGENTE_MODELO_POR_DEFECTO;
}

/**
 * Los modelos de razonamiento (familia `o*` y `gpt-5*`) no admiten `temperature` distinta de la
 * suya por defecto: si se manda, la API devuelve error.
 */
export function modeloAdmiteTemperature(modelo: string): boolean {
  const m = modelo.trim().toLowerCase();
  return !(/^o\d/.test(m) || m.startsWith('gpt-5'));
}

/**
 * Parámetros de generación compatibles con cualquier modelo:
 * - `max_completion_tokens` en vez de `max_tokens` (los modelos nuevos rechazan `max_tokens`;
 *   el SDK `openai` 6.x admite el nuevo nombre en los modelos antiguos también).
 * - `temperature` solo si el modelo la admite.
 */
export function parametrosGeneracion(
  modelo: string,
  opciones: { maxTokens: number; temperature?: number }
): { max_completion_tokens: number; temperature?: number } {
  const base = { max_completion_tokens: opciones.maxTokens };
  if (opciones.temperature === undefined || !modeloAdmiteTemperature(modelo)) return base;
  return { ...base, temperature: opciones.temperature };
}
