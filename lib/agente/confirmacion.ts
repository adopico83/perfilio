import type { SupabaseClient } from '@supabase/supabase-js';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';
import { resolverClientesPorNombre, resolverObrasPorNombre, resolverPresupuestosPorTexto, resultadoResolveATool, toolFailDesdePresupuestoResolve } from '@/lib/agente/modules/grounding';
import { describirDocumento, localizarDesdeArgs, type TipoDocumento } from '@/lib/agente/modules/documentos-localizar';
import { requiereValidacionCreacion, validarCreacionDocumento } from '@/lib/agente/modules/documentos-validacion';
import { parseEstadoFactura, MENSAJE_ESTADO_FACTURA } from '@/lib/facturas/estado';
import { ESTADOS_FACTURABLES, MENSAJE_ESTADO_PRESUPUESTO, parseEstadoPresupuesto } from '@/lib/presupuestos/estado';
import { parseFechaNatural, ymdHoyMadrid } from '@/lib/fechas-madrid';
import { construirCambiosCliente } from '@/lib/clientes/cambios';
import { IVA_PORCENTAJES_PERMITIDOS } from '@/lib/facturas/iva';
import { ESTADOS_ALBARAN_EDITABLES, esFacturado } from '@/lib/albaranes/estado';

/**
 * CONFIRMACIÓN ANTES DE CREAR O MODIFICAR DATOS — barrera en el SERVIDOR.
 *
 * Antes la única protección era una frase del prompt («pide confirmación antes de…»), y un modelo
 * pequeño se la salta. Ahora, cuando el modelo pide una tool de esta lista, `/api/agente` NO la
 * ejecuta: la prepara (resuelve ids reales, redacta un resumen) y devuelve `accion_pendiente`. El
 * panel enseña «Sí, hazlo / No» y, si el usuario acepta, reenvía `confirmar_accion`; entonces el
 * servidor la ejecuta directamente, sin volver a pasar por el modelo.
 */

/** Toda tool que crea, modifica, borra o envía datos del negocio. Una sola lista, fácil de revisar. */
export const TOOLS_REQUIEREN_CONFIRMACION: ReadonlySet<string> = new Set([
  // Facturas, albaranes y presupuestos
  'crear_factura',
  'cambiar_estado_factura',
  'editar_factura',
  'convertir_albaran_a_factura',
  'crear_albaran',
  'cambiar_estado_albaran',
  'editar_albaran',
  'crear_presupuesto',
  'generar_presupuesto_por_dictado',
  'cambiar_estado_presupuesto',
  'editar_presupuesto',
  'vincular_presupuesto_cliente',
  'convertir_presupuesto_a_albaran',
  'convertir_presupuesto_a_factura',
  'registrar_extra',
  'modificar_partidas_presupuesto',
  'gestionar_tarifas',
  // Clientes y obras
  'crear_cliente',
  'actualizar_cliente',
  'crear_obra',
  'actualizar_obra',
  'asociar_documentos_a_obra',
  // Horas
  'registrar_jornada',
  'eliminar_registro_jornada',
  // Diario
  'crear_entrada_diario',
  'eliminar_entrada_diario',
  // Agenda
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
  // Gastos
  'registrar_gasto_ticket',
  'crear_proveedor',
  'vincular_gasto',
  'modificar_gasto',
  'eliminar_gasto',
]);

/**
 * Tools que escriben datos pero NO pasan por la barrera, y por qué. Un test comprueba que toda tool
 * de escritura del agente está en una de las dos listas (así una tool nueva no se cuela sin decidir).
 */
export const TOOLS_EXENTAS_CONFIRMACION: Readonly<Record<string, string>> = {
  iniciar_borrador_presupuesto: 'Dentro de un borrador: la confirmación real es confirmar_borrador.',
  agregar_partida_borrador: 'Dentro de un borrador: la confirmación real es confirmar_borrador.',
  modificar_partida_borrador: 'Dentro de un borrador: la confirmación real es confirmar_borrador.',
  eliminar_partida_borrador: 'Dentro de un borrador: la confirmación real es confirmar_borrador.',
  cancelar_borrador: 'Descarta un borrador que aún no es un documento.',
  confirmar_borrador: 'Es la propia confirmación del borrador que el usuario ya ha visto en pantalla.',
  guardar_memoria: 'Su descripción ya dice «sin pedir confirmación» (preferencias duraderas).',
  eliminar_memoria: 'Solo olvida una nota de memoria que el usuario pide olvidar.',
  enviar_email: 'Tiene su propia tarjeta de aprobación en el panel (el correo no sale sin pulsar Enviar).',
};

