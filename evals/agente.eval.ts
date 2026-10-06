/**
 * Eval OPCIONAL contra el modelo REAL de OpenAI (no entra en `npm test` ni en CI).
 *
 *   OPENAI_API_KEY=sk-... npm run eval:agente
 *
 * Qué hace: para cada frase de `evals/frases-pino.ts` llama de verdad al modelo de `AGENTE_MODELO`
 * (por defecto gpt-4o-mini) con el MISMO prompt de sistema y las MISMAS tools que el agente, sobre
 * el negocio simulado de `evals/base-simulada.ts` (nunca la base real), y mira si elige la tool
 * esperada. Imprime una tabla frase → tool elegida → OK/KO y falla solo si el acierto baja del
 * umbral `EVAL_UMBRAL` (por defecto 0,8).
 *
 * Sin `JEV_API_KEY` la intención sale del respaldo local por palabras clave (`intentPorPalabrasClave`),
 * igual que en el servidor; si tampoco acierta, «general» (todas las tools): cota pesimista.
 */
import OpenAI from 'openai';
import { modeloAgente, parametrosGeneracion } from '@/lib/agente/modelo';
import type { JevIntentCategory } from '@/lib/agente/router';
import { CASOS_FRASES_PINO } from './frases-pino';
import { IDS, NEGOCIO_A, crearBaseSimulada } from './base-simulada';

const hayClave = Boolean(process.env.OPENAI_API_KEY?.trim());
const umbral = Number(process.env.EVAL_UMBRAL ?? '0.8');

/**
 * Los módulos del agente crean un cliente de OpenAI al cargarse y fallan sin `OPENAI_API_KEY`:
 * por eso se importan aquí dentro (solo cuando hay clave) y no arriba del fichero.
 */
async function cargarAgente() {
  const [documentos, obras, agenda, gastos, diario, operarios, presupuestos, enlaces, router, prompt, orq] = await Promise.all([
    import('@/lib/agente/modules/documentos'),
    import('@/lib/agente/modules/obras-clientes'),
    import('@/lib/agente/modules/agenda'),
    import('@/lib/agente/modules/gastos'),
    import('@/lib/agente/modules/diario'),
    import('@/lib/agente/modules/operarios'),
    import('@/lib/agente/modules/presupuestos'),
    import('@/lib/agente/modules/enlaces-pdf'),
    import('@/lib/agente/router'),
    import('@/lib/agente/prompt-sistema'),
    import('@/lib/agente/orquestacion'),
  ]);
  const tools = [
    ...documentos.DOCUMENTOS_AGENT_TOOLS,
    ...obras.OBRAS_CLIENTES_AGENT_TOOLS,
    ...agenda.AGENDA_AGENT_TOOLS,
    ...gastos.GASTOS_AGENT_TOOLS,
    ...diario.DIARIO_AGENT_TOOLS,
    ...operarios.OPERARIOS_AGENT_TOOLS,
    ...presupuestos.PRESUPUESTOS_AGENT_TOOLS,
    ...enlaces.ENLACES_PDF_AGENT_TOOLS,
  ];
  return { tools, router, construirPromptSistema: prompt.construirPromptSistema, temperatura: orq.AGENTE_TOOLS_TEMPERATURE };
}

function contextoNegocio(construirPromptSistema: (c: import('@/lib/agente/prompt-sistema').ContextoPromptSistema) => string): string {
  const base = crearBaseSimulada();
  const obras = base.obras
    .filter((o) => o.business_id === NEGOCIO_A)
    .map((o) => `- ${o.nombre} (id: ${o.id})${o.direccion ? ', dir: ' + o.direccion : ''}`)
    .join('\n');
  const clientes = base.clientes
    .filter((c) => c.business_id === NEGOCIO_A)
    .map((c) => `- ${c.nombre} (id: ${c.id})`)
    .join('\n');
  const operarios = base.operarios.map((o) => o.nombre).join(', ');
  return construirPromptSistema({
    nombre: 'Pino Albañilería',
    sector: 'Reformas',
    descripcion: '',
    servicios: '',
    tarifas: '',
    contextoAdicional: '',
    ubicacionMeteoPrompt: '',
    ahora: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
    fechaActual: new Date().toLocaleDateString('es-ES'),
    obrasCtx: `\nOBRAS ABIERTAS ACTUALES:\n${obras}`,
    clientesCtx: `\nCLIENTES REGISTRADOS:\n${clientes}`,
    bloqueOperarios: `Los operarios de este negocio son: ${operarios}.`,
    agendaContextoPrimerMensaje: '',
    memoriaNegocioBlock: '',
  });
}

const describeEval = hayClave ? describe : describe.skip;
if (!hayClave) {
  console.warn('[eval:agente] OPENAI_API_KEY no está definida: se salta la eval contra el modelo real.');
}
if (!process.env.JEV_API_KEY?.trim()) {
  console.warn('[eval:agente] Sin JEV_API_KEY se usa el respaldo local por palabras clave para la intención.');
}

describeEval(`eval del agente contra ${modeloAgente()} (umbral ${umbral})`, () => {
  it('acierta la tool en al menos el umbral de frases', async () => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const modelo = modeloAgente();
    const { tools: TOOLS, router, construirPromptSistema, temperatura } = await cargarAgente();
    const sistema = contextoNegocio(construirPromptSistema);
    // «Sí» necesita el contexto de una acción pendiente: no se puede medir en una sola frase.
    const casos = CASOS_FRASES_PINO.filter((c) => c.frase !== 'Sí');
    const filas: Array<{ frase: string; esperada: string; elegida: string; ok: boolean }> = [];

    for (const caso of casos) {
      // Con Jev el servidor recorta las tools por intención; aquí se hace igual si hay categoría.
      const intencion = caso.intencionJev as JevIntentCategory | undefined;
      // Sin Jev, el servidor usa el respaldo local por palabras clave: aquí también.
      const categoria = process.env.JEV_API_KEY
        ? intencion && router.JEV_TO_AGENT_INTENT[intencion]
        : router.intentPorPalabrasClave(caso.frase);
      const tools = categoria ? router.toolsForAgentIntent(categoria, TOOLS) : TOOLS;
      const r = await openai.chat.completions.create({
        model: modelo,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: caso.frase },
        ],
        tools: tools.length > 0 ? tools : TOOLS,
        tool_choice: 'auto',
        ...parametrosGeneracion(modelo, { maxTokens: 800, temperature: temperatura }),
      });
      const llamadas = (r.choices[0]?.message?.tool_calls ?? []).flatMap((c) => (c.type === 'function' ? [c.function.name] : []));
      const elegida = llamadas[0] ?? '(ninguna)';
      const esperada = caso.toolEsperada ?? '(ninguna)';
      filas.push({ frase: caso.frase, esperada, elegida, ok: elegida === esperada });
    }

    const aciertos = filas.filter((f) => f.ok).length;
    const acierto = aciertos / filas.length;
    console.log(
      ['', `Modelo: ${modelo}`, ...filas.map((f) => `${f.ok ? 'OK' : 'KO'}  ${f.frase.slice(0, 55).padEnd(55)}  esperada: ${f.esperada}  elegida: ${f.elegida}`), `Acierto: ${aciertos}/${filas.length} (${(acierto * 100).toFixed(0)} %)`, ''].join('\n')
    );
    // IDS se importa para que el eval y los tests compartan semilla; se evita el aviso de import sin uso.
    void IDS;
    expect(acierto).toBeGreaterThanOrEqual(umbral);
  });
});
