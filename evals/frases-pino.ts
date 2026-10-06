/**
 * Frases tal y como las diría Pino, con lo que debería hacer el agente.
 *
 * Se usan en dos sitios:
 *  - `__tests__/agente.evals-simuladas.test.ts`: con OpenAI SIMULADO (el mock devuelve la tool y los
 *    argumentos esperados) para comprobar todo lo que hace el SERVIDOR alrededor: que la tool está
 *    disponible, que el guardarraíl no la bloquea, que se pide confirmación o se ofrecen opciones, y
 *    que el número o nombre se resuelve al id del negocio correcto.
 *  - `evals/agente.eval.ts` (`npm run eval:agente`): con el modelo REAL, para medir si de verdad
 *    elige la tool correcta.
 */
import { IDS } from './base-simulada';

export type ComportamientoAgente = 'pide_confirmacion' | 'ejecuta' | 'pregunta_opciones' | 'solo_lectura';

export type CasoAgente = {
  /** La frase de Pino. */
  frase: string;
  /** Lo que devolvería el clasificador Jev (si no se indica, intención «general»). */
  intencionJev?: string;
  /** La tool que debe estar disponible y elegirse (sin ella: el modelo no llama a ninguna). */
  toolEsperada?: string;
  /** Argumentos con los que el modelo (simulado) la llama. */
  argsEsperados?: Record<string, unknown>;
  comportamiento: ComportamientoAgente;
  /** (Solo tests) id al que debe resolverse la acción pendiente: comprueba el aislamiento entre negocios. */
  resueltoA?: Record<string, string>;
  /** (Solo tests) texto que debe aparecer en la respuesta al usuario. */
  respuestaContiene?: string[];
  /** Nota para quien lea el caso. */
  nota?: string;
};

