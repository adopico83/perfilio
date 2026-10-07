/**
 * Traductor .jev: GPT-4o mini SOLO traduce el mensaje del usuario a UNA orden cerrada (función `orden_jev`).
 * No decide ids, fechas finales ni importes finales: copia literales. Todo lo demás lo hace el ejecutor.
 */
import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';
import { logJev } from '@/lib/jev/log';
import { ACCIONES_POR_CATEGORIA, AYUDA_ACCION, accionesDelModelo, jsonSchemaAccion, jsonSchemaCampos, normalizarAccionPublica, type NombreAccion, type OrdenCruda, type OrdenJev } from '@/lib/jev/ordenes';

let cliente: OpenAI | null = null;
function getOpenAI(): OpenAI {
  cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cliente;
}

export type EntradaTraductor = {
  mensaje: string;
  /** Categoría que ya dio el router .jev de intención (presupuesto, factura, diario…). */
  categoria: string;
  hoyTexto: string;
  /** Tarea a medias (la orden anterior) si la hay. */
  tarea?: OrdenCruda | OrdenJev | null;
  /** Última pregunta del asistente (para «sí, créalo», «el segundo»…). */
  ultimoAsistente?: string;
};

/**
 * Lo que dice el modelo, SIN validar a fondo: la puerta única es `completarOrden` (lib/jev/ordenes.ts), que el motor
 * llama después. Aquí solo se saca el JSON y se normaliza el envoltorio.
 */
export type SalidaTraductor = { orden: OrdenCruda | OrdenJev; continuaTarea: boolean };

const REGLAS = `Eres el TRADUCTOR de Perfilio (asistente de un negocio de obras y reformas). No haces nada: traduces lo que dice el usuario a una orden cerrada.
Reglas:
- Copia LITERALES del mensaje («el jueves», «Jon PRUEBA Arrieta», «180»). Nada de ids, fechas en formato 2026-10-05 ni totales calculados.
- Lo que el usuario SÍ dijo, rellénalo siempre. Lo que NO dijo: null (o "" si el campo es obligatorio). Nunca inventes.
- «ese presu», «el último» → presupuesto_texto «ese». «esa factura», «la última» → factura_texto «esa». «el 11», «la 3» → ese número.
- Con TAREA EN CURSO: si el usuario la corrige o completa («con Iker PRUEBA», «a las 5», «sí»), devuelve la orden COMPLETA (copia los datos anteriores que no cambian) y continua_tarea true; si pide otra cosa distinta, null.`;

/** Paso 1: elegir el tipo de orden. */
export const PROMPT_ELEGIR_ACCION = (acciones: NombreAccion[]) =>
  `${REGLAS}\n\nPASO 1: elige el tipo de orden con la función elegir_accion. Tipos:\n${accionesDelModelo(acciones)
    .map((a) => `- ${a}: ${AYUDA_ACCION[a].que} Ej.: ${AYUDA_ACCION[a].ejemplo}`)
    .join('\n')}\nCHARLA solo para saludos o gracias. Si falta un dato pero sabes qué quiere hacer, elige la acción (el sistema preguntará lo que falte). Borrar solo si lo pide claramente.`;

/** Paso 2: rellenar los campos de la acción elegida. */
export const PROMPT_RELLENAR = (accion: NombreAccion) =>
  `${REGLAS}\n\nPASO 2: la orden es ${accion}: ${AYUDA_ACCION[accion].que}\nEjemplo: ${AYUDA_ACCION[accion].ejemplo}\nRellena la función orden_jev con lo que dijo el usuario.`;

/** Compatibilidad con los tests: el prompt del paso 1 para todas las acciones. */
export const PROMPT_TRADUCTOR = PROMPT_ELEGIR_ACCION(ACCIONES_POR_CATEGORIA.general!);

function contexto(e: EntradaTraductor): string {
  const partes: string[] = [];
  if (e.tarea) partes.push(`TAREA EN CURSO (orden anterior, a medias): ${JSON.stringify(e.tarea)}`);
  if (e.ultimoAsistente) partes.push(`Última respuesta del asistente: ${e.ultimoAsistente.replace(/<!--[\s\S]*?-->/g, '').slice(0, 500)}`);
  return partes.join('\n');
}

type Mensajes = OpenAI.Chat.Completions.ChatCompletionMessageParam[];
const mensajes = (sistema: string, e: EntradaTraductor): Mensajes => [
  { role: 'system', content: [sistema, contexto(e)].filter(Boolean).join('\n\n') },
  { role: 'user', content: e.mensaje },
];

export function construirMensajesTraductor(e: EntradaTraductor): Mensajes {
  return mensajes(PROMPT_ELEGIR_ACCION(ACCIONES_POR_CATEGORIA[e.categoria] ?? ACCIONES_POR_CATEGORIA.general!), e);
}

