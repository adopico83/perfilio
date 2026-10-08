/**
 * Traductor .jev: GPT-4o mini SOLO traduce el mensaje del usuario a UNA orden cerrada (función `orden_jev`).
 * No decide ids, fechas finales ni importes finales: copia literales. Todo lo demás lo hace el ejecutor.
 */
import { clausulaEn, datoSinUsarDetalle, datosDurosDe, datosSinUsar } from '@/lib/jev/sin-usar';
import { claveOrden } from '@/lib/jev/cola';
import { numerosDelMensaje } from '@/lib/jev/fechas';
import OpenAI from 'openai';
import { AGENTE_MODELO_POR_DEFECTO } from '@/lib/agente/modelo';
import { logJev } from '@/lib/jev/log';
import { ACCIONES_POR_CATEGORIA, AYUDA_ACCION, accionesDelModelo, jsonSchemaAccion, etiquetaOrden, jsonSchemaCampos, nombreParaModelo, normalizarAccionPublica, type NombreAccion, type OrdenCruda, type OrdenJev } from '@/lib/jev/ordenes';

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
  /** Uso interno: lee con las opciones en orden inverso (la segunda lectura de la idea 4). */
  invertir?: boolean;
  /** Dos lecturas para las órdenes que escriben: si no coinciden, se pregunta en vez de guardar la mitad. El motor lo activa; por defecto no. */
  dobleLectura?: boolean;
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
  /** Una cláusula se rescató traduciéndola aparte (el motor lo cuenta al usuario). */
  rescate?: boolean;
  /** Las dos lecturas no coinciden: lo que hay que preguntar y el plan más completo que se preparará si el usuario dice que sí. */
  desacuerdo?: { pregunta: string; ordenes: Array<OrdenCruda | OrdenJev> };
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
    .map((a) => `- ${nombreParaModelo(a)}: ${AYUDA_ACCION[a].que} Ej.: ${AYUDA_ACCION[a].ejemplo}`)
    .join('\n')}\nSi dice «en/al presupuesto de <cliente>» (ya existe), añadir o quitar partidas es EDITAR_PRESUPUESTO_EXISTENTE_PARTIDAS; PRESUPUESTO_NUEVO_CON_PARTIDAS_DICTADAS es solo un presupuesto NUEVO. Con un cliente y un importe y sin nombrar presupuesto ni albarán, es FACTURA_LIBRE_CON_CLIENTE_E_IMPORTE (FACTURA_DESDE_PRESUPUESTO_O_ALBARAN_EXISTENTE solo parte de un presupuesto o albarán que existe). CHARLA solo para saludos o gracias. Si falta un dato pero sabes qué quiere hacer, elige la acción (el sistema preguntará lo que falte). Borrar solo si lo pide claramente.`;

/** Paso 2: rellenar los campos de la acción elegida. */
export const PROMPT_RELLENAR = (accion: NombreAccion, soloEsta = false, ordinal?: { k: number; n: number }) =>
  `${REGLAS}\n\nPASO 2: la orden es ${accion}: ${AYUDA_ACCION[accion].que}\nEjemplo: ${AYUDA_ACCION[accion].ejemplo}\n${soloEsta ? `El mensaje pide más cosas: rellena SOLO la parte que es de tipo ${accion} y deja el resto para las otras órdenes.\n` : ''}${ordinal && ordinal.n > 1 ? `El mensaje pide ${ordinal.n} órdenes de este mismo tipo (${accion}): rellena SOLO la número ${ordinal.k}, en el orden en que el usuario las dice. Ejemplo: «abre el tejado y la fachada» → la 1 es el tejado y la 2 la fachada.\n` : ''}Rellena la función orden_jev con lo que dijo el usuario.`;

/** Compatibilidad con los tests: el prompt del paso 1 para todas las acciones. */
export const PROMPT_TRADUCTOR = PROMPT_ELEGIR_ACCION(ACCIONES_POR_CATEGORIA.general!);

function contexto(e: EntradaTraductor): string {
  const partes: string[] = [];
  if (e.tarea && e.pendiente) {
    partes.push(
      `ORDEN PENDIENTE DE CONFIRMAR (preparada, todavía NO guardada): ${JSON.stringify(e.tarea)}\nSi el usuario la corrige («espera, la encimera ponla a 230», «no, son 7 y media», «con Iker PRUEBA») devuelve la MISMA acción, COMPLETA y con el cambio (copia lo que no cambia), y continua_tarea true. Una orden pendiente AÚN NO existe en el sistema: «ponla el jueves», «muévela», «cámbiala» significan corregir ESTA orden con su misma acción (una cita pendiente se corrige con CITA_CREAR, no con CITA_MOVER; nunca con PRESUPUESTO_PARTIDAS, que es solo para presupuestos YA guardados). Si pide otra cosa distinta, continua_tarea null.`
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

export function herramientaElegirAccion(categoria: string, estricto = true, acciones?: NombreAccion[]) {
  return herramienta('elegir_accion', 'Elige el tipo de orden que pide el usuario.', jsonSchemaAccion(acciones ?? ACCIONES_POR_CATEGORIA[categoria] ?? ACCIONES_POR_CATEGORIA.general!), estricto);
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
async function traducirUnaVez(e: EntradaTraductor, excluir: NombreAccion[] = []): Promise<SalidaTraductor> {
  const todasAcciones = (ACCIONES_POR_CATEGORIA[e.categoria] ?? ACCIONES_POR_CATEGORIA.general!).filter((a) => !excluir.includes(a));
  const acciones = e.invertir ? [...todasAcciones].reverse() : todasAcciones;
  const paso1 = await llamar('elegir_accion', (st) => herramientaElegirAccion(e.categoria, st, acciones), mensajes(PROMPT_ELEGIR_ACCION(acciones), e), 120);
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
  // Dos órdenes IDÉNTICAS no son dos peticiones sino una copia del modelo: se queda una (nunca se guarda dos veces).
  const vistas = new Set([JSON.stringify(principal)]);
  const distintas = otras.filter((o) => {
    const k = JSON.stringify(o);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return { orden: principal, continuaTarea, ...(distintas.length ? { otras: distintas } : {}) };
}

/**
 * Traduce y se REVISA: si el mensaje trae cifras que ninguna orden recogió (el modelo eligió un tipo sin hueco para ellas o dejó
 * campos vacíos), se repite una vez diciéndole qué dejó fuera. Se queda con el segundo intento solo si recoge más datos.
 */
async function traducirConRevision(e: EntradaTraductor): Promise<SalidaTraductor> {
  const primera = await traducirUnaVez(e);
  if (e.tarea || e.revision) return primera;
  const ordenes = [primera.orden, ...(primera.otras ?? [])] as Array<Record<string, unknown>>;
  if (ordenes.some((o) => o.accion === 'CHARLA' || o.accion === 'CHARLA_ACLARAR')) return primera;
  const fuera = datosSinUsar(e.mensaje, ordenes);
  if (!fuera) return primera;
  logJev('traduccion_incompleta', { dato: fuera });
  // Si la orden principal salió VACÍA (el tipo elegido no recogió nada de lo dicho), ese tipo se descarta en el segundo intento.
  const principalVacia = Object.entries(primera.orden as Record<string, unknown>).every(([k, v]) => k === 'accion' || v == null || v === '' || (Array.isArray(v) && v.length === 0));
  const excluir = principalVacia ? [primera.orden.accion as NombreAccion] : [];
  const segunda = await traducirUnaVez({ ...e, revision: `dejaste fuera «${fuera}»${excluir.length ? ` y elegiste ${excluir[0]}, que no recogió nada` : ''}.` }, excluir);
  const fuera2 = datosSinUsar(e.mensaje, [segunda.orden, ...(segunda.otras ?? [])] as Array<Record<string, unknown>>);
  const mejor = fuera2 === null ? segunda : primera;
  if (fuera2 === null) return mejor;
  return recogerCláusulaHuérfana(e, mejor);
}

/**
 * Último recurso: si tras revisar sigue habiendo una cifra que ninguna orden recoge, la cláusula del mensaje a la que pertenece se
 * traduce SOLA y se añade como otra orden (así «y de paso ponle 6 horas a Jon» nunca se pierde por un tipo mal elegido).
 */
async function recogerCláusulaHuérfana(e: EntradaTraductor, salida: SalidaTraductor): Promise<SalidaTraductor> {
  const ordenes = [salida.orden, ...(salida.otras ?? [])] as Array<Record<string, unknown>>;
  const d = datoSinUsarDetalle(e.mensaje, ordenes);
  if (!d) return salida;
  const clausula = clausulaEn(e.mensaje, d.indice);
  if (!clausula || clausula.length >= e.mensaje.trim().length - 2) return salida;
  // La cláusula se traduce SOLA. Solo se acepta si la orden recoge TODOS sus datos (cifras con su unidad y nombres); si no, se prueba
  // otra vez sin el tipo que falló. Si ninguna sirve, no se añade nada y el motor AVISA de lo que quedó sin preparar.
  const excluir: NombreAccion[] = [];
  let extra: SalidaTraductor | null = null;
  for (let intento = 0; intento < 2 && !extra; intento++) {
    const c = await traducirUnaVez({ ...e, mensaje: clausula, revision: undefined }, excluir);
    const o = c.orden as Record<string, unknown>;
    if (!o.accion || o.accion === 'ACLARAR' || o.accion === 'CHARLA') break;
    if (datosSinUsar(clausula, [o]) === null && !ordenes.some((x) => JSON.stringify(x) === JSON.stringify(o))) extra = c;
    else excluir.push(o.accion as NombreAccion);
  }
  if (!extra) return salida;
  const o = extra.orden as Record<string, unknown>;
  logJev('traduccion_incompleta', { dato: d.trozo, recogido: String(o.accion) });
  return { ...salida, otras: [...(salida.otras ?? []), extra.orden, ...(extra.otras ?? [])], rescate: true };
}


// ───────────────────────────── Troceo con cobertura ─────────────────────────────

const PROMPT_TROCEAR = `Cortas un mensaje en TROZOS LITERALES, uno por cada petición distinta, con la función trocear.
- Copia el texto EXACTO del mensaje, en el mismo orden. No añadas, quites ni cambies ninguna palabra ni cifra.
- Una petición con varios datos o una lista (varias partidas, varias personas en horas, «de 8 a 2 y media») es UN solo trozo.
- Si el mensaje es una sola petición, devuelve un solo trozo.`;

const normTxt = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fichas = (s: string): string => normTxt(s).split(/[^a-z0-9ñ]+/).filter(Boolean).join(' ');

/** ¿Los trozos, juntos y en orden, son EXACTAMENTE el mensaje (mismas palabras y cifras, sin sobrar ni faltar)? */
export function reconstruye(mensaje: string, trozos: string[]): boolean {
  return trozos.length > 0 && fichas(mensaje) === fichas(trozos.join(' '));
}

const llevaDatos = (t: string): boolean => /\d/.test(t) || /\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(t) || /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+\S/.test(t);

/** Los trozos que no llevan ningún dato («y de paso») se pegan al anterior (o al siguiente si es el primero). Nunca se separa «7 y media». */
export function unirSinDatos(trozos: string[]): string[] {
  const out: string[] = [];
  let pendiente = '';
  for (const t of trozos.map((x) => x.trim()).filter(Boolean)) {
    if (!llevaDatos(t)) {
      if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${t}`;
      else pendiente = `${pendiente} ${t}`.trim();
      continue;
    }
    out.push(`${pendiente} ${t}`.trim());
    pendiente = '';
  }
  if (pendiente) out.push(pendiente);
  return out;
}

