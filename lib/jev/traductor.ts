/**
 * Traductor .jev: GPT-4o mini SOLO traduce el mensaje del usuario a UNA orden cerrada (función `orden_jev`).
 * No decide ids, fechas finales ni importes finales: copia literales. Todo lo demás lo hace el ejecutor.
 */
import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';
import { ACCIONES_POR_CATEGORIA, jsonSchemaOrden, validarOrden, type OrdenJev } from '@/lib/jev/ordenes';

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
  tarea?: OrdenJev | null;
  /** Última pregunta del asistente (para «sí, créalo», «el segundo»…). */
  ultimoAsistente?: string;
};

export type SalidaTraductor = { orden: OrdenJev; continuaTarea: boolean };

export const PROMPT_TRADUCTOR = `Eres el TRADUCTOR de órdenes de Perfilio (un asistente para un negocio de obras y reformas). No haces nada: solo traduces lo que dice el usuario a UNA orden con la función orden_jev.
Reglas:
- Copia LITERALES del mensaje en los campos *_texto («el lunes», «Iker PRUEBA», «180», «10 y media»). NUNCA inventes datos, ids, fechas ISO ni totales calculados.
- Importes: en importe_texto/cantidad_texto/precio_texto pon la cifra tal como la dijo. «más IVA» → iva_modo "mas"; «con IVA / IVA incluido» → "incluido"; si no lo dijo, null.
- «ese presu», «ese», «el último» → presupuesto_texto "ese". «la última factura» → factura_texto "esa".
- PRESUPUESTO_DICTADO: una partida por cada trabajo, con concepto, cantidad_texto y precio_texto SOLO si los dijo. Si dice un importe cerrado para un trabajo («colocar material, 942 euros»): cantidad_texto "1" y precio_texto "942". No estimes cantidades.
- Si falta un dato imprescindible o el mensaje es ambiguo → accion ACLARAR con una pregunta corta. Saludos, gracias o charla sin acción → CHARLA.
- Si hay TAREA EN CURSO y el usuario la corrige o completa («no, con Iker PRUEBA», «a las 5», «sí, créalo»), devuelve la orden COMPLETA ya corregida (copia los datos anteriores que no cambian) y pon continua_tarea true. Si pide otra cosa distinta, continua_tarea false.
- Borrar solo si lo pide claramente (borra, elimina, quita, anula).`;

export function construirMensajesTraductor(e: EntradaTraductor): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const partes = [`Hoy es ${e.hoyTexto}.`];
  if (e.tarea) partes.push(`TAREA EN CURSO (orden anterior, a medias): ${JSON.stringify(e.tarea)}`);
  if (e.ultimoAsistente) partes.push(`Última respuesta del asistente: ${e.ultimoAsistente.replace(/<!--[\s\S]*?-->/g, '').slice(0, 500)}`);
  return [
    { role: 'system', content: `${PROMPT_TRADUCTOR}\n\n${partes.join('\n')}` },
    { role: 'user', content: e.mensaje },
  ];
}

export function herramientaOrdenJev(categoria: string): OpenAI.Chat.Completions.ChatCompletionTool {
  const acciones = ACCIONES_POR_CATEGORIA[categoria] ?? ACCIONES_POR_CATEGORIA.general!;
  return {
    type: 'function',
    function: {
      name: 'orden_jev',
      description: 'La orden .jev que traduce el mensaje del usuario.',
      parameters: {
        type: 'object',
        properties: {
          continua_tarea: { type: 'boolean', description: 'true si corrige o completa la TAREA EN CURSO' },
          orden: jsonSchemaOrden(acciones),
        },
        required: ['orden'],
      },
    },
  };
}

/** Lee la salida del modelo: orden válida o, si no encaja, ACLARAR. */
export function interpretarSalida(argumentos: string | undefined | null): SalidaTraductor {
  try {
    const raw = JSON.parse(String(argumentos ?? '{}')) as { orden?: unknown; continua_tarea?: unknown };
    const v = validarOrden(raw.orden);
    if (v.ok) return { orden: v.orden, continuaTarea: raw.continua_tarea === true };
  } catch {
    /* JSON roto: se pregunta */
  }
  return { orden: { accion: 'ACLARAR', pregunta: 'No te he entendido bien. ¿Me lo dices de otra forma?' }, continuaTarea: false };
}

export async function traducirMensaje(e: EntradaTraductor): Promise<SalidaTraductor> {
  const completion = await getOpenAI().chat.completions.create({
    model: AGENTE_MODELO_POR_DEFECTO,
    messages: construirMensajesTraductor(e),
    tools: [herramientaOrdenJev(e.categoria)],
    tool_choice: { type: 'function', function: { name: 'orden_jev' } },
    temperature: 0,
    max_tokens: 1200,
  });
  const call = completion.choices[0]?.message?.tool_calls?.find((c) => c.type === 'function');
  return interpretarSalida(call && call.type === 'function' ? call.function.arguments : null);
}
