/**
 * Traductor .jev: GPT-4o mini SOLO traduce el mensaje del usuario a UNA orden cerrada (función `orden_jev`).
 * No decide ids, fechas finales ni importes finales: copia literales. Todo lo demás lo hace el ejecutor.
 */
import { datosSinUsar } from '@/lib/jev/sin-usar';
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
  /** La orden anterior ya está preparada y esperando el «Sí» (aún NO guardada): el usuario puede corregirla. */
  pendiente?: boolean;
  /** Última pregunta del asistente (para «sí, créalo», «el segundo»…). */
  ultimoAsistente?: string;
  /** Uso interno: aviso del segundo intento (datos que el primero dejó fuera). */
  revision?: string;
};

/**
 * Lo que dice el modelo, SIN validar a fondo: la puerta única es `completarOrden` (lib/jev/ordenes.ts), que el motor
 * llama después. Aquí solo se saca el JSON y se normaliza el envoltorio.
 */
export type SalidaTraductor = {
  orden: OrdenCruda | OrdenJev;
  continuaTarea: boolean;
  /** Otras órdenes de tipos distintos que pedía el mismo mensaje: nunca se descartan en silencio. */
  otras?: Array<OrdenCruda | OrdenJev>;
};

const REGLAS = `Eres el TRADUCTOR de Perfilio (asistente de un negocio de obras y reformas). No haces nada: traduces lo que dice el usuario a una orden cerrada.
Reglas:
- Copia LITERALES del mensaje («el jueves», «Jon PRUEBA Arrieta», «180»). Nada de ids, fechas en formato 2026-10-05 ni totales calculados.
- Lo que el usuario SÍ dijo, rellénalo siempre. Lo que NO dijo: null (o "" si el campo es obligatorio). Nunca inventes.
- «ese presu», «el último» → presupuesto_texto «ese». «esa factura», «la última» → factura_texto «esa». «el 11», «la 3» → ese número.
- Si el mensaje pide VARIAS cosas, no te quedes con una: la principal en accion y los tipos de las demás en otras_acciones (también si son del MISMO tipo: dos obras, dos gastos → el tipo repetido). Si una frase mezcla un apunte con horas de alguien («anota en el diario de Paqui que se ha pintado y apunta 3 horas a Iker»), son DOS órdenes.
- Con TAREA EN CURSO o PENDIENTE: si el usuario la corrige o completa («con Iker PRUEBA», «a las 5», «sí»), devuelve la orden COMPLETA (copia los datos anteriores que no cambian) y continua_tarea true; si pide otra cosa distinta, null.`;

/** Paso 1: elegir el tipo de orden. */
export const PROMPT_ELEGIR_ACCION = (acciones: NombreAccion[]) =>
  `${REGLAS}\n\nPASO 1: elige el tipo de orden con la función elegir_accion. Tipos:\n${accionesDelModelo(acciones)
    .map((a) => `- ${a}: ${AYUDA_ACCION[a].que} Ej.: ${AYUDA_ACCION[a].ejemplo}`)
    .join('\n')}\nCHARLA solo para saludos o gracias. Si falta un dato pero sabes qué quiere hacer, elige la acción (el sistema preguntará lo que falte). Borrar solo si lo pide claramente.`;

/** Paso 2: rellenar los campos de la acción elegida. */
export const PROMPT_RELLENAR = (accion: NombreAccion, soloEsta = false, ordinal?: { k: number; n: number }) =>
  `${REGLAS}\n\nPASO 2: la orden es ${accion}: ${AYUDA_ACCION[accion].que}\nEjemplo: ${AYUDA_ACCION[accion].ejemplo}\n${soloEsta ? `El mensaje pide más cosas: rellena SOLO la parte que es de tipo ${accion} y deja el resto para las otras órdenes.\n` : ''}${ordinal && ordinal.n > 1 ? `El mensaje pide ${ordinal.n} órdenes de este mismo tipo (${accion}): rellena SOLO la número ${ordinal.k}, en el orden en que el usuario las dice. Ejemplo: «abre el tejado y la fachada» → la 1 es el tejado y la 2 la fachada.\n` : ''}Rellena la función orden_jev con lo que dijo el usuario.`;

/** Compatibilidad con los tests: el prompt del paso 1 para todas las acciones. */
export const PROMPT_TRADUCTOR = PROMPT_ELEGIR_ACCION(ACCIONES_POR_CATEGORIA.general!);