/** Pasa por el modelo el corte en trozos y lo VALIDA: si no reconstruye el mensaje tal cual, no vale (null). */
export async function trocear(mensaje: string): Promise<string[] | null> {
  const schema = { type: 'object', properties: { trozos: { type: 'array', items: { type: 'string' }, description: 'Trozos literales del mensaje, en orden.' } }, required: ['trozos'], additionalProperties: false };
  let r: Record<string, unknown> | null = null;
  try {
    r = await llamar('trocear', (st) => herramienta('trocear', 'Corta el mensaje en trozos literales, uno por petición.', schema, st), [{ role: 'system', content: PROMPT_TROCEAR }, { role: 'user', content: mensaje }], 600);
  } catch {
    return null;
  }
  const trozos = Array.isArray(r?.trozos) ? (r!.trozos as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  if (!reconstruye(mensaje, trozos)) {
    logJev('troceo_invalido', { trozos: trozos.length });
    return null;
  }
  return unirSinDatos(trozos);
}

/**
 * ¿Merece la pena trocear? Solo si el mensaje es largo y trae varios datos duros (varias cifras, o cifras y nombres): una frase corta con
 * una sola petición no necesita la llamada de más.
 */
export function merecePenaTrocear(m: string): boolean {
  if (m.trim().length < 50) return false;
  const cifras = new Set(numerosDelMensaje(m)).size;
  const nombres = [...m.matchAll(/\b[A-ZÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]{2,}/g)].length; // con repeticiones: «Paqui» dos veces = dos peticiones que lo nombran
  return cifras >= 2 || cifras + nombres >= 3;
}

/** Palabras de datos de una orden (campos *_texto, sin los «basureros»): para saber si una orden inventada cabe en un trozo. */
function datosPropios(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  const rec = (v: unknown, k = ''): void => {
    if (typeof v === 'string') {
      if (/_texto$/.test(k) && !['descripcion_texto', 'notas_texto', 'titulo_texto'].includes(k) && v.trim()) out.push(fichas(v));
    } else if (Array.isArray(v)) v.forEach((x) => rec(x, k));
    else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v as Record<string, unknown>)) rec(x, kk);
  };
  rec(o);
  return out.filter(Boolean);
}

