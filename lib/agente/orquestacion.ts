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

const NEGACION_EXPLICITA = /^(no|cancela|cancelar|d[eé]jalo|olv[ií]dalo|para|mejor\s+no)[\s!.]*$/i;

const VERBOS_ACCION =
  /\b(registr(?:a|ar|o)|crea(?:r)?|a[nñ]ad(?:e|ir)|agreg(?:a|ar)|list(?:a|ar)|muestr(?:a|ame)|ens(?:e|é)[nñ](?:a|ame)|busca(?:r)?|consult(?:a|ar)|elimin(?:a|ar)|borr(?:a|ar)|cambi(?:a|ar)|edit(?:a|ar)|gener(?:a|ar)|confirm(?:a|ar)|guard(?:a|ar)|anot(?:a|ar)|apunt(?:a|ar)|calcul(?:a|ar)|env[ií]a(?:r)?|lee(?:r)?|abr(?:e|ir)|convert(?:i[r]?|ir)|vincul(?:a|ar)|actualiz(?:a|ar)|marc(?:a|ar)|ficha(?:r)?|dict(?:a|ar))\w*/i;

const SENAL_DOMINIO_ACCION =
  /\b(horas|jornada|diario|partida[s]?|presupuesto[s]?|factura[s]?|albar[aá]n(?:es)?|ticket|gasto[s]?|recordatorio[s]?|agenda|operario[s]?|obra[s]?)\b/i;

/**
 * Heurística de un solo reintento: el mensaje parece pedir una acción
 * (no es solo un saludo / cortesía).
 */
/** «sí», «adelante», «hazlo»…: respuesta afirmativa corta a una pregunta de confirmación. */
export function esRespuestaAfirmativa(mensaje: string): boolean {
  return CONFIRMACION_EXPLICITA.test(mensaje.trim());
}

/** «no», «cancela», «déjalo»…: rechazo corto a una pregunta de confirmación. */
export function esRespuestaNegativa(mensaje: string): boolean {
  return NEGACION_EXPLICITA.test(mensaje.trim());
}

export function pareceAccionQueRequiereTool(mensaje: string): boolean {
  const t = mensaje.trim();
  if (!t) return false;
  if (SOLO_SALUDO.test(t)) return false;
  if (CONFIRMACION_EXPLICITA.test(t)) return true;
  if (VERBOS_ACCION.test(t)) return true;
  return SENAL_DOMINIO_ACCION.test(t) && t.split(/\s+/).length >= 3;
}

/**
 * ¿El texto promete hacer algo («voy a comprobar la agenda», «un momento…») en vez de hacerlo? Si el
 * modelo responde así SIN llamar a ninguna tool, el usuario se queda esperando algo que no va a llegar.
 */
const PROMESA_SIN_HACER =
  /\b(voy a (comprobar|mirar|revisar|buscar|consultar|ver|verificar|apuntar|crear|preparar|registrar)|un momento|un segundo|d[eé]jame (ver|mirar|comprobar|revisar|buscar)|ahora (mismo )?(compruebo|miro|reviso|busco)|enseguida)\b/i;