const herramienta = (name: string, description: string, parameters: Record<string, unknown>, strict: boolean): OpenAI.Chat.Completions.ChatCompletionFunctionTool => ({
  type: 'function',
  function: { name, description, parameters, strict },
});

export function herramientaElegirAccion(categoria: string, estricto = true) {
  return herramienta('elegir_accion', 'Elige el tipo de orden que pide el usuario.', jsonSchemaAccion(ACCIONES_POR_CATEGORIA[categoria] ?? ACCIONES_POR_CATEGORIA.general!), estricto);
}

export function herramientaOrdenJev(accion: NombreAccion, estricto = true) {
  const parametros = jsonSchemaCampos(accion);
  return parametros ? herramienta('orden_jev', `Los datos de la orden ${accion}. Lo que no dijo: null.`, parametros, estricto) : null;
}

const parsear = (argumentos: string | undefined | null): Record<string, unknown> | null => {
  try {
    const r = JSON.parse(String(argumentos ?? '{}'));
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
  } catch {
    logJev('salida_ilegible', { argumentos: String(argumentos ?? '').slice(0, 200) });
    return null;
  }
};

/** Une los dos pasos (o lee el JSON plano/envuelto de siempre). Nunca lanza. */
export function interpretarSalida(argumentos: string | undefined | null): SalidaTraductor {
  const o = parsear(argumentos);
  if (!o) return { orden: { accion: 'ACLARAR' }, continuaTarea: false };
  const envuelta = o.orden && typeof o.orden === 'object' && !Array.isArray(o.orden);
  const orden = (envuelta ? o.orden : Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'continua_tarea'))) as OrdenCruda;
  return { orden, continuaTarea: o.continua_tarea === true };
}

type PeticionOpenAI = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/** Una llamada forzando una función; si OpenAI rechaza el esquema estricto (400) reintenta sin strict. */
async function llamar(nombre: string, hacerTool: (estricto: boolean) => OpenAI.Chat.Completions.ChatCompletionTool, msgs: Mensajes, maxTokens: number): Promise<Record<string, unknown> | null> {
  const peticion = (estricto: boolean): PeticionOpenAI => ({
    model: AGENTE_MODELO_POR_DEFECTO,
    messages: msgs,
    tools: [hacerTool(estricto)],
    tool_choice: { type: 'function', function: { name: nombre } },
    temperature: 0,
    max_tokens: maxTokens,
  });
  let completion;
  try {
    completion = await getOpenAI().chat.completions.create(peticion(true));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 400) {
      logJev('api_error', { paso: nombre, status: status ?? null, mensaje: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    logJev('api_esquema_rechazado', { paso: nombre, mensaje: err instanceof Error ? err.message : String(err) });
    completion = await getOpenAI().chat.completions.create(peticion(false));
  }
  const call = completion.choices[0]?.message?.tool_calls?.find((c) => c.type === 'function');
  if (!call || call.type !== 'function') {
    logJev('salida_ilegible', { paso: nombre, motivo: 'el modelo no llamó a la función' });
    return null;
  }
  return parsear(call.function.arguments);
}

/**
 * Traducción en DOS pasos: (1) enum cerrado con el tipo de orden; (2) esquema estricto SOLO de esa orden. Con un
 * esquema plano de ~37 campos todos anulables, el modelo real dejaba a null campos que el usuario sí había dicho.
 */
export async function traducirMensaje(e: EntradaTraductor): Promise<SalidaTraductor> {
  const acciones = ACCIONES_POR_CATEGORIA[e.categoria] ?? ACCIONES_POR_CATEGORIA.general!;
  const paso1 = await llamar('elegir_accion', (st) => herramientaElegirAccion(e.categoria, st), mensajes(PROMPT_ELEGIR_ACCION(acciones), e), 120);
  const accion = normalizarAccionPublica(paso1?.accion);
  const continuaTarea = paso1?.continua_tarea === true;
  if (!accion || ![...acciones, ...accionesDelModelo(acciones)].includes(accion)) {
    logJev('accion_desconocida', { paso: 'elegir_accion', accion: paso1?.accion ?? null });
    return { orden: { accion: 'ACLARAR' }, continuaTarea: false };
  }
  const tool = herramientaOrdenJev(accion);
  if (!tool) return { orden: { accion }, continuaTarea };
  const paso2 = await llamar('orden_jev', (st) => herramientaOrdenJev(accion, st)!, mensajes(PROMPT_RELLENAR(accion), e), 1200);
  return { orden: { ...(paso2 ?? {}), accion } as OrdenCruda, continuaTarea };
}