/**
 * IDEA 1. Si el mensaje trae varias cifras, el modelo lo corta en trozos (uno por petición) y el CÓDIGO comprueba cada trozo:
 *  - un trozo está cubierto si UNA orden recoge todos sus datos (cifras con su unidad y nombres);
 *  - un trozo sin cubrir se traduce SOLO (probando otro tipo si el primero no sirve) y se añade como orden;
 *  - una orden que no cubre ningún trozo y cuyos datos caben en un trozo rescatado se quita: era una invención del modelo.
 * Si el corte no reconstruye el mensaje, se descarta y se sigue como estaba (el guardián final avisará de lo que falte).
 */
export async function cubrirPorTrozos(e: EntradaTraductor, salida: SalidaTraductor): Promise<SalidaTraductor> {
  if (e.tarea || !merecePenaTrocear(e.mensaje)) return salida;
  const todas = [salida.orden, ...(salida.otras ?? [])] as Array<Record<string, unknown>>;
  if (todas.some((o) => o.accion === 'CHARLA' || o.accion === 'ACLARAR')) return salida;
  const trozos = await trocear(e.mensaje);
  if (!trozos || trozos.length < 2) return salida;

  const cubre = (t: string, o: Record<string, unknown>) => datosSinUsar(t, [o]) === null;
  // Datos PROPIOS de cada trozo: los que no salen en ningún otro («Paqui» compartido no distingue; «6» o «Jon» sí).
  const datos = trozos.map((t) => datosDurosDe(t));
  const propios = datos.map((d, i) => new Set([...d].filter((x) => datos.every((otro, j) => j === i || !otro.has(x)))));
  const conPropios = trozos.map((_, i) => i).filter((i) => propios[i]!.size > 0);
  const ocupadas = new Set<Record<string, unknown>>();
  const sinCubrir: string[] = [];
  for (const i of conPropios) {
    const cubren = todas.filter((o) => cubre(trozos[i]!, o));
    if (!cubren.length) sinCubrir.push(trozos[i]!);
    cubren.forEach((o) => ocupadas.add(o));
  }
  // Un trozo sin datos propios (p. ej. «anota en el diario de Paqui que se ha picado el baño») necesita SU orden: una que no esté ya ocupada.
  for (let i = 0; i < trozos.length; i++) {
    if (propios[i]!.size === 0 && llevaDatos(trozos[i]!) && todas.every((o) => ocupadas.has(o))) sinCubrir.push(trozos[i]!);
  }
  if (!sinCubrir.length) return salida;

  const nuevas: Array<Record<string, unknown>> = [];
  const quitar = new Set<Record<string, unknown>>();
  for (const t of sinCubrir) {
    const excluir: NombreAccion[] = [];
    let hallada: SalidaTraductor | null = null;
    for (let intento = 0; intento < 2 && !hallada; intento++) {
      const c = await traducirUnaVez({ ...e, mensaje: t, revision: undefined }, excluir);
      const o = c.orden as Record<string, unknown>;
      if (!o.accion || o.accion === 'ACLARAR' || o.accion === 'CHARLA') break;
      const repetida = [...todas, ...nuevas].some((x) => claveOrden(x) === claveOrden(o));
      if (cubre(t, o) && !repetida) hallada = c;
      else excluir.push(o.accion as NombreAccion);
    }
    if (!hallada) continue;
    nuevas.push(hallada.orden as Record<string, unknown>, ...((hallada.otras ?? []) as Array<Record<string, unknown>>));
    // Las órdenes que no cubren NINGÚN trozo y cuyos datos caben en este son invenciones (el «gasto de 6 € a nombre de Jon»).
    const textoTrozo = fichas(t);
    for (const o of todas) {
      if (trozos.some((x) => cubre(x, o))) continue;
      const propios = datosPropios(o);
      if (propios.length && propios.every((d) => textoTrozo.includes(d))) quitar.add(o);
    }
  }
  if (!nuevas.length) return salida;
  logJev('traduccion_incompleta', { dato: sinCubrir.join(' | ').slice(0, 120), recogido: nuevas.map((o) => String(o.accion)).join(',') });
  const quedan = todas.filter((o) => !quitar.has(o));
  const [principal, ...otras] = [...quedan, ...nuevas];
  return { ...salida, orden: principal as OrdenCruda, otras: otras as OrdenCruda[], rescate: true };
}