export function prometeSinHacer(texto: string): boolean {
  const t = texto.trim();
  // Una respuesta larga con datos no es una promesa vacía; las promesas son frases cortas.
  return t.length > 0 && t.length <= 280 && PROMESA_SIN_HACER.test(t);
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

const PREFIJO_MUTACION =
  /^(crear_|actualizar_|modificar_|guardar_|registrar_|confirmar_|convertir_|agregar_|editar_|vincular_|asociar_|cambiar_estado_|eliminar_|borrar_|iniciar_)/;

export function esToolMutacion(name: string): boolean {
  return PREFIJO_MUTACION.test(String(name ?? ''));
}

export function esResultadoToolExito(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  if (o.ok === true) return true;
  if (o.ok === false) return false;
  if (typeof o.error === 'string' && o.error.trim()) return false;
  if (o.necesita_aclaracion === true) return false;
  if (o.pendiente_precio === true || o.pendiente_confirmacion === true) return false;
  return true;
}

export function esResultadoToolFallo(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  if (o.ok === false) return true;
  if (typeof o.error === 'string' && o.error.trim()) return true;
  return false;
}

export function esResultadoToolPendiente(result: unknown): boolean {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return false;
  const o = result as Record<string, unknown>;
  return o.pendiente_precio === true || o.pendiente_confirmacion === true || o.necesita_aclaracion === true;
}

export type HechoMutacion = { tool: string; result: unknown };

export type HechosMutacion = {
  exitos: HechoMutacion[];
  fallos: HechoMutacion[];
  pendientes: HechoMutacion[];
};

export function hechosMutacionDesdeEjecutado(
  executed: Array<{ tool: string; result: unknown }>
): HechosMutacion {
  const exitos: HechoMutacion[] = [];
  const fallos: HechoMutacion[] = [];
  const pendientes: HechoMutacion[] = [];
  for (const e of executed) {
    if (!esToolMutacion(e.tool)) continue;
    if (esResultadoToolExito(e.result)) exitos.push({ tool: e.tool, result: e.result });
    else if (esResultadoToolPendiente(e.result)) pendientes.push({ tool: e.tool, result: e.result });
    else if (esResultadoToolFallo(e.result)) fallos.push({ tool: e.tool, result: e.result });
  }
  return { exitos, fallos, pendientes };
}

function errorDeResultado(result: unknown): string {
  if (result != null && typeof result === 'object' && !Array.isArray(result)) {
    const o = result as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
    if (typeof o.mensaje === 'string' && o.mensaje.trim()) return o.mensaje.trim();
  }
  return 'No se pudo completar la acción.';
}

export type OpcionAclaracion = { n: number; id: string; etiqueta: string };

type CandidatoLike = { id?: unknown; etiqueta?: unknown };

function candidatosDeResultado(result: unknown): Array<{ id: string; etiqueta: string }> {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return [];
  const o = result as Record<string, unknown>;
  if (o.necesita_aclaracion !== true || !Array.isArray(o.candidatos)) return [];
  const out: Array<{ id: string; etiqueta: string }> = [];
  for (const c of o.candidatos as CandidatoLike[]) {
    const id = typeof c?.id === 'string' ? c.id : '';
    const etiqueta = typeof c?.etiqueta === 'string' ? c.etiqueta.trim() : '';
    if (id && etiqueta) out.push({ id, etiqueta });
  }
  return out.slice(0, 8);
}

/**
 * Texto de una pregunta de aclaración: el mensaje de la tool y, si aún no va en él, la lista
 * numerada de opciones (nombre + el dato que las distingue: dirección, importe, nº…).
 */
export function textoAclaracion(result: unknown): string {
  const base = errorDeResultado(result);
  const cands = candidatosDeResultado(result);
  if (cands.length === 0) return base;
  if (base.includes(cands[0]!.etiqueta)) return base; // la tool ya trae la lista
  const lista = cands.map((c, i) => `${i + 1}. ${c.etiqueta}`).join('\n');
  return `${base}\n${lista}`;
}

/** Opciones numeradas de todas las aclaraciones de un turno (para resolver «la 2» por id). */
export function opcionesDeResultados(results: unknown[]): OpcionAclaracion[] {
  const out: OpcionAclaracion[] = [];
  for (const r of results) {
    for (const c of candidatosDeResultado(r)) out.push({ n: out.length + 1, id: c.id, etiqueta: c.etiqueta });
  }
  return out;
}

const RE_MARCA_OPCIONES = /<!--opciones:(\{[\s\S]*?\})-->/;

/**
 * Comentario HTML invisible que se añade al final de la respuesta con las opciones y sus ids. El panel
 * no lo pinta (react-markdown ignora los comentarios) pero sí viaja en el historial, y así «la 2» se
 * puede resolver al id exacto en el turno siguiente sin que el modelo tenga que acordarse.
 */
export function marcaOpcionesParaHistorial(opciones: OpcionAclaracion[]): string {
  if (opciones.length === 0) return '';
  const mapa: Record<string, { id: string; etiqueta: string }> = {};
  for (const o of opciones) mapa[String(o.n)] = { id: o.id, etiqueta: o.etiqueta };
  return `\n<!--opciones:${JSON.stringify(mapa)}-->`;
}

export function quitarMarcaOpciones(texto: string): string {
  return texto.replace(/\n?<!--opciones:\{[\s\S]*?\}-->/g, '');
}

/**
 * Si el último mensaje del asistente ofreció opciones y el usuario contesta «la 2», «2», «la segunda»,
 * «opción 2» o con el texto de una etiqueta, devuelve el mensaje reescrito con el id exacto.
 */
export function resolverEleccionOpcion(mensaje: string, ultimoAsistente: string | undefined): string | null {
  const m = RE_MARCA_OPCIONES.exec(ultimoAsistente ?? '');
  if (!m) return null;
  let mapa: Record<string, { id?: string; etiqueta?: string }>;
  try {
    mapa = JSON.parse(m[1]!) as typeof mapa;
  } catch {
    return null;
  }
  const t = mensaje.trim().toLowerCase();
  const ordinales: Record<string, number> = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
  let n: number | null = null;
  const num = /^(?:la|el|opci[oó]n|la opci[oó]n|n[uú]mero)?\s*(\d)\s*[.!]?$/.exec(t);
  if (num) n = Number(num[1]);
  else {
    const ord = /^(?:la|el)\s+(primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto)\s*[.!]?$/.exec(t);
    if (ord) n = ordinales[ord[1]!] ?? null;
  }
  let elegida = n != null ? mapa[String(n)] : undefined;
  if (!elegida) {
    // «la de Olabide»: solo si el texto aparece en UNA etiqueta.
    const trozo = /^(?:la|el)\s+de\s+(.+?)\s*[.!]?$/.exec(t)?.[1];
    if (trozo) {
      const hits = Object.values(mapa).filter((o) => (o.etiqueta ?? '').toLowerCase().includes(trozo));
      if (hits.length === 1) elegida = hits[0];
    }
  }
  if (!elegida?.id) return null;
  return `Elijo esta opción: ${elegida.etiqueta ?? ''} (id exacto: ${elegida.id}). Continúa con lo que te pedí usando ese id.`;
}

export function prosaFailClosedDesdeHechos(hechos: HechosMutacion): string {
  const partes = hechos.fallos.map((f) => errorDeResultado(f.result));
  const unico = [...new Set(partes.filter(Boolean))];
  if (unico.length === 0) {
    return 'No he encontrado ese cliente ni ese presupuesto. No he añadido ninguna partida ni he creado ficha ni presupuesto.';
  }
  return unico.join('\n');
}

/** Si todas las mutaciones fallaron (y no hay pendientes), la prosa no pasa por el modelo. */
export function prosaFailClosedSiAplica(hechos: HechosMutacion): string | null {
  if (hechos.fallos.length === 0) return null;
  if (hechos.exitos.length > 0) return null;
  if (hechos.pendientes.length > 0) return null;
  return prosaFailClosedDesdeHechos(hechos);
}

/** Fail-closed o pregunta de aclaración: no dejar que el modelo invente éxito. */
export function prosaAncladaDirectaSiAplica(hechos: HechosMutacion): string | null {
  const fail = prosaFailClosedSiAplica(hechos);
  if (fail) return fail;
  if (hechos.exitos.length > 0) return null;
  if (hechos.pendientes.length === 0) return null;
  const partes = hechos.pendientes.map((p) => textoAclaracion(p.result));
  const unico = [...new Set(partes.filter(Boolean))];
  return unico.length > 0 ? unico.join('\n') : null;
}

export function buildMensajeSistemaProsaAnclada(hechos: HechosMutacion): string {
  const exitos = hechos.exitos.map((e) => ({
    tool: e.tool,
    ok: true,
    resumen: resumirToolResultParaLog(e.result),
  }));
  const fallos = hechos.fallos.map((e) => ({
    tool: e.tool,
    ok: false,
    error: errorDeResultado(e.result),
  }));
  return `ANCLAJE DE PROSA (obligatorio):
Solo puedes afirmar mutaciones que estén en ÉXITOS (ok:true). Si una tool falló o no encontró la entidad, dilo en castellano. PROHIBIDO narrar que has añadido, creado, editado o vinculado nada que no aparezca en ÉXITOS. No inventes IDs, clientes, obras ni presupuestos.
ÉXITOS: ${JSON.stringify(exitos)}
FALLOS: ${JSON.stringify(fallos)}`;
}

const RE_EXITO_INVENTADO =
  /\b(a[nñ]adid[oa]|he a[nñ]adido|partida a[nñ]adida|presupuesto creado|cliente creado|listo[,:]?\s+a[nñ]ad)/i;

/**
 * Red de seguridad: si el modelo afirma éxito y no hay mutación ok:true, sustituye por fail-closed.
 */
export function anclarProsaAHechos(prosaModelo: string, hechos: HechosMutacion): string {
  const t = String(prosaModelo ?? '').trim();
  const fail = prosaFailClosedSiAplica(hechos);
  if (fail) return fail;
  if (hechos.exitos.length === 0 && RE_EXITO_INVENTADO.test(t)) {
    return (
      prosaFailClosedDesdeHechos(hechos) ||
      'No he podido confirmar esa acción en el sistema. No he añadido ni creado nada.'
    );
  }
  return t || prosaModelo;
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
