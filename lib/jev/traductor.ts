/**
 * Traductor .jev: GPT-4o mini SOLO traduce el mensaje del usuario a UNA orden cerrada (función `orden_jev`).
 * No decide ids, fechas finales ni importes finales: copia literales. Todo lo demás lo hace el ejecutor.
 */
import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';
import { logJev } from '@/lib/jev/log';
import { ACCIONES_POR_CATEGORIA, jsonSchemaEstricto, type OrdenCruda, type OrdenJev } from '@/lib/jev/ordenes';

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

export const PROMPT_TRADUCTOR = `Eres el TRADUCTOR de Perfilio (asistente de un negocio de obras y reformas). No haces nada: traduces lo que dice el usuario a UNA orden con la función orden_jev.
Reglas:
- Si el usuario NO dijo un dato, ese campo es null. Nunca "", ni "N/A", ni "no indicado", ni un valor inventado.
- Los campos *_texto copian LITERALES del mensaje («el jueves», «Jon PRUEBA Arrieta», «180», «a las 10»). Nada de ids, fechas ISO ni totales calculados.
- «más IVA» → iva_modo "mas"; «con IVA / IVA incluido» → "incluido"; si no lo dijo, null.
- «ese presu», «el último» → presupuesto_texto "ese"; «la última factura» → factura_texto "esa".
- Un trabajo con importe cerrado («colocar material, 942 euros») → una partida con cantidad_texto "1" y precio_texto "942". No estimes cantidades.
- Preguntas de lectura («¿qué presupuestos tengo pendientes?», «¿qué tengo esta semana?») son CONSULTA_*: se hacen siempre, aunque casi todo vaya a null.
- ACLARAR solo si no sabes qué quiere hacer. Si sabes qué quiere pero falta un dato, pon la acción y deja ese dato a null: el sistema preguntará.
- Saludos o charla sin acción → CHARLA. Borrar solo si lo pide claramente.
- Con TAREA EN CURSO: si el usuario la corrige o completa («con Iker PRUEBA», «a las 5», «sí»), devuelve la orden COMPLETA con los datos anteriores que no cambian y continua_tarea true; si pide otra cosa, null.
Ejemplos (null = no lo dijo):
«crea el cliente Jon PRUEBA Arrieta, teléfono 600123123, de Irún» → CREAR_CLIENTE nombre_texto "Jon PRUEBA Arrieta", telefono_texto "600123123", direccion_texto "Irún"
«apúntame una visita mañana a las 10 con Ane» → CITA_CREAR titulo_texto "Visita con Ane", fecha_texto "mañana", hora_texto "a las 10"
«gasto de 180 más IVA en Saltoki para la obra de Leire» → GASTO proveedor_texto "Saltoki", importe_texto "180", iva_modo "mas", obra_texto "Leire"
«ponle 8 horas a Iker en lo de Paqui» → HORAS operario_texto "Iker", horas_texto "8", obra_texto "Paqui"
«enséñame los presupuestos pendientes» → CONSULTA_PRESUPUESTOS estado "pendientes"
«hazme un presupuesto para Paqui: alicatar el baño, 12 metros a 40 euros» → PRESUPUESTO_DICTADO cliente_texto "Paqui", partidas [{concepto_texto "alicatar el baño", cantidad_texto "12", unidad_texto "metros", precio_texto "40"}]`;

export function construirMensajesTraductor(e: EntradaTraductor): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const partes = [`Hoy es ${e.hoyTexto}.`];
  if (e.tarea) partes.push(`TAREA EN CURSO (orden anterior, a medias): ${JSON.stringify(e.tarea)}`);
  if (e.ultimoAsistente) partes.push(`Última respuesta del asistente: ${e.ultimoAsistente.replace(/<!--[\s\S]*?-->/g, '').slice(0, 500)}`);
  return [
    { role: 'system', content: `${PROMPT_TRADUCTOR}\n\n${partes.join('\n')}` },
    { role: 'user', content: e.mensaje },
  ];
}

export function herramientaOrdenJev(categoria: string, estricto = true): OpenAI.Chat.Completions.ChatCompletionTool {
  const acciones = ACCIONES_POR_CATEGORIA[categoria] ?? ACCIONES_POR_CATEGORIA.general!;
  return {
    type: 'function',
    function: {
      name: 'orden_jev',
      description: 'La orden .jev que traduce el mensaje del usuario. Lo que no dijo: null.',
      parameters: jsonSchemaEstricto(acciones),
      strict: estricto,
    },
  };
}

/** Lee los argumentos de la función: el JSON plano (o, por compatibilidad, envuelto en `orden`). Nunca lanza. */
export function interpretarSalida(argumentos: string | undefined | null): SalidaTraductor {
  let raw: unknown;
  try {
    raw = JSON.parse(String(argumentos ?? '{}'));
  } catch {
    logJev('salida_ilegible', { argumentos: String(argumentos ?? '').slice(0, 200) });
    return { orden: { accion: 'ACLARAR' }, continuaTarea: false };
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const envuelta = o.orden && typeof o.orden === 'object' && !Array.isArray(o.orden);
  const orden = (envuelta ? o.orden : Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'continua_tarea'))) as OrdenCruda;
  return { orden, continuaTarea: o.continua_tarea === true };
}

type PeticionOpenAI = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

export async function traducirMensaje(e: EntradaTraductor): Promise<SalidaTraductor> {
  const base = (estricto: boolean): PeticionOpenAI => ({
    model: AGENTE_MODELO_POR_DEFECTO,
    messages: construirMensajesTraductor(e),
    tools: [herramientaOrdenJev(e.categoria, estricto)],
    tool_choice: { type: 'function', function: { name: 'orden_jev' } },
    temperature: 0,
    max_tokens: 1200,
  });
  let completion;
  try {
    completion = await getOpenAI().chat.completions.create(base(true));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 400) {
      logJev('api_error', { status: status ?? null, mensaje: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    // OpenAI rechazó el esquema estricto (p. ej. cambian sus límites): se sigue sin strict, validando igual en servidor.
    logJev('api_esquema_rechazado', { mensaje: err instanceof Error ? err.message : String(err) });
    completion = await getOpenAI().chat.completions.create(base(false));
  }
  const call = completion.choices[0]?.message?.tool_calls?.find((c) => c.type === 'function');
  if (!call) logJev('salida_ilegible', { motivo: 'el modelo no llamó a orden_jev' });
  return interpretarSalida(call && call.type === 'function' ? call.function.arguments : null);
}