/**
 * Tools que ya tienen su propio paso de vista previa (`solo_vista_previa`): el servidor lo reutiliza
 * para sacar el resumen real y las aclaraciones («¿cuál de estos operarios?») sin escribir nada.
 */
export const TOOLS_CON_VISTA_PREVIA: ReadonlySet<string> = new Set([
  'generar_presupuesto_por_dictado',
  'modificar_partidas_presupuesto',
  'registrar_jornada',
  'eliminar_registro_jornada',
  'eliminar_entrada_diario',
  'crear_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
  'registrar_gasto_ticket',
  'modificar_gasto',
  'eliminar_gasto',
]);

export type AccionPendiente = {
  tool: string;
  args: Record<string, unknown>;
  /** Una frase con lo que se va a hacer, con los datos reales ya resueltos. */
  resumen: string;
};

function esVistaPrevia(args: Record<string, unknown>): boolean {
  return args.solo_vista_previa === true || String(args.solo_vista_previa ?? '').toLowerCase() === 'true';
}

/**
 * Interruptor de emergencia: `AGENTE_CONFIRMACION=off` apaga la barrera (el agente vuelve a ejecutar
 * en el mismo turno, solo con la confirmación «de palabra» del prompt). Está para poder volver atrás
 * sin desplegar código si la barrera diera algún problema; NO debe usarse en el día a día.
 * Los tests de cada tool por separado (`api.agente.tools.test.ts`…) lo apagan porque comprueban lo
 * que hace la tool al ejecutarse; la barrera tiene sus propios tests (`agente.confirmacion.test.ts`).
 */
export function confirmacionActiva(): boolean {
  return process.env.AGENTE_CONFIRMACION?.trim().toLowerCase() !== 'off';
}

/** ¿Esta llamada del modelo debe esperar a que el usuario confirme? */
export function requiereConfirmacion(tool: string, args: Record<string, unknown>): boolean {
  if (!confirmacionActiva()) return false;
  if (!TOOLS_REQUIEREN_CONFIRMACION.has(tool)) return false;
  // Pedir la vista previa no escribe nada: se ejecuta.
  if (TOOLS_CON_VISTA_PREVIA.has(tool) && esVistaPrevia(args)) return false;
  // Listar tarifas es solo lectura.
  if (tool === 'gestionar_tarifas' && String(args.accion ?? '').toLowerCase() === 'listar') return false;
  return true;
}

/**
 * Valida lo que llega en `confirmar_accion` desde el navegador: solo tools de la lista blanca y
 * argumentos en forma de objeto. (El control de acceso al negocio lo hace la ruta.)
 */
export function validarAccionConfirmada(
  raw: unknown
): { ok: true; tool: string; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'confirmar_accion no es válida' };
  }
  const o = raw as Record<string, unknown>;
  const tool = typeof o.tool === 'string' ? o.tool.trim() : '';
  if (!TOOLS_REQUIEREN_CONFIRMACION.has(tool)) {
    return { ok: false, error: 'Esa acción no se puede confirmar desde aquí.' };
  }
  const args =
    o.args && typeof o.args === 'object' && !Array.isArray(o.args) ? (o.args as Record<string, unknown>) : {};
  return { ok: true, tool, args };
}

const NOMBRES_TOOL: Record<string, string> = {
  crear_factura: 'crear una factura',
  cambiar_estado_factura: 'cambiar el estado de una factura',
  editar_factura: 'editar una factura',
  convertir_albaran_a_factura: 'convertir un albarán en factura',
  crear_albaran: 'crear un albarán',
  cambiar_estado_albaran: 'cambiar el estado de un albarán',
  editar_albaran: 'editar un albarán',
  crear_presupuesto: 'crear un presupuesto',
  generar_presupuesto_por_dictado: 'crear el presupuesto del dictado',
  cambiar_estado_presupuesto: 'cambiar el estado de un presupuesto',
  editar_presupuesto: 'editar un presupuesto',
  vincular_presupuesto_cliente: 'vincular un presupuesto a un cliente',
  convertir_presupuesto_a_albaran: 'convertir un presupuesto en albarán',
  convertir_presupuesto_a_factura: 'crear la factura de un presupuesto',
  registrar_extra: 'registrar un extra',
  modificar_partidas_presupuesto: 'cambiar las partidas de un presupuesto',
  gestionar_tarifas: 'cambiar las tarifas',
  crear_cliente: 'crear un cliente',
  actualizar_cliente: 'actualizar la ficha de un cliente',
  crear_obra: 'crear una obra',
  actualizar_obra: 'actualizar una obra',
  asociar_documentos_a_obra: 'asociar documentos a una obra',
  registrar_jornada: 'registrar horas',
  eliminar_registro_jornada: 'borrar un registro de horas',
  crear_entrada_diario: 'anotar en el diario de obra',
  eliminar_entrada_diario: 'borrar una entrada del diario',
  crear_recordatorio: 'crear un recordatorio en la agenda',
  editar_recordatorio: 'editar un recordatorio',
  eliminar_recordatorio: 'borrar un recordatorio',
  eliminar_evento_agenda: 'borrar un evento de la agenda',
  modificar_evento_agenda: 'modificar un evento de la agenda',
  registrar_gasto_ticket: 'registrar un gasto',
  crear_proveedor: 'dar de alta un proveedor',
  vincular_gasto: 'vincular un gasto',
  modificar_gasto: 'modificar un gasto',
  eliminar_gasto: 'borrar un gasto',
};