export const CASOS_FRASES_PINO: CasoAgente[] = [
  {
    frase: 'Apúntame una visita mañana a las 10 con Ane en Olabide',
    intencionJev: 'agenda',
    toolEsperada: 'crear_recordatorio',
    argsEsperados: { titulo: 'Visita con Ane en Olabide', fecha_relativa: 'mañana', hora: '10:00' },
    comportamiento: 'pide_confirmacion',
    respuestaContiene: ['Visita con Ane en'],
  },
  {
    frase: 'Hazme un presupuesto para Paqui: alicatar el baño, 12 metros a 40 euros',
    intencionJev: 'presupuesto',
    toolEsperada: 'generar_presupuesto_por_dictado',
    argsEsperados: { cliente_nombre: 'Paqui', dictado: 'alicatar el baño, 12 metros a 40 euros' },
    comportamiento: 'pide_confirmacion',
    respuestaContiene: ['Alicatado'],
  },
  {
    frase: 'Pon una partida de pintura de 30 metros a 8 euros en el presupuesto de Paqui',
    intencionJev: 'presupuesto',
    toolEsperada: 'agregar_partida_borrador',
    argsEsperados: { descripcion: 'Pintura', cantidad: 30, unidad: 'm2', precio_unitario: 8, cliente_nombre: 'Paqui' },
    comportamiento: 'ejecuta',
    nota: 'Dentro de un borrador no se pide confirmación: la confirmación real es confirmar_borrador.',
  },
  {
    frase: 'Anota en el diario de la obra de Paqui que hoy se ha picado el baño',
    intencionJev: 'diario',
    toolEsperada: 'crear_entrada_diario',
    argsEsperados: { obra_nombre: 'Reforma Paqui', texto: 'Hoy se ha picado el baño' },
    comportamiento: 'pide_confirmacion',
    resueltoA: { obra_id: IDS.obraPaqui },
    nota: 'Hay otra «Reforma Paqui» en otro negocio: debe resolverse a la del negocio de Pino.',
  },
  {
    frase: 'Apunta en el diario de Olabide que ha llegado el material',
    intencionJev: 'diario',
    toolEsperada: 'crear_entrada_diario',
    argsEsperados: { obra_nombre: 'Olabide', texto: 'Ha llegado el material' },
    comportamiento: 'pregunta_opciones',
    respuestaContiene: ['Olabide 9', 'Olabide 12'],
  },
  {
    frase: 'Hazme la factura del presupuesto 7',
    intencionJev: 'factura',
    toolEsperada: 'convertir_presupuesto_a_factura',
    argsEsperados: { numero: 7 },
    comportamiento: 'pide_confirmacion',
    resueltoA: { presupuesto_id: IDS.presupuesto7 },
    respuestaContiene: ['nº 7', 'Paqui'],
    nota: 'El presupuesto nº 7 del otro negocio no debe confundirse.',
  },
  {
    frase: 'Hazme la factura del presupuesto de García',
    intencionJev: 'factura',
    toolEsperada: 'convertir_presupuesto_a_factura',
    argsEsperados: { query: 'García' },
    comportamiento: 'pregunta_opciones',
    respuestaContiene: ['García Norte', 'García Sur'],
  },
  {
    frase: 'Mándame el PDF de la factura 3',
    intencionJev: 'factura',
    toolEsperada: 'obtener_enlace_pdf_factura',
    argsEsperados: { numero: 3 },
    comportamiento: 'solo_lectura',
    respuestaContiene: ['Descargar PDF'],
    resueltoA: { factura_id: IDS.factura3 },
  },
  {
    frase: 'Ponle 8 horas a Iker en lo de Paqui',
    intencionJev: 'horas',
    toolEsperada: 'registrar_jornada',
    argsEsperados: { operario_nombre: 'Iker', obra_nombre: 'Paqui', horas: 8 },
    comportamiento: 'pide_confirmacion',
    respuestaContiene: ['Iker Etxeberria'],
  },
  {
    frase: 'Ponle 5 horas a Mikel en lo de Paqui',
    intencionJev: 'horas',
    toolEsperada: 'registrar_jornada',
    argsEsperados: { operario_nombre: 'Mikel', obra_nombre: 'Paqui', horas: 5 },
    comportamiento: 'pregunta_opciones',
    respuestaContiene: ['Mikel Goñi', 'Mikel Ruiz'],
  },
  {
    frase: '¿Qué obras tengo activas?',
    intencionJev: 'obras',
    toolEsperada: 'buscar_obra',
    argsEsperados: {},
    comportamiento: 'solo_lectura',
  },
  {
    frase: '¿Qué facturas tengo pendientes de cobro?',
    intencionJev: 'factura',
    toolEsperada: 'obtener_facturas_pendientes',
    argsEsperados: {},
    comportamiento: 'solo_lectura',
  },
  {
    frase: 'Enséñame los presupuestos que tengo pendientes',
    intencionJev: 'presupuesto',
    toolEsperada: 'obtener_presupuestos_pendientes',
    argsEsperados: {},
    comportamiento: 'solo_lectura',
  },
  {
    frase: 'Pasa el presupuesto 7 a rechazado',
    intencionJev: 'presupuesto',
    toolEsperada: 'cambiar_estado_presupuesto',
    argsEsperados: { numero: 7, estado: 'rechazado' },
    comportamiento: 'pide_confirmacion',
    resueltoA: { presupuesto_id: IDS.presupuesto7 },
  },
  {
    frase: 'Anota esto',
    intencionJev: 'diario',
    comportamiento: 'solo_lectura',
    nota: 'Sin obra ni contenido el modelo debe preguntar, no llamar a ninguna tool.',
  },
  {
    frase: 'Hola, buenas',
    comportamiento: 'solo_lectura',
    nota: 'Un saludo no dispara ninguna tool.',
  },
  {
    frase: 'Sí',
    toolEsperada: 'convertir_presupuesto_a_factura',
    argsEsperados: { presupuesto_id: IDS.presupuesto7 },
    comportamiento: 'ejecuta',
    nota: 'Confirmación tras una acción pendiente: el panel reenvía confirmar_accion y el servidor la ejecuta.',
  },
];