/** UNA lectura completa: dos pasos, revisión de datos sin usar y, si trae varios datos, comprobación por trozos. */
async function leer(e: EntradaTraductor): Promise<SalidaTraductor> {
  const salida = await traducirConRevision(e);
  try {
    return await cubrirPorTrozos(e, salida);
  } catch {
    return salida;
  }
}

const NO_ESCRIBEN = /^(?:CONSULTA_|PDF_ENLACE$|ACLARAR$|CHARLA$)/;
const ordenesDe = (s: SalidaTraductor): Array<Record<string, unknown>> => [s.orden, ...(s.otras ?? [])] as Array<Record<string, unknown>>;
const escribe = (s: SalidaTraductor): boolean => ordenesDe(s).some((o) => typeof o.accion === 'string' && !NO_ESCRIBEN.test(o.accion));

/** Cifras (canónicas) que recogen unas órdenes: lo que no puede cambiar entre dos lecturas de lo mismo. */
function cifrasDe(ordenes: Array<Record<string, unknown>>): string[] {
  const out = new Set<string>();
  const rec = (v: unknown, k = ''): void => {
    if (typeof v === 'string') {
      // La fecha y la hora se pueden escribir de muchas formas («a las 10», «10:00»): no cuentan como desacuerdo.
      if (!['descripcion_texto', 'notas_texto', 'titulo_texto', 'fecha_texto', 'hora_texto'].includes(k)) for (const n of numerosDelMensaje(v)) out.add(String(Math.round(n * 100) / 100));
    } else if (Array.isArray(v)) v.forEach((x) => rec(x, k));
    else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v as Record<string, unknown>)) rec(x, kk);
  };
  ordenes.forEach((o) => rec(o));
  return [...out].sort();
}