/** Campos de los argumentos que merece la pena enseñar al usuario, con su etiqueta. */
const CAMPOS_LEGIBLES: Array<[string, string]> = [
  ['cliente_nombre', 'cliente'],
  ['cliente', 'cliente'],
  ['obra_nombre', 'obra'],
  ['operario_nombre', 'operario'],
  ['titulo', 'título'],
  ['descripcion', 'descripción'],
  ['texto', 'texto'],
  ['fecha', 'fecha'],
  ['fecha_relativa', 'fecha'],
  ['hora', 'hora'],
  ['horas', 'horas'],
  ['horas_reales', 'horas'],
  ['estado', 'estado'],
  ['total', 'total'],
  ['importe_total', 'importe'],
  ['importe', 'importe'],
  ['nombre', 'nombre'],
];

function valorLegible(v: unknown): string | null {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** Resumen genérico a partir de los argumentos: «Voy a crear un recordatorio (título: …, fecha: …)». */
export function describirAccionGenerica(tool: string, args: Record<string, unknown>): string {
  const que = NOMBRES_TOOL[tool] ?? `ejecutar «${tool}»`;
  const vistos = new Set<string>();
  const partes: string[] = [];
  for (const [clave, etiqueta] of CAMPOS_LEGIBLES) {
    const v = valorLegible(args[clave]);
    if (v == null || vistos.has(etiqueta)) continue;
    vistos.add(etiqueta);
    partes.push(`${etiqueta}: ${v}`);
  }
  return `Voy a ${que}${partes.length > 0 ? ` (${partes.join(', ')})` : ''}.`;
}

/**
 * Las vistas previas de las tools llevan, además del resumen para la persona, frases pensadas para el
 * MODELO («Si el usuario confirma, vuelve a llamar a… con solo_vista_previa false»). Aquí se quitan
 * para que el usuario solo lea lo que se va a hacer.
 */
export function limpiarTextoVistaPrevia(texto: string): string {
  return texto
    .split('\n')
    .filter((linea) => !/vuelve a llamar|solo_vista_previa|pide confirmaci[oó]n expl[ií]cita|si el usuario confirma/i.test(linea))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto de pregunta final para el usuario: el resumen y «¿Lo hago?» (salvo que ya pregunte). */
export function preguntaConfirmacion(resumen: string): string {
  const limpio = resumen.trim();
  return /\?\s*$/.test(limpio) ? limpio : `${limpio} ¿Lo hago?`;
}

export type PreparacionAccion =
  | { tipo: 'pendiente'; accion: AccionPendiente }
  | { tipo: 'resultado'; result: Record<string, unknown> };

function euros(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return 'sin importe';
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(n))} €`;
}

const TOOLS_DE_PRESUPUESTO_EXISTENTE = new Set([
  'convertir_presupuesto_a_factura',
  'convertir_presupuesto_a_albaran',
  'cambiar_estado_presupuesto',
  'editar_presupuesto',
]);

/**
 * Una factura exige NIF y dirección del cliente. Se comprueba ANTES de pedir el «sí» (si no, el usuario
 * confirmaba y fallaba después). Si faltan, se preguntan; el agente los guarda con `actualizar_cliente`.
 */
async function faltanDatosParaFacturar(
  supabase: SupabaseClient,
  businessId: string,
  presupuestoId: string
): Promise<Record<string, unknown> | null> {
  const { data: pres } = await supabase
    .from('presupuestos')
    .select('cliente_id, cliente_nombre')
    .eq('id', presupuestoId)
    .eq('business_id', businessId)
    .maybeSingle();
  const clienteId = String((pres as { cliente_id?: string | null } | null)?.cliente_id ?? '').trim();
  const nombrePres = String((pres as { cliente_nombre?: string | null } | null)?.cliente_nombre ?? '').trim();
  if (!clienteId) {
    return {
      ok: false,
      error: `Este presupuesto no está vinculado a ninguna ficha de cliente${nombrePres ? ` («${nombrePres}»)` : ''}, y una factura necesita su NIF y dirección. Dime a qué cliente corresponde (o créalo) y su NIF y dirección.`,
      faltan_datos_cliente: ['cliente', 'nif', 'direccion'],
    };
  }
  const { data: cli } = await supabase
    .from('clientes')
    .select('id, nombre, nif, direccion')
    .eq('id', clienteId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (!cli) return null; // lo dirá la propia conversión
  const c = cli as { id: string; nombre?: string | null; nif?: string | null; direccion?: string | null };
  const faltan: string[] = [];
  if (!String(c.nif ?? '').trim()) faltan.push('nif');
  if (!String(c.direccion ?? '').trim()) faltan.push('direccion');
  if (faltan.length === 0) return null;
  const quien = c.nombre ?? nombrePres ?? 'el cliente';
  const que = faltan.map((f) => (f === 'nif' ? 'el NIF' : 'la dirección')).join(' y ');
  return {
    ok: false,
    error: `Para facturar a ${quien} me falta ${que} (una factura necesita NIF y dirección). Dímelo y lo guardo en su ficha antes de facturar.`,
    faltan_datos_cliente: faltan,
    cliente_id: c.id,
  };
}

export type DepsPreparacion = {
  supabase: SupabaseClient;
  businessId: string;
  /** Ejecuta una tool del agente (la usa para pedir la vista previa de las que la tienen). */
  runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  mensajeUsuario: string;
  /** Últimos mensajes del usuario (para comprobar que un importe lo dijo él, aunque fuera un turno antes). */
  historialUsuario?: string[];
};

const TOOLS_DE_DOCUMENTO_EXISTENTE = new Set([
  'convertir_albaran_a_factura',
  'editar_factura',
  'cambiar_estado_factura',
  'editar_albaran',
  'cambiar_estado_albaran',
]);

function resultadoError(error: string): PreparacionAccion {
  return { tipo: 'resultado', result: { ok: false, error } };
}

/** Qué cambia una edición, en una frase («cliente: Ana, 2 líneas, IVA 10 %»). */
function cambiosLegibles(args: Record<string, unknown>): string {
  const partes: string[] = [];
  const c = valorLegible(args.cliente_nombre);
  if (c) partes.push(`cliente: ${c}`);
  if (Array.isArray(args.lineas)) partes.push(`${args.lineas.length} línea${args.lineas.length === 1 ? '' : 's'}`);
  if (args.iva_porcentaje != null) partes.push(`IVA ${String(args.iva_porcentaje)} %`);
  if (args.importe_total != null) partes.push(`importe ${euros(Number(args.importe_total))}`);
  const d = valorLegible(args.descripcion);
  if (d) partes.push(`descripción: «${d}»`);
  return partes.join(', ');
}

/**
 * Facturas y albaranes existentes: se localizan por id, número o cliente (el usuario no dice UUIDs) y
 * se comprueban las reglas ANTES de pedir el «sí» (así no se pregunta por algo que luego fallaría).
 * Varios candidatos → pregunta con opciones; ninguno → error claro.
 */
async function prepararDocumentoExistente(
  tool: string,
  args: Record<string, unknown>,
  deps: DepsPreparacion
): Promise<PreparacionAccion> {
  const tipo: TipoDocumento = tool === 'convertir_albaran_a_factura' || tool.endsWith('_albaran') ? 'albaran' : 'factura';
  const esConvertir = tool === 'convertir_albaran_a_factura';
  const locArgs = esConvertir ? { ...args, id: args.albaran_id ?? args.id, cliente: args.cliente ?? args.cliente_nombre } : args;
  const loc = await localizarDesdeArgs(deps.supabase, deps.businessId, tipo, locArgs, {
    excluirEstado: esConvertir ? 'facturado' : undefined,
  });
  if (!loc.ok) return { tipo: 'resultado', result: loc as unknown as Record<string, unknown> };
  const m = loc.match;
  const quien = describirDocumento(tipo, m);
  const estadoActual = String(m.estado ?? 'pendiente').toLowerCase();
  const limpios = { ...args };
  delete limpios.numero;
  delete limpios.cliente;

  switch (tool) {
    case 'convertir_albaran_a_factura': {
      if (esFacturado(m.estado)) return resultadoError(`El ${quien} ya está facturado. Si quieres ver su factura, pídemela por número.`);
      const iva = Number(args.iva ?? 21);
      if (!(IVA_PORCENTAJES_PERMITIDOS as readonly number[]).includes(iva)) {
        return resultadoError(`El IVA debe ser uno de: ${IVA_PORCENTAJES_PERMITIDOS.join(', ')}.`);
      }
      delete limpios.id;
      return {
        tipo: 'pendiente',
        accion: {
          tool,
          args: { ...limpios, albaran_id: m.id, iva },
          resumen: `Voy a facturar el ${quien} con IVA del ${iva} % (el total del albarán se toma con IVA incluido).`,
        },
      };
    }
    case 'cambiar_estado_factura': {
      const nuevo = parseEstadoFactura(args.estado);
      if (!nuevo) return resultadoError(MENSAJE_ESTADO_FACTURA);
      if (estadoActual === nuevo) return resultadoError(`La ${quien} ya está «${nuevo}».`);
      return {
        tipo: 'pendiente',
        accion: { tool, args: { ...limpios, id: m.id, estado: nuevo }, resumen: `Voy a cambiar la ${quien} de «${estadoActual}» a «${nuevo}».` },
      };
    }
    case 'cambiar_estado_albaran': {
      const nuevo = String(args.estado ?? '').trim().toLowerCase();
      if (nuevo === 'facturado') {
        return resultadoError('Un albarán no se marca como facturado a mano: para facturarlo pídeme «factúrame el albarán…» y creo su factura.');
      }
      if (!(ESTADOS_ALBARAN_EDITABLES as readonly string[]).includes(nuevo)) {
        return resultadoError(`El estado de un albarán debe ser uno de: ${ESTADOS_ALBARAN_EDITABLES.join(', ')}.`);
      }
      if (esFacturado(m.estado)) return resultadoError(`El ${quien} ya está facturado: no cambia de estado.`);
      if (estadoActual === nuevo) return resultadoError(`El ${quien} ya está «${nuevo}».`);
      return {
        tipo: 'pendiente',
        accion: { tool, args: { ...limpios, id: m.id, estado: nuevo }, resumen: `Voy a cambiar el ${quien} de «${estadoActual}» a «${nuevo}».` },
      };
    }
    case 'editar_albaran': {
      if (esFacturado(m.estado)) return resultadoError(`El ${quien} ya está facturado: no se puede editar.`);
      const cambios = cambiosLegibles(args);
      if (!cambios) return resultadoError('¿Qué quieres cambiar del albarán: el cliente, el importe o la descripción?');
      return { tipo: 'pendiente', accion: { tool, args: { ...limpios, id: m.id }, resumen: `Voy a modificar el ${quien} (${cambios}).` } };
    }
    case 'editar_factura': {
      if (estadoActual !== 'pendiente') return resultadoError(`Solo se pueden editar facturas pendientes; la ${quien} está «${estadoActual}».`);
      const cambios = cambiosLegibles(args);
      if (!cambios) return resultadoError('¿Qué quieres cambiar de la factura: el cliente, las líneas, el IVA o el importe?');
      return { tipo: 'pendiente', accion: { tool, args: { ...limpios, id: m.id }, resumen: `Voy a modificar la ${quien} (${cambios}).` } };
    }
  }
  return { tipo: 'pendiente', accion: { tool, args, resumen: describirAccionGenerica(tool, args) } };
}

/**
 * Prepara la acción que el modelo quiere hacer SIN escribir nada:
 *  - presupuesto existente (por nº, nombre o id): se localiza el real; si hay varios → aclaración
 *    con opciones; si hay uno, los args pasan a llevar su id exacto (el modelo no tiene que acordarse).
 *  - entrada de diario: se resuelve la obra (o se pregunta cuál).
 *  - tools con vista previa propia: se ejecuta con `solo_vista_previa: true` y se usa su resumen.
 *  - el resto: resumen genérico con los argumentos.
 */
export async function prepararAccionPendiente(
  tool: string,
  argsOriginal: Record<string, unknown>,
  deps: DepsPreparacion
): Promise<PreparacionAccion> {
  let args = { ...argsOriginal };

  if (TOOLS_DE_DOCUMENTO_EXISTENTE.has(tool)) {
    return prepararDocumentoExistente(tool, args, deps);
  }

  // Crear factura/albarán/presupuesto: nada de inventar importes ni clientes (se pregunta antes del «sí»).
  if (requiereValidacionCreacion(tool)) {
    const v = await validarCreacionDocumento(tool, args, {
      supabase: deps.supabase,
      businessId: deps.businessId,
      mensajeUsuario: deps.mensajeUsuario,
      historialUsuario: deps.historialUsuario,
    });
    if (!v.ok) return { tipo: 'resultado', result: v.result };
    args = v.args;
  }

  if (TOOLS_DE_PRESUPUESTO_EXISTENTE.has(tool)) {
    const idArg = String(args.presupuesto_id ?? args.id ?? '').trim();
    const numero = args.numero as number | string | undefined;
    const hayNumero = numero != null && String(numero).trim() !== '';
    const query = String(args.query ?? '').trim();
    if (idArg || hayNumero || query) {
      const resuelto = await resolverPresupuestosPorTexto(deps.supabase, deps.businessId, {
        id: idArg || undefined,
        numero: hayNumero ? numero : undefined,
        clienteNombre: idArg || hayNumero ? undefined : query,
      });
      const loc = toolFailDesdePresupuestoResolve(resuelto, idArg || (hayNumero ? `nº ${String(numero)}` : query));
      if (!loc.ok) return { tipo: 'resultado', result: loc as unknown as Record<string, unknown> };
      const p = loc.match;
      args.presupuesto_id = p.id;
      args.id = p.id;
      delete args.numero;
      delete args.query;
      const quien = `${p.numero_presupuesto != null ? `nº ${p.numero_presupuesto} de ` : ''}${p.cliente_nombre ?? 'sin cliente'} (${euros(p.importe_total)})`;
      const estadoActual = String(p.estado ?? 'borrador').toLowerCase();
      // Facturar: se comprueba que está aceptado ANTES de pedir el «sí» (no después de que el usuario confirme).
      if (tool === 'convertir_presupuesto_a_factura' && !ESTADOS_FACTURABLES.includes(estadoActual) && estadoActual !== 'facturado') {
        return resultadoError(
          `El presupuesto ${quien} está «${estadoActual}»: para facturarlo primero tiene que estar aceptado. Si el cliente ya ha dicho que sí, dime «márcalo aceptado».`
        );
      }
      if (tool === 'convertir_presupuesto_a_factura' && estadoActual !== 'facturado') {
        const falta = await faltanDatosParaFacturar(deps.supabase, deps.businessId, p.id);
        if (falta) return { tipo: 'resultado', result: falta };
      }
      if (tool === 'cambiar_estado_presupuesto') {
        const nuevo = parseEstadoPresupuesto(args.estado);
        if (!nuevo) return resultadoError(MENSAJE_ESTADO_PRESUPUESTO);
        if (nuevo === estadoActual) return resultadoError(`El presupuesto ${quien} ya está «${nuevo}».`);
        args.estado = nuevo;
        return {
          tipo: 'pendiente',
          accion: { tool, args, resumen: `Voy a cambiar el presupuesto ${quien} de «${estadoActual}» a «${nuevo}».` },
        };
      }
      const frase: Record<string, string> = {
        convertir_presupuesto_a_factura: `Voy a crear la factura del presupuesto ${quien}.`,
        convertir_presupuesto_a_albaran: `Voy a crear el albarán del presupuesto ${quien}.`,
        editar_presupuesto: `Voy a modificar el presupuesto ${quien}.`,
      };
      return { tipo: 'pendiente', accion: { tool, args, resumen: frase[tool] } };
    }
    return resultadoError('¿Qué presupuesto? Dime el número o el cliente (por ejemplo «el 3»).');
  }

  if (tool === 'actualizar_cliente') {
    const id = String(args.cliente_id ?? args.id ?? '').trim();
    const nombreBuscado = String(args.cliente_nombre ?? args.cliente ?? '').trim();
    type FichaCliente = { id: string; nombre: string | null; nif: string | null; direccion: string | null; telefono: string | null; email: string | null };
    let cli = null as FichaCliente | null;
    if (id) {
      const { data } = await deps.supabase
        .from('clientes')
        .select('id, nombre, nif, direccion, telefono, email')
        .eq('id', id)
        .eq('business_id', deps.businessId)
        .maybeSingle();
      cli = (data as FichaCliente | null) ?? null;
      if (!cli) return resultadoError('No encuentro ese cliente en tu negocio. No he cambiado nada.');
    } else {
      if (!nombreBuscado) return resultadoError('¿De qué cliente? Dime su nombre.');
      const r = await resolverClientesPorNombre(deps.supabase, deps.businessId, nombreBuscado);
      const t = resultadoResolveATool(r, nombreBuscado, 'cliente');
      if (!t.ok) return { tipo: 'resultado', result: t as unknown as Record<string, unknown> };
      const { data } = await deps.supabase
        .from('clientes')
        .select('id, nombre, nif, direccion, telefono, email')
        .eq('id', t.match.id)
        .eq('business_id', deps.businessId)
        .maybeSingle();
      cli = (data as FichaCliente | null) ?? null;
      if (!cli) return resultadoError('No encuentro ese cliente en tu negocio. No he cambiado nada.');
    }
    const cambios = construirCambiosCliente({
      nombre: args.nuevo_nombre,
      telefono: args.telefono,
      email: args.email,
      direccion: args.direccion,
      nif: args.nif,
      notas: args.notas,
    });
    if (!cambios.ok) return resultadoError('¿Qué dato del cliente quieres cambiar: NIF, dirección, teléfono, email o nombre?');
    const etiquetas: Record<string, string> = { nombre: 'nombre', nif: 'NIF', direccion: 'dirección', telefono: 'teléfono', email: 'email', notas: 'notas' };
    const actual = cli as unknown as Record<string, string | null>;
    const partes = Object.entries(cambios.cambios).map(
      ([k, v]) => `${etiquetas[k] ?? k}: ${actual[k] ? `${actual[k]} → ` : ''}${v ?? '(vacío)'}`
    );
    const argsFinales: Record<string, unknown> = { cliente_id: cli.id };
    for (const k of ['nuevo_nombre', 'telefono', 'email', 'direccion', 'nif', 'notas']) if (args[k] !== undefined) argsFinales[k] = args[k];
    return {
      tipo: 'pendiente',
      accion: { tool, args: argsFinales, resumen: `Voy a actualizar la ficha de ${cli.nombre ?? 'el cliente'} (${partes.join(', ')}).` },
    };
  }

  if (tool === 'actualizar_obra') {
    type FilaObra = { id: string; nombre: string | null; estado: string | null };
    let obraFila = null as FilaObra | null;
    const idObra = String(args.obra_id ?? '').trim();
    if (idObra) {
      const { data } = await deps.supabase
        .from('obras')
        .select('id, nombre, estado')
        .eq('id', idObra)
        .eq('business_id', deps.businessId)
        .maybeSingle();
      obraFila = (data as FilaObra | null) ?? null;
    } else {
      const nombreBuscado = String(args.obra_nombre ?? '').trim();
      if (!nombreBuscado) return resultadoError('¿Qué obra? Dime su nombre.');
      const r = await resolverObrasPorNombre(deps.supabase, deps.businessId, nombreBuscado);
      const t = resultadoResolveATool(r, nombreBuscado, 'obra');
      if (!t.ok) return { tipo: 'resultado', result: t as unknown as Record<string, unknown> };
      const { data } = await deps.supabase
        .from('obras')
        .select('id, nombre, estado')
        .eq('id', t.match.id)
        .eq('business_id', deps.businessId)
        .maybeSingle();
      obraFila = (data as FilaObra | null) ?? null;
    }
    if (!obraFila) return resultadoError('Obra no encontrada. No he modificado nada.');
    const nombreObra = obraFila.nombre ?? 'la obra';
    const argsObra: Record<string, unknown> = { ...args, obra_id: obraFila.id };
    delete argsObra.obra_nombre;
    const estadoNuevo = String(args.estado ?? '').trim().toLowerCase();
    if (estadoNuevo === 'cerrada' && String(obraFila.estado ?? '').toLowerCase() === 'cerrada') {
      return resultadoError(`La obra «${nombreObra}» ya está cerrada.`);
    }
    const otros: string[] = [];
    if (args.nombre) otros.push(`nombre nuevo: ${String(args.nombre)}`);
    if (args.direccion) otros.push(`dirección: ${String(args.direccion)}`);
    if (args.cliente_nombre) otros.push(`cliente: ${String(args.cliente_nombre)}`);
    const resumen =
      estadoNuevo === 'cerrada' && otros.length === 0
        ? `Voy a cerrar la obra «${nombreObra}».`
        : `Voy a actualizar la obra «${nombreObra}»${estadoNuevo ? ` (estado: ${obraFila.estado ?? '—'} → ${estadoNuevo}${otros.length ? `, ${otros.join(', ')}` : ''})` : otros.length ? ` (${otros.join(', ')})` : ''}.`;
    return { tipo: 'pendiente', accion: { tool, args: argsObra, resumen } };
  }

  if (tool === 'crear_entrada_diario') {
    const texto = [String(args.obra_nombre ?? ''), String(args.texto ?? ''), deps.mensajeUsuario].filter(Boolean).join(' ');
    const obra = await resolverObraDocumentoAgente(
      deps.supabase,
      deps.businessId,
      typeof args.obra_id === 'string' ? args.obra_id : undefined,
      texto,
      'entrada_diario'
    );
    if (!obra.ok) {
      const cands = obra.candidatos;
      return {
        tipo: 'resultado',
        result: cands?.length
          ? { ok: false, error: obra.mensaje, necesita_aclaracion: true, candidatos: cands }
          : { ok: false, error: obra.mensaje },
      };
    }
    if (obra.obra_id) {
      args.obra_id = obra.obra_id;
      // Lo que se guarda es lo que se enseña: la obra resuelta manda sobre el nombre que dijo el modelo.
      args.obra_nombre = obra.obra_nombre ?? args.obra_nombre;
      const nombre = obra.obra_nombre ?? String(args.obra_nombre ?? '');
      const t = valorLegible(args.texto);
      let cuando = '';
      if (String(args.fecha ?? '').trim()) {
        const f = parseFechaNatural(args.fecha);
        if (!f.ok) return resultadoError(f.error);
        args.fecha = f.ymd;
        if (f.ymd !== ymdHoyMadrid()) cuando = ` con fecha ${f.ymd}`;
      }
      return {
        tipo: 'pendiente',
        accion: { tool, args, resumen: `Voy a anotar en el diario de «${nombre}»${cuando}${t ? `: «${t}»` : ''}.` },
      };
    }
  }

  if (TOOLS_CON_VISTA_PREVIA.has(tool)) {
    let preview: unknown;
    try {
      preview = await deps.runTool(tool, { ...args, solo_vista_previa: true });
    } catch (e) {
      return { tipo: 'resultado', result: { ok: false, error: e instanceof Error ? e.message : 'No se pudo preparar la acción' } };
    }
    const o = (preview && typeof preview === 'object' ? preview : {}) as Record<string, unknown>;
    const texto = [o.mensaje, o.error].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
    if (o.pendiente_confirmacion === true) {
      // Si la vista previa ya localizó el presupuesto, la acción confirmada lleva su id exacto.
      const argsFinales: Record<string, unknown> = { ...args, solo_vista_previa: false };
      // Lo que la vista previa resolvió (obra, cliente, proveedor, descripción…) manda sobre lo que dijo el
      // modelo: lo que se guarda es EXACTAMENTE lo que se enseñó.
      if (o.args_resueltos && typeof o.args_resueltos === 'object' && !Array.isArray(o.args_resueltos)) {
        Object.assign(argsFinales, o.args_resueltos as Record<string, unknown>);
        if ('obra_id' in (o.args_resueltos as object)) delete argsFinales.obra_nombre;
        if ('fecha' in (o.args_resueltos as object)) delete argsFinales.fecha_relativa;
        delete argsFinales.horas; // si hay horas_reales resueltas, mandan
      }
      // Ids que la vista previa localizó (evento, entrada de diario, registro de horas): se confirma ESE.
      for (const clave of ['evento_id', 'entrada_id', 'registro_id'] as const) {
        if (typeof o[clave] === 'string' && o[clave]) argsFinales[clave] = o[clave];
      }
      if (tool === 'eliminar_recordatorio' && typeof o.id === 'string' && o.id) argsFinales.id = o.id;
      if (typeof o.presupuesto_id === 'string' && o.presupuesto_id) {
        argsFinales.presupuesto_id = o.presupuesto_id;
        delete argsFinales.numero;
        delete argsFinales.query;
      }
      return {
        tipo: 'pendiente',
        accion: {
          tool,
          args: argsFinales,
          resumen: limpiarTextoVistaPrevia(texto ?? '') || describirAccionGenerica(tool, args),
        },
      };
    }
    // Aclaración, error o cualquier otra cosa: se la dejamos ver al usuario tal cual (no se ejecuta nada).
    return { tipo: 'resultado', result: o };
  }

  return { tipo: 'pendiente', accion: { tool, args, resumen: describirAccionGenerica(tool, args) } };
}

/** «crear una factura» → para «Hecho: crear una factura.» cuando la tool no devuelve mensaje propio. */
export function fraseAccionHecha(tool: string): string {
  return NOMBRES_TOOL[tool] ?? `ejecutar ${tool}`;
}

/** «Hecho: crear un recordatorio en la agenda (título: Visita, fecha: 2026-10-15).» con los datos reales. */
export function fraseHechoConDatos(tool: string, args: Record<string, unknown>): string {
  return describirAccionGenerica(tool, args).replace(/^Voy a /, 'Hecho: ');
}
