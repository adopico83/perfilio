/**
 * Clasificador de INTENCIÓN: la IA entiende qué quiere decir el usuario ante lo que hay pendiente; el código fijo decide qué
 * se ejecuta. Un paso corto con salida estricta (enum cerrado) que corre antes de traducir el mensaje a una orden.
 *
 * Sustituye a las listas de frases y expresiones regulares de negar, confirmar y corregir (siempre hay otra forma de decirlo).
 * Regla de seguridad: solo CONFIRMA si es claro; ante la duda, otra cosa (el motor vuelve a preguntar) y NUNCA se ejecuta.
 */
import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';
import { logJev } from '@/lib/jev/log';

export const INTENCIONES = ['CONFIRMA', 'CANCELA', 'CORRIGE', 'NUEVA', 'VARIAS', 'RESPUESTA'] as const;
export type Intencion = (typeof INTENCIONES)[number];

export type EntradaIntencion = {
  mensaje: string;
  /** Resumen de la orden pendiente de confirmar (lo último que se le enseñó), si la hay. */
  resumenPendiente?: string | null;
  /** Pregunta abierta del asistente (falta un dato, elegir una opción…), si la hay. */
  preguntaAbierta?: string | null;
  /** Último mensaje del asistente (sin marcas internas). */
  ultimoAsistente?: string | null;
};

export type SalidaIntencion = { intencion: Intencion; segura: boolean };

let cliente: OpenAI | null = null;
function getOpenAI(): OpenAI {
  cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cliente;
}

export const PROMPT_INTENCION = `Eres el CLASIFICADOR de intención de Perfilio (asistente de un negocio de obras). No haces nada: lees el último mensaje del usuario y dices qué quiere hacer, con la función clasificar_intencion.
Tipos:
- CONFIRMA: acepta la orden pendiente tal cual, sin cambiar nada. Solo si es claro.
- CANCELA: no la quiere, o todavía no, o ya está hecha por otro lado, o se arrepiente; también si pide parar o esperar sin dar datos nuevos.
- CORRIGE: la quiere, pero cambia un dato de la pendiente (una cifra, un nombre, una fecha, una hora…).
- NUEVA: pide otra cosa distinta (o hace una pregunta o consulta nueva).
- VARIAS: pide dos o más cosas distintas en el mismo mensaje.
- RESPUESTA: contesta a una pregunta abierta del asistente (da el dato que faltaba, elige una opción de una lista, dice un nombre…).
Reglas:
- CONFIRMA es solo aceptar: si el mensaje pide hacer algo (aunque lleve un «sí» dentro, como contar lo que ha dicho un tercero), es NUEVA.
- Si NO hay orden pendiente ni pregunta abierta: un mensaje que solo asiente o acepta («vale», «ok») es CONFIRMA (el sistema dirá que no hay nada pendiente y no hará nada); si pide algo, es NUEVA o VARIAS. CORRIGE no existe.
- Si hay una orden pendiente y el mensaje no la acepta con claridad ni aporta datos nuevos, es CANCELA. En la duda entre CONFIRMA y cualquier otra cosa, NO es CONFIRMA: elige la otra y pon segura=false.
- Si hay una pregunta abierta y el mensaje es corto y da lo que se pedía, es RESPUESTA.
- segura=false cuando dudes entre dos tipos.`;

function mensajeUsuario(e: EntradaIntencion): string {
  const limpio = (t: string | null | undefined) => String(t ?? '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 600);
  const partes = [
    e.resumenPendiente ? `ORDEN PENDIENTE DE CONFIRMAR (lo que se le enseñó):\n${limpio(e.resumenPendiente)}` : 'ORDEN PENDIENTE DE CONFIRMAR: ninguna.',
    e.preguntaAbierta ? `PREGUNTA ABIERTA DEL ASISTENTE: ${limpio(e.preguntaAbierta)}` : 'PREGUNTA ABIERTA DEL ASISTENTE: ninguna.',
    e.ultimoAsistente ? `ÚLTIMO MENSAJE DEL ASISTENTE: ${limpio(e.ultimoAsistente)}` : '',
    `MENSAJE DEL USUARIO: ${e.mensaje}`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

export const esquemaIntencion = () => ({
  type: 'object',
  properties: {
    intencion: { type: 'string', enum: [...INTENCIONES], description: 'Lo que quiere hacer el usuario con su último mensaje.' },
    segura: { type: 'boolean', description: 'false si dudas entre dos tipos.' },
  },
  required: ['intencion', 'segura'],
  additionalProperties: false,
});

export async function clasificarIntencion(e: EntradaIntencion): Promise<SalidaIntencion> {
  const peticion = (estricto: boolean): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming => ({
    model: AGENTE_MODELO_POR_DEFECTO,
    messages: [
      { role: 'system', content: PROMPT_INTENCION },
      { role: 'user', content: mensajeUsuario(e) },
    ],
    tools: [{ type: 'function', function: { name: 'clasificar_intencion', description: 'La intención del último mensaje del usuario.', parameters: esquemaIntencion(), strict: estricto } }],
    tool_choice: { type: 'function', function: { name: 'clasificar_intencion' } },
    temperature: 0,
    max_tokens: 60,
  });
  let completion;
  try {
    completion = await getOpenAI().chat.completions.create(peticion(true));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 400) {
      logJev('api_error', { paso: 'clasificar_intencion', status: status ?? null, mensaje: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    logJev('api_esquema_rechazado', { paso: 'clasificar_intencion', mensaje: err instanceof Error ? err.message : String(err) });
    completion = await getOpenAI().chat.completions.create(peticion(false));
  }
  const call = completion.choices[0]?.message?.tool_calls?.find((c) => c.type === 'function');
  try {
    const o = JSON.parse(call && call.type === 'function' ? call.function.arguments : '{}') as { intencion?: unknown; segura?: unknown };
    const intencion = String(o.intencion ?? '').toUpperCase() as Intencion;
    if ((INTENCIONES as readonly string[]).includes(intencion)) return { intencion, segura: o.segura !== false };
  } catch {
    /* salida ilegible */
  }
  logJev('salida_ilegible', { paso: 'clasificar_intencion' });
  // Ante la duda NO se confirma nada: la intención más prudente con algo pendiente es no actuar.
  return { intencion: 'NUEVA', segura: false };
}