/**
 * ¿Dos lecturas del mismo mensaje dicen lo mismo? Mismos TIPOS de orden (con su cantidad: una lectura que ve dos órdenes y otra que ve una
 * es desacuerdo) y mismas CIFRAS. Los detalles opcionales (la obra, una descripción) pueden variar sin que sea un desacuerdo.
 */
export function lecturasCoinciden(a: SalidaTraductor, b: SalidaTraductor): boolean {
  const tipos = (s: SalidaTraductor) => ordenesDe(s).map((o) => String(o.accion)).sort().join(',');
  return tipos(a) === tipos(b) && cifrasDe(ordenesDe(a)).join(',') === cifrasDe(ordenesDe(b)).join(',');
}

/** Cómo se llama una orden al preguntar («el gasto de Saltoki (87,40)», «las 6 horas de Jon»). */
export function describirOrden(o: Record<string, unknown>): string {
  const t = (k: string) => (typeof o[k] === 'string' ? String(o[k]).trim() : '');
  switch (o.accion) {
    case 'GASTO':
      return `el gasto de ${t('proveedor_texto') || 'un proveedor'}${t('importe_texto') ? ` (${t('importe_texto')})` : ''}`;
    case 'HORAS':
      return `${t('horas_texto') ? `las ${t('horas_texto')} horas` : 'las horas'} de ${t('operario_texto') || 'otra persona'}`;
    case 'CITA_CREAR':
      return `la cita${t('cliente_texto') ? ` con ${t('cliente_texto')}` : ''}${t('fecha_texto') ? ` ${t('fecha_texto')}` : ''}`;
    case 'DIARIO':
      return `la nota del diario${t('obra_texto') ? ` de ${t('obra_texto')}` : ''}`;
    case 'CREAR_FACTURA':
      return `la factura${t('cliente_texto') ? ` a ${t('cliente_texto')}` : ''}${t('importe_texto') ? ` (${t('importe_texto')})` : ''}`;
    case 'PRESUPUESTO_DICTADO':
      return `el presupuesto nuevo${t('cliente_texto') ? ` para ${t('cliente_texto')}` : ''}`;
    case 'PRESUPUESTO_PARTIDAS':
      return `el cambio en el presupuesto${t('presupuesto_texto') ? ` de ${t('presupuesto_texto')}` : ''}`;
    default:
      return etiquetaOrden(o);
  }
}