function contexto(e: EntradaTraductor): string {
  const partes: string[] = [];
  if (e.tarea && e.pendiente) {
    partes.push(
      `ORDEN PENDIENTE DE CONFIRMAR (preparada, todavía NO guardada): ${JSON.stringify(e.tarea)}\nSi el usuario la corrige («espera, la encimera ponla a 230», «no, son 7 y media», «con Iker PRUEBA») devuelve la MISMA acción, COMPLETA y con el cambio (copia lo que no cambia), y continua_tarea true. Una orden pendiente se corrige con su misma acción, nunca con PRESUPUESTO_PARTIDAS (que es solo para presupuestos YA guardados). Si pide otra cosa distinta, continua_tarea null.`
    );
  } else if (e.tarea) partes.push(`TAREA EN CURSO / PENDIENTE (orden anterior): ${JSON.stringify(e.tarea)}`);
  if (e.revision) partes.push(`REVISIÓN: en un primer intento ${e.revision} Todo dato que dijo el usuario (cifras, nombres, cantidades) debe quedar en algún campo de alguna orden; si el tipo de orden elegido no tiene dónde ponerlo, elige otro tipo que sí lo recoja.`);
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
async function traducirUnaVez(e: EntradaTraductor): Promise<SalidaTraductor> {
  const acciones = ACCIONES_POR_CATEGORIA[e.categoria] ?? ACCIONES_POR_CATEGORIA.general!;
  const paso1 = await llamar('elegir_accion', (st) => herramientaElegirAccion(e.categoria, st), mensajes(PROMPT_ELEGIR_ACCION(acciones), e), 120);
  const accion = normalizarAccionPublica(paso1?.accion);
  const continuaTarea = paso1?.continua_tarea === true;
  if (!accion || ![...acciones, ...accionesDelModelo(acciones)].includes(accion)) {
    logJev('accion_desconocida', { paso: 'elegir_accion', accion: paso1?.accion ?? null });
    return { orden: { accion: 'ACLARAR' }, continuaTarea: false };
  }
  const otrasAcciones = (Array.isArray(paso1?.otras_acciones) ? (paso1!.otras_acciones as unknown[]) : [])
    .map((x) => normalizarAccionPublica(x))
    .filter((x): x is NombreAccion => Boolean(x) && x !== 'ACLARAR' && x !== 'CHARLA')
    .slice(0, 3);
  const rellenar = async (a: NombreAccion, soloEsta: boolean, ordinal?: { k: number; n: number }): Promise<OrdenCruda | null> => {
    const tool = herramientaOrdenJev(a);
    if (!tool) return { accion: a };
    const campos = await llamar('orden_jev', (st) => herramientaOrdenJev(a, st)!, mensajes(PROMPT_RELLENAR(a, soloEsta, ordinal), e), 1200);
    return { ...(campos ?? {}), accion: a } as OrdenCruda;
  };
  // Órdenes del MISMO tipo que la principal («dos obras», «dos gastos»): cada una se rellena aparte, en orden.
  const mismas = otrasAcciones.filter((a) => a === accion).length;
  const principal = (await rellenar(accion, otrasAcciones.length > 0, mismas ? { k: 1, n: mismas + 1 } : undefined)) as OrdenCruda;
  const otras: OrdenCruda[] = [];
  let k = 1;
  for (const a of otrasAcciones) {
    if (a === accion) k += 1;
    const o = await rellenar(a, true, a === accion ? { k, n: mismas + 1 } : undefined);
    if (o) otras.push(o);
  }
  return { orden: principal, continuaTarea, ...(otras.length ? { otras } : {}) };
}

/**
 * Traduce y se REVISA: si el mensaje trae cifras que ninguna orden recogió (el modelo eligió un tipo sin hueco para ellas o dejó
 * campos vacíos), se repite una vez diciéndole qué dejó fuera. Se queda con el segundo intento solo si recoge más datos.
 */
export async function traducirMensaje(e: EntradaTraductor): Promise<SalidaTraductor> {
  const primera = await traducirUnaVez(e);
  if (e.tarea || e.revision) return primera;
  const ordenes = [primera.orden, ...(primera.otras ?? [])] as Array<Record<string, unknown>>;
  if (ordenes.some((o) => o.accion === 'CHARLA' || o.accion === 'CHARLA_ACLARAR')) return primera;
  const fuera = datosSinUsar(e.mensaje, ordenes);
  if (!fuera) return primera;
  logJev('traduccion_incompleta', { dato: fuera });
  const segunda = await traducirUnaVez({ ...e, revision: `dejaste fuera «${fuera}».` });
  const fuera2 = datosSinUsar(e.mensaje, [segunda.orden, ...(segunda.otras ?? [])] as Array<Record<string, unknown>>);
  return fuera2 === null ? segunda : primera;
}