/**
 * IDEA 4. Para las órdenes que ESCRIBEN, el mensaje se lee dos veces (la segunda con las opciones en orden inverso). Si las dos lecturas
 * coinciden, se sigue. Si no, no se guarda la mitad: se pregunta («¿Apunto el gasto de Saltoki y también las 6 horas de Jon?») con el
 * plan más completo de las dos. Las consultas y la charla se leen una sola vez.
 */
export async function traducirMensaje(e: EntradaTraductor): Promise<SalidaTraductor> {
  const a = await leer(e);
  if (!e.dobleLectura || e.tarea || e.invertir || !escribe(a)) return a;
  let b: SalidaTraductor;
  try {
    b = await leer({ ...e, invertir: true });
  } catch {
    return a; // la segunda lectura no pudo hacerse: no se bloquea lo que ya se entendió
  }
  if (lecturasCoinciden(a, b)) return a;
  const completa = ordenesDe(b).filter((o) => !NO_ESCRIBEN.test(String(o.accion))).length > ordenesDe(a).filter((o) => !NO_ESCRIBEN.test(String(o.accion))).length ? b : a;
  const plan = ordenesDe(completa).filter((o) => !NO_ESCRIBEN.test(String(o.accion)));
  if (!plan.length) return a;
  const vistos = new Set<string>();
  const unicos = plan.filter((o) => {
    const k = claveOrden(o);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  logJev('lecturas_distintas', { a: ordenesDe(a).map((o) => String(o.accion)).join(','), b: ordenesDe(b).map((o) => String(o.accion)).join(',') });
  const lista = unicos.map(describirOrden);
  const pregunta = lista.length > 1 ? `¿Apunto ${lista.slice(0, -1).join(', ')} y también ${lista[lista.length - 1]}?` : `¿Apunto ${lista[0]}?`;
  return { ...a, desacuerdo: { pregunta, ordenes: unicos as OrdenCruda[] } };
}
