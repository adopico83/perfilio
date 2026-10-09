/**
 * Ejecutor .jev: DETERMINISTA, sin ningún modelo. Recibe una orden (lo que el traductor sacó del mensaje) y:
 *   1. resuelve cada entidad en la BD del negocio (cliente, obra, presupuesto, factura, operario, evento,
 *      proveedor) con los resolvedores: 0 → pregunta/alta, varios → opciones numeradas;
 *   2. calcula fechas (hora de Madrid), horas e importes a partir de los LITERALES del usuario, y rechaza un
 *      importe que no esté en lo que dijo;
 *   3. devuelve una acción cerrada `{ tool, args }` (con ids, fechas ISO e importes finales) y su resumen.
 * Esa acción se guarda como orden pendiente; tras el «Sí» se ejecuta EXACTAMENTE esa acción.
 * Las consultas (agenda, gastos, obra, facturas) se contestan con plantillas del servidor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrdenJev } from '@/lib/jev/ordenes';
import type { AccionResuelta, EstadoTarea } from '@/lib/jev/pendientes';
import {
  resolverCliente,
  resolverDocumento,
  resolverEvento,
  resolverObra,
  resolverOperario,
  resolverPresupuesto,
  resolverProveedor,
  type Opcion,
  type Resuelto,
} from '@/lib/jev/resolvedores';
import { horasApareceEnTexto, importeApareceEnTexto, minutosRelativos, parseHorasTexto, parseImporteTexto, sumarMinutosHora, tramoHorasEnTexto, resolverFechaFutura, resolverFechaPasada, resolverHoraTexto, resolverRangoTexto } from '@/lib/jev/fechas';
import { prepararAccionPendiente } from '@/lib/agente/confirmacion';
import { corregirPartidasConDictado, validarPartidasContraDictado, type PartidaPresupuesto } from '@/lib/dictado-presupuesto';
import { descripcionDelMensaje, modoIvaDelMensaje } from '@/lib/gastos-iva';
import { generarTextoCanonico } from '@/lib/presupuestos/texto-canonico';
import { TARIFAS_BASE_ALBANILERIA } from '@/lib/tarifas-base';
import { raizPalabra } from '@/lib/presupuestos/editar-partidas';
import { datosExtraProveedor } from '@/lib/agente/confirmacion';
import { generarLinkMaps } from '@/lib/maps';
import { ymdHoyMadrid } from '@/lib/fechas-madrid';
import { validarRoles } from '@/lib/jev/roles';

export type CtxEjecutor = {
  supabase: SupabaseClient;
  businessId: string;
  userId: string;
  ahora: Date;
  /** Mensajes del usuario de la tarea (el actual incluido): de ahí tienen que salir los importes. */
  mensajes: string[];
  /** Lo que el servidor ya resolvió en esta tarea (id + etiqueta + el texto con el que se resolvió). */
  resueltos: EstadoTarea['resueltos'];
  ultimoPresupuestoId?: string | null;
  ultimaFacturaId?: string | null;
  /** Última cita creada o movida en la conversación («pásala al viernes»). */
  ultimoEventoId?: string | null;
  /** El usuario está CORRIGIENDO la orden que acababa de enseñar («espera, la encimera ponla a 230»): lo que cuenta es lo último que dijo. */
  esCorreccion?: boolean;
  /** Rutas de fotos ya subidas que acompañan al mensaje (diario). */
  fotosAdjuntas?: string[];
  /** Solo MCP: texto exacto de la descripción de la cita (el chat usa la plantilla con teléfono y estado). */
  descripcionCita?: string;
  /** Solo MCP: la herramienta ya comprobó duplicados y solapes con sus reglas y admite citas pasadas. */
  modoMcp?: boolean;
  runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type ResultadoOrden =
  | { tipo: 'pendiente'; accion: AccionResuelta; resumen: string }
  | {
      tipo: 'pregunta';
      texto: string;
      slot: string;
      textoSlot: string;
      opciones: Opcion[];
      /** No hay nadie con ese nombre y se ofreció darlo de alta. */
      alta?: boolean;
      /** Falta un dato de la ficha del cliente: al llegar se guarda y se retoma esta orden sola. */
      retomar?: { cliente_id: string; cliente: string; campo: 'nif' | 'direccion'; faltan?: Array<'nif' | 'direccion'> };
    }
  | { tipo: 'respuesta'; texto: string; extra?: Record<string, unknown> }
  | { tipo: 'error'; texto: string };

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const val = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const texto = (t: string): ResultadoOrden => ({ tipo: 'error', texto: t });

/** Resuelve un slot reutilizando lo ya resuelto en la tarea si el texto no ha cambiado. */
async function slot(
  ctx: CtxEjecutor,
  nombre: string,
  txt: string,
  fn: () => Promise<Resuelto>
): Promise<{ ok: true; id: string; etiqueta: string; extra?: Record<string, unknown> } | { ok: false; resultado: ResultadoOrden }> {
  const previo = ctx.resueltos[nombre];
  // texto '' = el usuario eligió una opción de una pregunta de la propia tool («la 2»): vale para ese hueco, diga lo que diga la orden.
  if (previo && (previo.texto === '' || norm(previo.texto) === norm(txt))) return { ok: true, id: previo.id, etiqueta: previo.etiqueta };
  const r = await fn();
  if (r.ok) {
    ctx.resueltos[nombre] = { id: r.id, etiqueta: r.etiqueta, texto: txt };
    return { ok: true, id: r.id, etiqueta: r.etiqueta, extra: r.extra };
  }
  if (r.tipo === 'pregunta') {
    return { ok: false, resultado: { tipo: 'pregunta', texto: r.texto, slot: nombre, textoSlot: txt, opciones: r.opciones, ...(r.ofrecerAlta ? { alta: true } : {}) } };
  }
  return { ok: false, resultado: texto(r.texto) };
}

function pregunta(t: string, slotNombre = 'dato'): ResultadoOrden {
  return { tipo: 'pregunta', texto: t, slot: slotNombre, textoSlot: '', opciones: [] };
}

/** Acción cerrada → se valida con las vistas previas de las tools (sin escribir) y se devuelve pendiente. */
async function cerrar(ctx: CtxEjecutor, tool: string, args: Record<string, unknown>, resumen: string, usarResumenDeTool = false, mensajeUsuario = ''): Promise<ResultadoOrden> {
  // Una obra elegida entre las opciones de una pregunta de la tool («la 2») viaja como obra_id.
  const elegidaObra = ctx.resueltos.obra?.texto === '' && !args.obra_id ? ctx.resueltos.obra : undefined;
  const conMarca = { ...args, ...(elegidaObra ? { obra_id: elegidaObra.id } : {}), _resuelto: true };
  const prep = await prepararAccionPendiente(tool, conMarca, {
    supabase: ctx.supabase,
    businessId: ctx.businessId,
    // Sin mensaje (salvo en crear_factura, que comprueba que el importe lo dijo el usuario): el ejecutor ya
    // resolvió todo; nada se vuelve a deducir del texto.
    mensajeUsuario,
    runTool: (t, a) => ctx.runTool(t, a),
  });
  if (prep.tipo === 'resultado') {
    const o = prep.result as Record<string, unknown>;
    const t = [o.error, o.mensaje].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
    // Falta el NIF o la dirección del cliente: se pide ANTES del «sí» y la tarea se guarda para retomarla sola al llegar el dato.
    if (Array.isArray(o.faltan_datos_cliente) && typeof o.cliente_id === 'string' && o.faltan_datos_cliente.some((f) => f === 'nif' || f === 'direccion')) {
      const { data: cli } = await ctx.supabase.from('clientes').select('nombre').eq('id', o.cliente_id).eq('business_id', ctx.businessId).maybeSingle();
      const campo = o.faltan_datos_cliente.includes('nif') ? 'nif' : 'direccion';
      return {
        tipo: 'pregunta',
        texto: t ?? 'Me falta un dato de la ficha del cliente.',
        slot: campo,
        textoSlot: '',
        opciones: [],
        retomar: { cliente_id: o.cliente_id, cliente: String((cli as { nombre?: string | null } | null)?.nombre ?? 'el cliente'), campo, faltan: o.faltan_datos_cliente.filter((f): f is 'nif' | 'direccion' => f === 'nif' || f === 'direccion') },
      };
    }
    // Una pregunta de la propia tool con opciones (varias obras…): pasa a ser una pregunta de la tarea, para que «la 2» o «ninguna» funcionen.
    if (o.necesita_aclaracion === true && Array.isArray(o.candidatos) && o.candidatos.length > 0) {
      const ops = (o.candidatos as Array<Record<string, unknown>>)
        .map((c) => ({ id: String(c.id ?? ''), etiqueta: String(c.etiqueta ?? c.nombre ?? c.id ?? '') }))
        .filter((c) => c.id);
      if (ops.length) {
        const slotAclaracion = /obra/i.test(String(t ?? '')) ? 'obra' : /cliente/i.test(String(t ?? '')) ? 'cliente' : 'dato';
        return { tipo: 'pregunta', texto: `${t ?? 'Hay varias opciones.'}\n(Dime el número, o «ninguna».)`, slot: slotAclaracion, textoSlot: '', opciones: ops };
      }
    }
    return texto(t ?? 'No he podido preparar la acción. No he cambiado nada.');
  }
  const avisos = prep.accion.resumen
    .split('\n')
    .filter((l) => /^(⚠️|ℹ️)/.test(l.trim()))
    .join('\n');
  const final = usarResumenDeTool ? prep.accion.resumen : `${resumen}${avisos ? `\n${avisos}` : ''}`;
  return { tipo: 'pendiente', accion: { tool, args: prep.accion.args }, resumen: final };
}

/** Nombre del cliente de una obra (los resúmenes de obras, horas y diario siempre lo enseñan). */
async function clienteDeObra(ctx: CtxEjecutor, obraId: string): Promise<string> {
  const { data } = await ctx.supabase.from('obras').select('cliente_id').eq('id', obraId).eq('business_id', ctx.businessId).maybeSingle();
  const cid = (data as { cliente_id?: string | null } | null)?.cliente_id;
  if (!cid) return '';
  const { data: c } = await ctx.supabase.from('clientes').select('nombre').eq('id', cid).eq('business_id', ctx.businessId).maybeSingle();
  return String((c as { nombre?: string | null } | null)?.nombre ?? '');
}

// ───────────────────────────── Importes e IVA ─────────────────────────────

/** Conceptos que se miden en metros LINEALES aunque se diga «metros» (encimera, rodapié, tubería…). */
const RE_LINEAL = /\b(?:encimeras?|rodapi[eé]s?|zocalos?|zócalos?|tuberias?|tubos?|cables?|cableados?|canal(?:es|etas?)?|bajantes?|molduras?|cornisas?|perfil(?:es)?|barandill?as?|barandas?|rail(?:es)?|junquillos?|remates?|vierteaguas|cenefas?|listel(?:es)?|mangueras?|conductos?|goterones?|pasamanos|vallas?|alambradas?)\b/i;

const unidadNorm = (u: string | null | undefined, concepto = ''): string => {
  const t = norm(String(u ?? ''));
  if (/^(m2|m²|metros? cuadrados?|metros?|m)$/.test(t)) return /^(m2|m²|metros? cuadrados?)$/.test(t) ? 'm2' : RE_LINEAL.test(norm(concepto)) ? 'ml' : 'm2';
  if (/^(ml|metros? lineales?)$/.test(t)) return 'ml';
  if (/^(m3|metros? cubicos?)$/.test(t)) return 'm3';
  if (/^(h|horas?)$/.test(t)) return 'hora';
  if (/^(ud|uds|unidad(es)?|u)$/.test(t)) return 'ud';
  return '';
};

type TarifaFila = { nombre: string; unidad: string; precio: number; categoria: string };

async function precioDeTarifa(ctx: CtxEjecutor, concepto: string): Promise<TarifaFila | null> {
  const { data } = await ctx.supabase.from('tarifas').select('nombre, unidad, precio, categoria').eq('business_id', ctx.businessId);
  const propias = ((data ?? []) as Array<{ nombre: string; unidad: string; precio: number | string; categoria: string | null }>).map((t) => ({
    nombre: t.nombre,
    unidad: t.unidad,
    precio: Number(t.precio),
    categoria: t.categoria ?? 'varios',
  }));
  const fuente: TarifaFila[] = propias.length > 0 ? propias : TARIFAS_BASE_ALBANILERIA.map((t) => ({ ...t }));
  const pals = new Set(norm(concepto).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4).map(raizPalabra));
  let mejor: TarifaFila | null = null;
  let puntos = 0;
  for (const t of fuente) {
    const comunes = norm(`${t.nombre} ${t.categoria}`).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4).map(raizPalabra).filter((w) => pals.has(w)).length;
    if (comunes > puntos) {
      mejor = t;
      puntos = comunes;
    }
  }
  return mejor;
}

const CANTIDAD_UNO = /^(1|un|una|uno)$/i;

/**
 * Qué dijo el usuario del IVA, mirando el mensaje MÁS RECIENTE que lo menciona (así «con IVA» tras la pregunta pesa más
 * que el «sin IVA» de antes). «Sin IVA» a secas es ambiguo (¿hay que sumarlo o el gasto va exento?) y devuelve 'ambiguo'.
 */
function modoIvaFinal(mensajes: string[]): 'base' | 'total' | 'exento' | 'ambiguo' | null {
  for (const m of [...mensajes].reverse()) {
    const t = norm(m);
    if (/\bexent[oa]s?\b|\b0\s*%\s*(?:de\s+)?iva\b|\bno lleva iva\b/.test(t)) return 'exento';
    const x = modoIvaDelMensaje(m);
    if (x === 'sin_iva') return 'ambiguo';
    if (x === 'base' || x === 'total') return x;
  }
  return null;
}
const PREGUNTA_SIN_IVA = (n: number) =>
  `«Sin IVA» puede querer decir dos cosas: que a los ${eur(n)} hay que sumarle el IVA, o que no llevan IVA (exento). ¿Son ${eur(n)} + IVA, ${eur(n)} con el IVA incluido, o exento?`;

// ───────────────────────────── La función principal ─────────────────────────────

export async function prepararOrden(orden: OrdenJev, ctx: CtxEjecutor): Promise<ResultadoOrden> {
  const hoy = ymdHoyMadrid(ctx.ahora);
  const dichos = ctx.mensajes;
  const todo = dichos.join('\n');

  // CONTRATO DE ROLES: cada nombre tiene que estar del lado de la base de datos que pide su hueco (cliente / proveedor). Si no, no se prepara nada.
  if (!ctx.modoMcp && !ctx.resueltos.cliente && !ctx.resueltos.proveedor) {
    const fuera = await validarRoles(orden as Record<string, unknown>, ctx);
    if (fuera) return pregunta(fuera, 'rol');
  }

  switch (orden.accion) {
    case 'ACLARAR':
      return pregunta(orden.pregunta);
    case 'CHARLA':
      return { tipo: 'respuesta', texto: '' };

    // ───────────── Clientes ─────────────
    case 'CREAR_CLIENTE': {
      const nombre = orden.nombre_texto.trim();
      const { data } = await ctx.supabase.from('clientes').select('id, nombre').eq('business_id', ctx.businessId);
      const filas = (data ?? []) as Array<{ id: string; nombre: string | null }>;
      const exacto = filas.find((c) => norm(String(c.nombre ?? '')) === norm(nombre));
      if (exacto) return texto(`Ya tienes un cliente llamado «${exacto.nombre}» (exactamente igual). No he creado otro. Si es otra persona, dime un nombre distinto.`);
      // Parecido = todas las palabras de uno están en el otro (cualquier orden) o comparten dos. «Josu» ya está en «Josu PRUEBA Etxaniz».
      const palabrasDe = (t: string) => norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3);
      const parecidos = filas
        .filter((c) => {
          const a = palabrasDe(nombre);
          const b = palabrasDe(String(c.nombre ?? ''));
          if (!a.length || !b.length) return false;
          const comunes = a.filter((w) => b.includes(w)).length;
          return comunes >= 2 || comunes === a.length || comunes === b.length;
        })
        .map((c) => String(c.nombre))
        .slice(0, 3);
      const args = {
        nombre,
        ...(val(orden.telefono_texto) ? { telefono: val(orden.telefono_texto) } : {}),
        ...(val(orden.email_texto) ? { email: val(orden.email_texto) } : {}),
        ...(val(orden.direccion_texto) ? { direccion: val(orden.direccion_texto) } : {}),
        ...(val(orden.nif_texto) ? { nif: val(orden.nif_texto).toUpperCase() } : {}),
      };
      const extra = [args.telefono && `tel: ${args.telefono}`, args.email && `email: ${args.email}`, args.direccion && `dirección: ${args.direccion}`, args.nif && `NIF: ${args.nif}`].filter(Boolean).join(', ');
      return cerrar(
        ctx,
        'crear_cliente',
        args,
        `Voy a crear el cliente «${nombre}»${extra ? ` (${extra})` : ''}.${parecidos.length ? `\n⚠️ Ya hay clientes con un nombre parecido (${parecidos.join(', ')}). Si es el mismo, NO lo crees otra vez: dímelo y uso el que ya tienes. Si confirmas, se crea uno NUEVO.` : ''}`
      );
    }
    case 'ACTUALIZAR_CLIENTE': {
      const cli = await slot(ctx, 'cliente', orden.cliente_texto, () => resolverCliente(ctx, orden.cliente_texto));
      if (!cli.ok) return cli.resultado;
      const args: Record<string, unknown> = { cliente_id: cli.id };
      if (val(orden.nif_texto)) args.nif = val(orden.nif_texto).toUpperCase();
      if (val(orden.direccion_texto)) args.direccion = val(orden.direccion_texto);
      if (val(orden.telefono_texto)) args.telefono = val(orden.telefono_texto);
      if (val(orden.email_texto)) args.email = val(orden.email_texto);
      if (val(orden.nombre_nuevo_texto)) args.nuevo_nombre = val(orden.nombre_nuevo_texto);
      if (Object.keys(args).length === 1) return pregunta(`¿Qué dato de ${cli.etiqueta} quieres cambiar: NIF, dirección, teléfono, email o nombre?`);
      return cerrar(ctx, 'actualizar_cliente', args, '', true);
    }

    // ───────────── Obras ─────────────
    case 'CREAR_OBRA': {
      let clienteId: string | undefined;
      let clienteNombre = '';
      if (val(orden.cliente_texto)) {
        const cli = await slot(ctx, 'cliente', val(orden.cliente_texto), () => resolverCliente(ctx, val(orden.cliente_texto)));
        if (!cli.ok) return cli.resultado;
        clienteId = cli.id;
        clienteNombre = cli.etiqueta;
      }
      const nombre = orden.nombre_texto.trim();
      const { data } = await ctx.supabase.from('obras').select('id, nombre, estado').eq('business_id', ctx.businessId);
      const igual = ((data ?? []) as Array<{ nombre: string | null; estado: string | null }>).find((o) => norm(String(o.nombre ?? '')) === norm(nombre));
      if (igual) return texto(`Ya existe una obra llamada «${igual.nombre}» (${igual.estado ?? 'sin estado'}). ¿La usamos o prefieres otro nombre para la nueva? No he creado nada.`);
      const args = { nombre, ...(clienteId ? { cliente_id: clienteId } : {}), ...(val(orden.direccion_texto) ? { direccion: val(orden.direccion_texto) } : {}) };
      return cerrar(ctx, 'crear_obra', args, `Voy a crear la obra «${nombre}»${clienteNombre ? ` para el cliente ${clienteNombre}` : ' (sin cliente)'}${args.direccion ? `, dirección: ${args.direccion}` : ''}.`);
    }
    case 'CERRAR_OBRA': {
      const obra = await slot(ctx, 'obra', orden.obra_texto, () => resolverObra(ctx, orden.obra_texto));
      if (!obra.ok) return obra.resultado;
      const estado = orden.estado ?? 'cerrada';
      return cerrar(ctx, 'actualizar_obra', { obra_id: obra.id, estado }, estado === 'cerrada' ? `Voy a cerrar la obra «${obra.etiqueta}».` : `Voy a pasar la obra «${obra.etiqueta}» a «${estado}».`);
    }

    // ───────────── Presupuestos ─────────────
    case 'PRESUPUESTO_DICTADO': {
      const cli = await slot(ctx, 'cliente', orden.cliente_texto, () => resolverCliente(ctx, orden.cliente_texto));
      if (!cli.ok) return cli.resultado;
      let obraId: string | undefined;
      let obraNombre = '';
      if (val(orden.obra_texto)) {
        const obra = await slot(ctx, 'obra', val(orden.obra_texto), () => resolverObra(ctx, val(orden.obra_texto), { clienteId: cli.id }));
        if (!obra.ok) return obra.resultado;
        obraId = obra.id;
        obraNombre = obra.etiqueta;
      }
      if (modoIvaFinal(dichos) === 'ambiguo') {
        return pregunta('«Sin IVA» puede querer decir que los precios son sin IVA (y se le suma al presupuesto) o que el presupuesto va exento de IVA. ¿Los precios son + IVA, con el IVA incluido, o va exento?', 'iva');
      }
      const partidas: PartidaPresupuesto[] = [];
      const deTarifa: string[] = [];
      for (const p of orden.partidas) {
        const concepto = p.concepto_texto.trim();
        // Cantidad: debe estar en lo que dijo el usuario (salvo el «1» de un importe cerrado).
        const cantTxt = val(p.cantidad_texto);
        if (!cantTxt) return pregunta(`¿Cuántos metros (o unidades) son de «${concepto}»? No he guardado nada.`, 'cantidad');
        const cantidad = CANTIDAD_UNO.test(cantTxt) ? 1 : parseImporteTexto(cantTxt);
        if (cantidad == null || cantidad < 0) return pregunta(`No entiendo la cantidad «${cantTxt}» de «${concepto}». ¿Cuántos son?`, 'cantidad');
        if (!CANTIDAD_UNO.test(cantTxt) && !importeApareceEnTexto(cantidad, dichos)) {
          return pregunta(`No veo la cantidad ${cantidad} en lo que me has dicho. ¿Cuántos son de «${concepto}»?`, 'cantidad');
        }
        let precio: number | null = null;
        let unidad = unidadNorm(p.unidad_texto, concepto);
        if (val(p.precio_texto)) {
          precio = parseImporteTexto(p.precio_texto);
          if (precio == null || !importeApareceEnTexto(precio, dichos)) {
            return pregunta(`No veo ese precio en lo que me has dicho. ¿A cuánto es «${concepto}»?`, 'precio');
          }
        } else {
          const t = await precioDeTarifa(ctx, concepto);
          if (!t) return pregunta(`¿A cuánto es «${concepto}»? No encuentro una tarifa parecida.`, 'precio');
          precio = t.precio;
          unidad = unidad || unidadNorm(t.unidad);
          deTarifa.push(`${concepto} (tarifa: ${eur(t.precio)}/${t.unidad})`);
        }
        partidas.push({ descripcion: concepto, cantidad, unidad: unidad || 'ud', precio_unitario: r2(precio), total: r2(cantidad * r2(precio)), categoria: 'general' });
      }
      // En una corrección, los números que se acaban de sustituir (210 → 230) ya no cuentan: se valida contra lo último que dijo.
      const textoDictado = ctx.esCorreccion ? dichos.at(-1) ?? todo : todo;
      const corregidas = corregirPartidasConDictado(textoDictado, partidas);
      const noCuadra = validarPartidasContraDictado(textoDictado, corregidas);
      if (noCuadra) return pregunta(noCuadra, 'cantidad');
      const canon = generarTextoCanonico(corregidas.map((p) => ({ concepto: p.descripcion, cantidad: p.cantidad, precio: p.precio_unitario })), 21);
      if (!canon.ok) return texto(canon.error);
      const { data: fichaCli } = await ctx.supabase.from('clientes').select('direccion').eq('id', cli.id).eq('business_id', ctx.businessId).maybeSingle();
      const dirCliente = String((fichaCli as { direccion?: string | null } | null)?.direccion ?? '').trim();
      const lineas = corregidas.map((p, i) => `${i + 1}. ${p.descripcion}: ${String(p.cantidad).replace('.', ',')} ${p.unidad} × ${eur(p.precio_unitario)} = ${eur(p.total)}`);
      const resumen =
        `Voy a guardar el presupuesto de ${cli.etiqueta}${dirCliente ? ` (${dirCliente})` : ''}${obraNombre ? ` (obra «${obraNombre}»)` : ''}:\n${lineas.join('\n')}\n` +
        `Base ${eur(canon.base)} + IVA 21 % ${eur(canon.ivaImporte)} = Total ${eur(canon.total)}.` +
        (deTarifa.length ? `\nℹ️ Precio de tu tarifa (no lo dijiste): ${deTarifa.join('; ')}.` : '');
      return cerrar(
        ctx,
        'generar_presupuesto_por_dictado',
        { dictado: todo, cliente_nombre: cli.etiqueta, cliente_id: cli.id, ...(obraId ? { obra_id: obraId } : {}), partidas_resueltas: corregidas },
        resumen
      );
    }
    case 'PRESUPUESTO_PARTIDAS': {
      const pres = await slot(ctx, 'presupuesto', orden.presupuesto_texto, () => resolverPresupuesto(ctx, orden.presupuesto_texto));
      if (!pres.ok) return pres.resultado;
      const estadoPres = norm(String((pres.extra as { estado?: unknown } | undefined)?.estado ?? ''));
      // Un presupuesto ya facturado o pagado no se toca: se propone apuntarlo como EXTRA (presupuesto hijo vinculado).
      if (/^(facturado|pagado)$/.test(estadoPres)) {
        return texto(`El ${pres.etiqueta} ya está ${estadoPres}: no puedo cambiarle las partidas. Si es un trabajo nuevo, lo apunto como un EXTRA vinculado a ese presupuesto: dime «extra: <qué es>, <importe sin IVA>» (por ejemplo «extra: campana extractora, 120»).`);
      }
      const num = (t: string | null | undefined, que: string): { ok: true; n: number } | { ok: false; r: ResultadoOrden } => {
        const n = parseImporteTexto(t);
        if (n == null || !importeApareceEnTexto(n, dichos)) return { ok: false, r: pregunta(`No veo ${que} (${t}) en lo que me has dicho. ¿Cuál es?`, 'cantidad') };
        return { ok: true, n };
      };
      // Regla general: una partida a la que se refiere el usuario tiene que estar en lo que dijo. Si no («ponle 500»), se pregunta
      // a cuál (y si es precio o cantidad); el servidor nunca elige una partida por su cuenta.
      const dichoNorm = norm(todo);
      const aparece = (t: string) => {
        const pals = norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4).map(raizPalabra);
        return pals.length > 0 && pals.some((w) => dichoNorm.split(/[^a-z0-9ñ]+/).map(raizPalabra).includes(w));
      };
      const cambiar: Array<Record<string, unknown>> = [];
      for (const c of orden.cambiar ?? []) {
        const partida = val(c.partida_texto);
        if (!partida || !aparece(partida)) {
          const dato = val(c.precio_texto) || val(c.cantidad_texto) || val(c.sumar_cantidad_texto);
          return pregunta(`¿A qué partida del ${pres.etiqueta} le${dato ? ` pongo ${dato}` : ' hago el cambio'}? Y dime si es el precio o la cantidad. No cambio nada hasta que me lo digas.`, 'partida');
        }
        const o: Record<string, unknown> = { partida };
        const dicho = (t: string) => {
          const n = parseImporteTexto(t.replace(/^\s*-/, ''));
          return n != null && importeApareceEnTexto(n, dichos);
        };
        // Regla general de cantidades: el modelo copia lo que el usuario DIJO («2 más», «14») y el servidor calcula.
        // Un valor que el modelo calculó (no está en el mensaje) se descarta si el otro sí lo dijo el usuario; si los
        // dos están, manda el delta cuando el mensaje habla de «más / menos / otro / añade / quita», y si no, el valor final.
        let cant = val(c.cantidad_texto);
        let suma = val(c.sumar_cantidad_texto);
        if (cant && !dicho(cant) && suma && dicho(suma)) cant = '';
        if (suma && !dicho(suma) && cant && dicho(cant)) suma = '';
        if (cant && suma) {
          if (/\b(mas|menos|otros?|otras?|anade|anadir|suma|sumale|quita|quitale|resta)\b/.test(norm(todo))) cant = '';
          else suma = '';
        }
        if (cant) { const n = num(cant, 'la cantidad'); if (!n.ok) return n.r; o.cantidad = n.n; }
        if (suma) {
          const n = num(suma.replace(/^\s*-/, ''), 'la cantidad a sumar');
          if (!n.ok) return n.r;
          // «réstale 10 metros», «quita 10», «10 metros menos»: es un delta NEGATIVO aunque el modelo se olvide del signo.
          const negativa = /\b(?:restale|resta|restar|quitale|quita|quitar|menos|bajale|reducele|reduce|descuentale)\b/.test(dichoNorm) && !/\b(?:mas|anade|anadele|suma|sumale|otros?|otras?|incrementa|sube)\b/.test(dichoNorm);
          o.sumar_cantidad = /^\s*-/.test(suma) || negativa ? -Math.abs(n.n) : n.n;
        }
        // Un precio que el usuario NO dijo no se rellena nunca: si hay otro cambio (cantidad, delta, nombre) se descarta; si era el único, se pregunta.
        if (val(c.precio_texto)) {
          const pn = parseImporteTexto(c.precio_texto);
          if (pn != null && importeApareceEnTexto(pn, dichos)) o.precio_unitario = pn;
          else if (!cant && !suma && !val(c.nuevo_nombre_texto)) return pregunta(`No veo el precio (${c.precio_texto}) en lo que me has dicho. ¿Cuál es?`, 'cantidad');
        }
        if (val(c.nuevo_nombre_texto)) o.nuevo_concepto = val(c.nuevo_nombre_texto);
        cambiar.push(o);
      }
      const anadir: Array<Record<string, unknown>> = [];
      for (const a of orden.anadir ?? []) {
        // «colocar campana extractora 120»: concepto + UN número sin unidad = ese es el PRECIO (cantidad 1), como en el dictado.
        let cantTxt = val(a.cantidad_texto);
        let precioTxt = val(a.precio_texto);
        if (!precioTxt && cantTxt && !CANTIDAD_UNO.test(cantTxt) && !unidadNorm(a.unidad_texto, a.concepto_texto)) {
          precioTxt = cantTxt;
          cantTxt = '1';
        }
        const cUno = CANTIDAD_UNO.test(cantTxt);
        const c: { ok: true; n: number } | { ok: false; r: ResultadoOrden } = cUno ? { ok: true, n: 1 } : num(cantTxt, 'la cantidad');
        if (!c.ok) return c.r;
        if (!precioTxt) return pregunta(`¿A cuánto es «${a.concepto_texto}»? No invento precios.`, 'precio');
        const pr = num(precioTxt, 'el precio');
        if (!pr.ok) return pr.r;
        const ud = unidadNorm(a.unidad_texto, a.concepto_texto);
        anadir.push({ concepto: a.concepto_texto, cantidad: c.n, precio_unitario: pr.n, ...(ud ? { unidad: ud } : {}) });
      }
      const quitar = orden.quitar_texto ?? [];
      for (const q of quitar) {
        if (!aparece(q)) return pregunta(`¿Qué partida del ${pres.etiqueta} quito? No he entendido «${q}». No cambio nada.`, 'partida');
      }
      if (quitar.length + cambiar.length + anadir.length === 0) return pregunta('¿Qué quieres cambiar del presupuesto: quitar una partida, cambiar una cantidad o precio, o añadir una?');
      const r = await cerrar(
        ctx,
        'modificar_partidas_presupuesto',
        { presupuesto_id: pres.id, ...(quitar.length ? { quitar } : {}), ...(cambiar.length ? { cambiar } : {}), ...(anadir.length ? { anadir } : {}) },
        '',
        true
      );
      // Un presupuesto ya aceptado es lo que el cliente dio por bueno: se puede cambiar, pero NUNCA sin avisar (y se propone el extra).
      if (r.tipo === 'pendiente' && /^(aceptado|aprobado)$/.test(estadoPres)) {
        r.resumen = `⚠️ Este presupuesto ya está ${estadoPres}: si cambias sus partidas, ya no coincide con lo que aceptó el cliente. Si es un trabajo nuevo, mejor apúntalo como EXTRA (dime «extra: <qué es>, <importe>» y no confirmes este cambio).\n${r.resumen}`;
      }
      return r;
    }
    case 'EXTRA_PRESUPUESTO': {
      const pres = await slot(ctx, 'presupuesto', orden.presupuesto_texto, () => resolverPresupuesto(ctx, orden.presupuesto_texto));
      if (!pres.ok) return pres.resultado;
      const n = parseImporteTexto(orden.importe_texto);
      if (n == null || n <= 0 || !importeApareceEnTexto(n, dichos)) return pregunta(`¿Cuánto es el extra (sin IVA)? No veo el importe en lo que me has dicho.`, 'importe');
      const { data: filaPres } = await ctx.supabase.from('presupuestos').select('obra_id').eq('id', pres.id).eq('business_id', ctx.businessId).maybeSingle();
      const obraP = String((filaPres as { obra_id?: string | null } | null)?.obra_id ?? '');
      const descE = orden.descripcion_texto.trim();
      return cerrar(
        ctx,
        'registrar_extra',
        { descripcion: descE, importe: n, presupuesto_parent_id: pres.id, notificar_cliente: false, ...(obraP ? { obra_id: obraP } : {}) },
        `Voy a apuntar un EXTRA de ${eur(n)} (sin IVA, +21 % = ${eur(r2(n * 1.21))}): «${descE}», vinculado al ${pres.etiqueta}. El presupuesto original no se toca.`
      );
    }
    case 'CAMBIAR_ESTADO_PRESUPUESTO': {
      const pres = await slot(ctx, 'presupuesto', orden.presupuesto_texto, () => resolverPresupuesto(ctx, orden.presupuesto_texto));
      if (!pres.ok) return pres.resultado;
      return cerrar(ctx, 'cambiar_estado_presupuesto', { presupuesto_id: pres.id, estado: orden.estado }, '', true);
    }
    case 'FACTURAR': {
      if (val(orden.albaran_texto) && !val(orden.presupuesto_texto)) {
        const alb = await slot(ctx, 'albaran', val(orden.albaran_texto), () => resolverDocumento(ctx, 'albaran', val(orden.albaran_texto)));
        if (!alb.ok) return alb.resultado;
        return cerrar(ctx, 'convertir_albaran_a_factura', { albaran_id: alb.id }, '', true);
      }
      // Nunca se ELIGE un presupuesto: sale de lo que se nombró (número o cliente) o de «ese» con un presupuesto tratado de verdad en la conversación.
      if (!val(orden.presupuesto_texto) && !ctx.ultimoPresupuestoId) return pregunta('¿De qué presupuesto quieres la factura? Dime el número o el cliente.', 'presupuesto');
      const ref = val(orden.presupuesto_texto) || 'ese';
      const pres = await slot(ctx, 'presupuesto', ref, () => resolverPresupuesto(ctx, ref));
      if (!pres.ok) return pres.resultado;
      return cerrar(ctx, 'convertir_presupuesto_a_factura', { presupuesto_id: pres.id }, '', true);
    }
    case 'MARCAR_PAGADA': {
      const fac = await slot(ctx, 'factura', orden.factura_texto, () => resolverDocumento(ctx, 'factura', orden.factura_texto));
      if (!fac.ok) return fac.resultado;
      return cerrar(ctx, 'cambiar_estado_factura', { id: fac.id, estado: orden.estado ?? 'pagada' }, '', true);
    }
    case 'PDF_ENLACE': {
      if (orden.documento === 'factura') {
        const fac = await slot(ctx, 'factura', val(orden.ref_texto) || 'ese', () => resolverDocumento(ctx, 'factura', val(orden.ref_texto) || 'ese'));
        if (!fac.ok) return fac.resultado;
        const numF = (fac.extra as { numero?: number | string | null } | undefined)?.numero;
        const r = (await ctx.runTool('obtener_enlace_pdf_factura', numF != null && String(numF).trim() ? { numero: numF } : { id: fac.id })) as Record<string, unknown>;
        return typeof r.mensaje === 'string' && r.ok !== false ? { tipo: 'respuesta', texto: r.mensaje, extra: r } : texto(String(r.error ?? 'No he podido generar el PDF.'));
      }
      const ref = val(orden.ref_texto) || 'ese';
      const pres = await slot(ctx, 'presupuesto', ref, () => resolverPresupuesto(ctx, ref));
      if (!pres.ok) return pres.resultado;
      const numP = (pres.extra as { numero_presupuesto?: number | null } | undefined)?.numero_presupuesto;
      const r = (await ctx.runTool('obtener_enlace_pdf_presupuesto', numP != null ? { numero: numP } : { id: pres.id })) as Record<string, unknown>;
      return typeof r.mensaje === 'string' && r.ok !== false ? { tipo: 'respuesta', texto: r.mensaje, extra: r } : texto(String(r.error ?? 'No he podido generar el PDF.'));
    }

    // ───────────── Diario, horas, gastos, proveedores ─────────────
    case 'DIARIO': {
      const obra = await slot(ctx, 'obra', orden.obra_texto, () => resolverObra(ctx, orden.obra_texto));
      if (!obra.ok) return obra.resultado;
      const f = resolverFechaPasada(orden.fecha_texto, ctx.ahora);
      if (!f.ok) return pregunta(f.error, 'fecha');
      const { data: filaObra } = await ctx.supabase.from('obras').select('direccion').eq('id', obra.id).eq('business_id', ctx.businessId).maybeSingle();
      const dirObra = String((filaObra as { direccion?: string | null } | null)?.direccion ?? '').trim();
      const args: Record<string, unknown> = { obra_id: obra.id, obra_nombre: obra.etiqueta, texto: orden.texto.trim(), ...(dirObra ? { obra_direccion: dirObra } : {}) };
      if (f.ymd !== hoy) args.fecha = f.ymd;
      if (ctx.fotosAdjuntas?.length) args.fotos = ctx.fotosAdjuntas;
      const cuando = f.ymd === hoy ? 'hoy' : f.ymd;
      const cliD = await clienteDeObra(ctx, obra.id);
      return cerrar(ctx, 'crear_entrada_diario', args, `Voy a anotar en el diario de la obra «${obra.etiqueta}» (cliente: ${cliD || '—'}) (${cuando}): «${orden.texto.trim()}».`);
    }
    case 'HORAS': {
      const op = await slot(ctx, 'operario', orden.operario_texto, () => resolverOperario(ctx, orden.operario_texto));
      if (!op.ok) return op.resultado;
      const obra = await slot(ctx, 'obra', orden.obra_texto, () => resolverObra(ctx, orden.obra_texto));
      if (!obra.ok) return obra.resultado;
      // «7 y media» = 7,5; «7 y cuarto», «8 menos cuarto», «7:30», «7h30», «media hora», «siete y media»…
      const horas = parseHorasTexto(orden.horas_texto);
      if (horas == null || horas <= 0 || horas > 24 || !horasApareceEnTexto(horas, dichos)) {
        return pregunta(`No veo cuántas horas son (${orden.horas_texto}). ¿Cuántas horas fueron?`, 'horas');
      }
      const tr = tramoHorasEnTexto(`${orden.horas_texto} ${todo}`);
      const detalleTramo = tr && Math.abs(tr.horas - horas) < 0.01 ? ` (de ${tr.desde} a ${tr.hasta}${tr.descanso ? `, descontando ${tr.descanso} min` : ''})` : '';
      const f = resolverFechaPasada(orden.fecha_texto, ctx.ahora);
      if (!f.ok) return pregunta(f.error, 'fecha');
      const args = { operario_nombre: op.etiqueta, obra_id: obra.id, horas_reales: horas, horas_convenio: horas, fecha: f.ymd, ...(val(orden.notas_texto) ? { notas: val(orden.notas_texto) } : {}) };
      const cliH = await clienteDeObra(ctx, obra.id);
      return cerrar(ctx, 'registrar_jornada', args, `Voy a apuntar ${String(horas).replace('.', ',')} h${detalleTramo} a ${op.etiqueta} en la obra «${obra.etiqueta}» (cliente: ${cliH || '—'}) (${f.ymd === hoy ? 'hoy' : f.ymd}).`);
    }
    case 'GASTO': {
      const n = parseImporteTexto(orden.importe_texto);
      if (n == null || n <= 0) return pregunta(`No entiendo el importe «${orden.importe_texto}». ¿Cuánto fue?`, 'importe');
      if (!importeApareceEnTexto(n, dichos)) return pregunta(`No veo el importe ${n} en lo que me has dicho. ¿Cuánto fue exactamente?`, 'importe');
      // IVA: manda lo que dijo el usuario («más IVA» = base; «con IVA / incluido» = total); sin nada, IVA incluido.
      // Ticket de gasto: sin decir nada se toma IVA incluido (se enseña el desglose); «sin IVA» a secas es ambiguo y se pregunta.
      const modoMsg = modoIvaFinal(dichos);
      if (modoMsg === 'ambiguo') return pregunta(PREGUNTA_SIN_IVA(n), 'iva');
      const modo = modoMsg === 'exento' ? 'sin_iva' : modoMsg ?? (orden.iva_modo === 'mas' ? 'base' : 'total');
      const tipoMsg = todo.match(/\b(4|10|21)\s*%/);
      const tipo = tipoMsg ? Number(tipoMsg[1]) : 21;
      let importe: number;
      let iva: number;
      let total: number;
      if (modo === 'base') {
        importe = r2(n);
        iva = r2((importe * tipo) / 100);
        total = r2(importe + iva);
      } else if (modo === 'sin_iva') {
        importe = r2(n);
        iva = 0;
        total = r2(n);
      } else {
        total = r2(n);
        importe = r2(total / (1 + tipo / 100));
        iva = r2(total - importe);
      }
      // Sin proveedor («85 de material para lo de Mikel»): se guarda con la categoría como nombre y sin buscarlo.
      const provTexto = val(orden.proveedor_texto);
      const categoriaGasto = orden.categoria ?? 'material';
      const prov: Awaited<ReturnType<typeof resolverProveedor>> = provTexto ? await resolverProveedor(ctx, provTexto) : ({ status: 'sin_dato' } as never);
      let provId: string | undefined;
      let provTelefono = '';
      let provNombre = provTexto || categoriaGasto.charAt(0).toUpperCase() + categoriaGasto.slice(1);
      let provAviso = '';
      if (prov.status === 'one') {
        provId = prov.id;
        provNombre = prov.nombre;
        if (prov.telefono) provTelefono = prov.telefono;
      } else if (prov.status === 'many') {
        const prevS = ctx.resueltos.proveedor;
        if (prevS && norm(prevS.texto) === norm(provTexto)) {
          provId = prevS.id;
          provNombre = prevS.etiqueta;
        } else {
          return { tipo: 'pregunta', texto: `Hay varios proveedores que encajan con «${provTexto}». ¿Cuál es?\n${prov.opciones.map((o, i) => `${i + 1}. ${o.etiqueta}`).join('\n')}`, slot: 'proveedor', textoSlot: provTexto, opciones: prov.opciones };
        }
      } else if (prov.status === 'none') {
        provAviso = `\nℹ️ «${provNombre}» no está dado de alta como proveedor: se guarda solo con el nombre. Después te pregunto si quieres darlo de alta.`;
      }
      let obraId: string | undefined;
      let obraNombre = '';
      let clienteId: string | undefined;
      let clienteNombre = '';
      if (val(orden.cliente_texto)) {
        const c = await slot(ctx, 'cliente', val(orden.cliente_texto), () => resolverCliente(ctx, val(orden.cliente_texto)));
        if (!c.ok) return c.resultado;
        clienteId = c.id;
        clienteNombre = c.etiqueta;
      }
      if (val(orden.obra_texto)) {
        const o = await slot(ctx, 'obra', val(orden.obra_texto), () => resolverObra(ctx, val(orden.obra_texto), { clienteId: clienteId ?? null }));
        if (!o.ok) return o.resultado;
        obraId = o.id;
        obraNombre = o.etiqueta;
        if (!clienteId) {
          const { data } = await ctx.supabase.from('obras').select('cliente_id').eq('id', o.id).eq('business_id', ctx.businessId).maybeSingle();
          const cid = (data as { cliente_id?: string | null } | null)?.cliente_id;
          if (cid) {
            clienteId = cid;
            const { data: c } = await ctx.supabase.from('clientes').select('nombre').eq('id', cid).eq('business_id', ctx.businessId).maybeSingle();
            clienteNombre = String((c as { nombre?: string } | null)?.nombre ?? '');
          }
        }
      }
      const f = resolverFechaPasada(orden.fecha_texto, ctx.ahora);
      if (!f.ok) return pregunta(f.error, 'fecha');
      const descripcion = val(orden.descripcion_texto) || descripcionDelMensaje(todo, provNombre);
      const categoria = orden.categoria ?? 'material';
      const args = {
        proveedor: provNombre,
        ...(provId ? { proveedor_id: provId } : {}),
        importe,
        iva,
        importe_total: total,
        fecha: f.ymd,
        categoria,
        ...(obraId ? { obra_id: obraId } : {}),
        ...(clienteId ? { cliente_id: clienteId } : {}),
        ...(descripcion ? { descripcion } : {}),
      };
      const resumen =
        `Voy a registrar un gasto de ${provNombre}${provTelefono ? ` (tel. ${provTelefono})` : ''}: base ${eur(importe)} + IVA ${eur(iva)} = total ${eur(total)} (${f.ymd === hoy ? 'hoy' : f.ymd}, ${categoria}).\n` +
        `Obra: ${obraNombre || '—'} · Cliente: ${clienteNombre || '—'}${descripcion ? `\nConcepto: ${descripcion}` : ''}${provAviso}`;
      return cerrar(ctx, 'registrar_gasto_ticket', args, resumen);
    }
    case 'PROVEEDOR_CREAR': {
      const nombre = orden.nombre_texto.trim();
      const extra = datosExtraProveedor(nombre, todo);
      const notas = [val(orden.notas_texto), extra].filter(Boolean).join(' · ');
      const args = {
        nombre,
        ...(val(orden.nif_texto) ? { nif: val(orden.nif_texto).toUpperCase() } : {}),
        ...(val(orden.telefono_texto) ? { telefono: val(orden.telefono_texto) } : {}),
        ...(val(orden.email_texto) ? { email: val(orden.email_texto) } : {}),
        ...(notas ? { notas } : {}),
      };
      return cerrar(ctx, 'crear_proveedor', args, `Voy a dar de alta al proveedor «${nombre}»${notas ? ` (notas: ${notas})` : ''}.`);
    }

    // ───────────── Agenda ─────────────
    case 'CITA_CREAR': {
      let clienteId: string | undefined;
      let clienteNombre = '';
      let conProveedor = '';
      if (val(orden.cliente_texto)) {
        // «visita con el de Maderas Oria»: si no es un cliente pero SÍ un proveedor, la cita no se liga a ningún cliente (y no se
        // ofrece dar de alta a nadie): el proveedor queda en las notas.
        const textoCliente = val(orden.cliente_texto).replace(/^(?:el|la)\s+(?:de|del)\s+/i, '').trim();
        const c = await slot(ctx, 'cliente', val(orden.cliente_texto), () => resolverCliente(ctx, textoCliente));
        if (!c.ok) {
          const r = c.resultado;
          if (r.tipo === 'pregunta' && r.alta) {
            const prov = await resolverProveedor(ctx, textoCliente);
            if (prov.status === 'one') {
              conProveedor = `${prov.nombre}${prov.telefono ? ` (tel. ${prov.telefono})` : ''}`;
            } else if (prov.status === 'many') {
              return { tipo: 'pregunta', texto: `Hay varios proveedores que encajan con «${textoCliente}». ¿Cuál es?\n${prov.opciones.slice(0, 8).map((o, i) => `${i + 1}. ${o.etiqueta}`).join('\n')}`, slot: 'proveedor', textoSlot: '', opciones: prov.opciones };
            }
          }
          if (!conProveedor) return r;
        } else {
          clienteId = c.id;
          clienteNombre = c.etiqueta;
        }
      }
      let obraId: string | undefined;
      let obraNombre = '';
      if (val(orden.obra_texto)) {
        const o = await slot(ctx, 'obra', val(orden.obra_texto), () => resolverObra(ctx, val(orden.obra_texto), { clienteId: clienteId ?? null }));
        if (!o.ok) return o.resultado;
        obraId = o.id;
        obraNombre = o.etiqueta;
      } else if (clienteId) {
        // «en la obra»: la única obra abierta de ese cliente (si hay varias, no se adivina).
        const { data } = await ctx.supabase.from('obras').select('id, nombre').eq('business_id', ctx.businessId).eq('cliente_id', clienteId).in('estado', ['abierta', 'en_curso']);
        const obras = (data ?? []) as Array<{ id: string; nombre: string }>;
        if (obras.length === 1) {
          obraId = obras[0]!.id;
          obraNombre = obras[0]!.nombre;
        }
      }
      // La obra de la cita pertenece a un cliente: si no se dijo (o no se pudo resolver), la cita se vincula a ese cliente.
      if (obraId && !clienteId) {
        const { data: filaObra } = await ctx.supabase.from('obras').select('cliente_id').eq('id', obraId).eq('business_id', ctx.businessId).maybeSingle();
        const cid = (filaObra as { cliente_id?: string | null } | null)?.cliente_id;
        if (cid) {
          const { data: c } = await ctx.supabase.from('clientes').select('nombre').eq('id', cid).eq('business_id', ctx.businessId).maybeSingle();
          clienteId = cid;
          clienteNombre = String((c as { nombre?: string | null } | null)?.nombre ?? '');
        }
      }
      // «he quedado con los de <proveedor> en el tejado de Josu»: el proveedor va en la nota; el cliente es el de la obra.
      if (val(orden.proveedor_texto) && !conProveedor) {
        const prov = await resolverProveedor(ctx, val(orden.proveedor_texto).replace(/^(?:los|las|el|la)\s+(?:de|del)\s+/i, ''));
        conProveedor = prov.status === 'one' ? `${prov.nombre}${prov.telefono ? ` (tel. ${prov.telefono})` : ''}` : val(orden.proveedor_texto);
      }
      const f = resolverFechaFutura(orden.fecha_texto, ctx.ahora, { permitirPasado: ctx.modoMcp === true });
      if (!f.ok) return pregunta(f.error, 'fecha');
      if (!val(orden.hora_texto)) return pregunta('¿A qué hora?', 'hora');
      const h = resolverHoraTexto(orden.hora_texto);
      if (!h.ok) return pregunta(h.error, 'hora');
      const titulo = val(orden.titulo_texto) || (clienteNombre ? `Cita con ${clienteNombre}` : conProveedor ? `Cita con ${conProveedor.replace(/ \(tel\..*$/, '')}` : 'Cita');
      const tituloFinal = clienteNombre && !norm(titulo).includes(norm(clienteNombre).split(' ')[0]!) ? `${titulo} con ${clienteNombre}` : titulo;
      let horaFin = '';
      if (val(orden.hora_fin_texto)) {
        const hf = resolverHoraTexto(orden.hora_fin_texto);
        if (!hf.ok) return pregunta(hf.error, 'hora');
        if (hf.hora <= h.hora) return texto('La hora de fin tiene que ser posterior a la de inicio.');
        horaFin = hf.hora;
      }
      const notasCita = [val(orden.notas_texto), conProveedor ? `Proveedor: ${conProveedor}` : '', horaFin ? `Hora de fin: ${horaFin}` : ''].filter(Boolean).join('\n');
      const args = {
        titulo: tituloFinal,
        fecha: f.ymd,
        hora: h.hora,
        ...(clienteId ? { cliente_id: clienteId } : {}),
        ...(obraId ? { obra_id: obraId } : {}),
        ...(notasCita ? { notas: notasCita } : {}),
        ...(val(orden.lugar_texto) ? { location: val(orden.lugar_texto) } : {}),
        ...(ctx.descripcionCita !== undefined ? { description: ctx.descripcionCita } : {}),
        ...(ctx.modoMcp ? { _solape_comprobado: true } : {}),
      };
      const resumen = `Voy a crear la cita «${tituloFinal}» el ${f.ymd} a las ${h.hora}.\nCliente vinculado: ${clienteNombre || '—'} · Obra: ${obraNombre || '—'}${args.notas ? `\nNotas: ${args.notas}` : ''}`;
      return cerrar(ctx, 'crear_recordatorio', args, resumen);
    }
    case 'CITA_MOVER': {
      if (!val(orden.fecha_texto) && !val(orden.hora_texto)) return pregunta('¿A qué día o a qué hora la paso?', 'fecha');
      const ev = await slot(ctx, 'evento', orden.evento_texto, () => resolverEvento(ctx, orden.evento_texto, null, hoy));
      if (!ev.ok) return ev.resultado;
      // La hora puede ser relativa a la de la cita («una hora más tarde», «media hora antes»).
      let hDicha: ReturnType<typeof resolverHoraTexto> | null = null;
      if (val(orden.hora_texto)) {
        const rel = minutosRelativos(orden.hora_texto);
        if (rel != null) {
          let horaCita = String((ev.extra as { hora?: unknown } | undefined)?.hora ?? '');
          if (!horaCita) {
            const { data } = await ctx.supabase.from('agenda').select('hora').eq('id', ev.id).eq('business_id', ctx.businessId).maybeSingle();
            horaCita = String((data as { hora?: string | null } | null)?.hora ?? '');
          }
          const nueva = horaCita ? sumarMinutosHora(horaCita, rel) : null;
          if (!nueva) return pregunta('¿A qué hora exacta la paso? No puedo calcularla a partir de la hora actual de la cita.', 'hora');
          hDicha = { ok: true, hora: nueva };
        } else {
          hDicha = resolverHoraTexto(orden.hora_texto);
        }
        if (!hDicha.ok) return pregunta(hDicha.error, 'hora');
      }
      // Un día de la semana suelto («al jueves») se cuenta desde la fecha ACTUAL DE LA CITA (el jueves siguiente a ese
      // día), no desde hoy. «Mañana», «hoy», fechas concretas y «el 15» siguen contando desde hoy.
      let fDicha: ReturnType<typeof resolverFechaFutura> | null = null;
      const ft = val(orden.fecha_texto);
      if (ft) {
        const dicho = norm(ft);
        const soloDiaSemana = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(dicho) && !/\b(hoy|manana|pasado|que viene|semana|proximo|siguiente)\b/.test(dicho);
        fDicha = resolverFechaFutura(ft, ctx.ahora);
        if (soloDiaSemana) {
          let fechaCita = String((ev.extra as { fecha?: unknown } | undefined)?.fecha ?? '');
          if (!fechaCita) {
            const { data } = await ctx.supabase.from('agenda').select('fecha').eq('id', ev.id).eq('business_id', ctx.businessId).maybeSingle();
            fechaCita = String((data as { fecha?: string | null } | null)?.fecha ?? '');
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(fechaCita) && fechaCita >= hoy) {
            const base = new Date(`${fechaCita}T12:00:00Z`);
            const conMarca = `${ft.replace(/^\s*(?:a(?:l)?|para)\s+/i, 'el ')} que viene`;
            const desdeCita = resolverFechaFutura(conMarca, base);
            if (desdeCita.ok) fDicha = desdeCita;
          }
        }
        if (!fDicha.ok) return pregunta(fDicha.error, 'fecha');
      }
      const args: Record<string, unknown> = { evento_id: ev.id };
      if (fDicha?.ok) args.nueva_fecha = fDicha.ymd;
      if (hDicha?.ok) args.nueva_hora = hDicha.hora;
      return cerrar(ctx, 'modificar_evento_agenda', args, '', true);
    }
    case 'CITA_BORRAR': {
      const fil = val(orden.fecha_texto) ? resolverFechaFutura(orden.fecha_texto, ctx.ahora) : null;
      const ev = await slot(ctx, 'evento', orden.evento_texto, () => resolverEvento(ctx, orden.evento_texto, fil?.ok ? fil.ymd : null, hoy));
      if (!ev.ok) return ev.resultado;
      return cerrar(ctx, 'eliminar_evento_agenda', { evento_id: ev.id }, `Voy a BORRAR la cita ${ev.etiqueta}.`);
    }

    // ───────────── Consultas (plantillas del servidor) ─────────────
    case 'CONSULTA_AGENDA': {
      const rg = resolverRangoTexto(orden.rango_texto, ctx.ahora);
      if (!rg.ok) return texto(rg.error);
      const { desde, hasta, etiqueta } = rg.rango;
      const { data, error } = await ctx.supabase.from('agenda').select('id, titulo, fecha, hora, location').eq('business_id', ctx.businessId).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: true }).limit(300);
      if (error) return texto(error.message);
      type Ev = { titulo: string | null; fecha: string | null; hora: string | null; location: string | null };
      const evs = ((data ?? []) as Ev[]).sort((a, b) => `${a.fecha} ${a.hora ?? '99'}`.localeCompare(`${b.fecha} ${b.hora ?? '99'}`));
      if (evs.length === 0) return { tipo: 'respuesta', texto: `No tienes nada en la agenda ${etiqueta}.` };
      const dias = new Map<string, Ev[]>();
      for (const e of evs) dias.set(String(e.fecha), [...(dias.get(String(e.fecha)) ?? []), e]);
      const nombreDia = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const cuerpo = [...dias.entries()]
        .map(([ymd, es]) => `**${nombreDia(ymd)}**\n${es.map((e) => `- ${e.hora ? String(e.hora).slice(0, 5) + ' ' : ''}${e.titulo ?? 'Evento'}${e.location ? ` — [${e.location}](${generarLinkMaps(e.location)})` : ''}`).join('\n')}`)
        .join('\n\n');
      return { tipo: 'respuesta', texto: `Tienes ${evs.length} evento${evs.length === 1 ? '' : 's'} ${etiqueta}:\n\n${cuerpo}` };
    }
    case 'CONSULTA_GASTOS': {
      const args: Record<string, unknown> = {};
      if (val(orden.proveedor_texto)) {
        const prov = await resolverProveedor(ctx, val(orden.proveedor_texto));
        args.proveedor = prov.status === 'one' ? prov.nombre : val(orden.proveedor_texto);
      }
      if (val(orden.obra_texto)) {
        const o = await slot(ctx, 'obra', val(orden.obra_texto), () => resolverObra(ctx, val(orden.obra_texto), { cerradas: true }));
        if (!o.ok) return o.resultado;
        args.obra_id = o.id;
      }
      if (val(orden.cliente_texto)) {
        const c = await slot(ctx, 'cliente', val(orden.cliente_texto), () => resolverCliente(ctx, val(orden.cliente_texto)));
        if (!c.ok) return c.resultado;
        args.cliente_id = c.id;
      }
      if (val(orden.periodo_texto)) {
        const rg = resolverRangoTexto(orden.periodo_texto, ctx.ahora);
        if (!rg.ok) return texto(rg.error);
        args.desde = rg.rango.desde;
        args.hasta = rg.rango.hasta;
      }
      const r = (await ctx.runTool('listar_gastos', args)) as Record<string, unknown>;
      if (r.ok === false) return texto(String(r.error ?? 'No he podido consultar los gastos.'));
      const items = (r.items as Array<Record<string, unknown>> | undefined) ?? [];
      const detalle = items
        .slice(0, 15)
        .map((g) => `- ${g.fecha} · ${g.proveedor}${g.descripcion ? ` (${g.descripcion})` : ''}: ${eur(Number(g.importe_total ?? 0))}`)
        .join('\n');
      return { tipo: 'respuesta', texto: `${String(r.mensaje)}${detalle ? `\n\n${detalle}` : ''}`, extra: r };
    }
    case 'CONSULTA_OBRA': {
      const o = await slot(ctx, 'obra', orden.obra_texto, () => resolverObra(ctx, orden.obra_texto, { cerradas: true }));
      if (!o.ok) return o.resultado;
      const r = (await ctx.runTool('ver_ficha_obra', { obra_id: o.id })) as Record<string, unknown>;
      if (r.ok === false || typeof r.mensaje !== 'string') return texto(String(r.error ?? 'No he podido abrir la ficha de la obra.'));
      return { tipo: 'respuesta', texto: r.mensaje, extra: r };
    }
    case 'CREAR_FACTURA': {
      const cli = await slot(ctx, 'cliente', orden.cliente_texto, () => resolverCliente(ctx, orden.cliente_texto));
      if (!cli.ok) {
        // «factura de <proveedor que existe>» es una factura RECIBIDA: un GASTO, no una factura emitida a un cliente.
        const r = cli.resultado;
        if (r.tipo === 'pregunta' && r.alta) {
          const prov = await resolverProveedor(ctx, orden.cliente_texto);
          if (prov.status === 'one') {
            const g = await prepararOrden(
              { accion: 'GASTO', proveedor_texto: orden.cliente_texto, importe_texto: orden.importe_texto, iva_modo: orden.iva_modo, obra_texto: orden.obra_texto, descripcion_texto: orden.descripcion_texto } as OrdenJev,
              ctx
            );
            if (g.tipo === 'pendiente') g.resumen = `ℹ️ «${prov.nombre}» es un proveedor tuyo: lo registro como GASTO (factura recibida), no como factura emitida a un cliente.\n${g.resumen}`;
            return g;
          }
        }
        return r;
      }
      const n = parseImporteTexto(orden.importe_texto);
      if (n == null || n <= 0) return pregunta(`No entiendo el importe «${orden.importe_texto}». ¿Cuánto es la factura?`, 'importe');
      if (!importeApareceEnTexto(n, dichos)) return pregunta(`No veo el importe ${n} en lo que me has dicho. ¿Cuánto es la factura?`, 'importe');
      // IVA: en una factura NO se supone nada. Hay que haber dicho «con IVA» o «más IVA»; «sin IVA» a secas también se pregunta.
      const modoMsg = modoIvaFinal(dichos);
      if (modoMsg === 'ambiguo') return pregunta(PREGUNTA_SIN_IVA(n), 'iva');
      let ivaDicho: 'base' | 'total' | 'exento' | null = modoMsg;
      if (!ivaDicho && orden.iva_modo && /\biva\b/.test(norm(todo))) ivaDicho = orden.iva_modo === 'mas' ? 'base' : 'total';
      if (!ivaDicho) return pregunta(`¿Los ${eur(n)} de la factura son con el IVA incluido o hay que sumarle el IVA (${eur(n)} + IVA)?`, 'iva');
      const ivaPct = ivaDicho === 'exento' ? 0 : 21;
      const baseF = ivaDicho === 'total' ? r2(n / (1 + ivaPct / 100)) : r2(n);
      const ivaF = r2(baseF * (ivaPct / 100));
      const total = r2(baseF + ivaF);
      // Obra: solo si la dice. «Sin obra» (o no decir nada) = factura suelta: nunca se pregunta ni se elige otra por su cuenta.
      let obraId: string | undefined;
      let obraNombre = '';
      if (val(orden.obra_texto) && orden.sin_obra !== 'si') {
        const o = await slot(ctx, 'obra', val(orden.obra_texto), () => resolverObra(ctx, val(orden.obra_texto), { clienteId: cli.id, cerradas: true }));
        if (!o.ok) return o.resultado;
        obraId = o.id;
        obraNombre = o.etiqueta;
      } else if (orden.sin_obra !== 'si' && val(orden.descripcion_texto)) {
        // El concepto nombra una obra de ESE cliente («revisión del tejado» con Josu → su obra del tejado): se propone (se ve en el resumen).
        const { data: obrasCli } = await ctx.supabase.from('obras').select('id, nombre').eq('business_id', ctx.businessId).eq('cliente_id', cli.id);
        const pals = norm(val(orden.descripcion_texto)).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4).map(raizPalabra);
        const coinc = ((obrasCli ?? []) as Array<{ id: string; nombre: string | null }>).filter((o) => norm(String(o.nombre ?? '')).split(/[^a-z0-9ñ]+/).map(raizPalabra).some((w) => w.length >= 4 && pals.includes(w)));
        if (coinc.length === 1) {
          obraId = coinc[0]!.id;
          obraNombre = String(coinc[0]!.nombre ?? '');
        }
      }
      const concepto = val(orden.descripcion_texto) || 'Trabajos realizados';
      return cerrar(
        ctx,
        'crear_factura',
        {
          descripcion_trabajos: concepto,
          total,
          iva_porcentaje: ivaPct,
          cliente_id: cli.id,
          cliente_nombre: cli.etiqueta,
          ...(obraId ? { obra_id: obraId } : {}),
        },
        `Voy a crear una factura para ${cli.etiqueta}${obraNombre ? ` (obra «${obraNombre}»)` : ' (sin obra)'}: «${concepto}».\nBase ${eur(baseF)} + IVA ${ivaPct} % ${eur(ivaF)} = Total ${eur(total)}. Vence a los 30 días.`,
        false,
        todo
      );
    }
    case 'CONSULTA_DIA': {
      const r = (await ctx.runTool('resumen_del_dia', {})) as Record<string, unknown>;
      if (typeof r.error === 'string') return texto(r.error);
      return { tipo: 'respuesta', texto: typeof r.texto === 'string' ? r.texto : 'No tengo nada que contarte de hoy.', extra: r };
    }
    case 'CONSULTA_OBRAS': {
      const est = orden.estado ?? 'abiertas';
      let q = ctx.supabase.from('obras').select('id, nombre, estado, cliente_id, direccion').eq('business_id', ctx.businessId);
      if (est === 'abiertas') q = q.in('estado', ['abierta', 'en_curso']);
      else if (est === 'cerradas') q = q.eq('estado', 'cerrada');
      const { data, error } = await q.order('nombre', { ascending: true }).limit(100);
      if (error) return texto(error.message);
      const obras = (data ?? []) as Array<{ nombre: string; estado: string | null; cliente_id: string | null; direccion: string | null }>;
      if (obras.length === 0) return { tipo: 'respuesta', texto: `No tienes obras ${est === 'abiertas' ? 'abiertas' : est === 'cerradas' ? 'cerradas' : 'registradas'}.` };
      const ids = [...new Set(obras.map((o) => o.cliente_id).filter((x): x is string => Boolean(x)))];
      const nombres = new Map<string, string>();
      if (ids.length) {
        const { data: cs } = await ctx.supabase.from('clientes').select('id, nombre').eq('business_id', ctx.businessId).in('id', ids);
        for (const c of (cs ?? []) as Array<{ id: string; nombre: string | null }>) nombres.set(c.id, String(c.nombre ?? ''));
      }
      return {
        tipo: 'respuesta',
        texto: `${obras.length} obra${obras.length === 1 ? '' : 's'} ${est === 'abiertas' ? 'abiertas' : est === 'cerradas' ? 'cerradas' : ''}:\n${obras.map((o) => `- ${o.nombre}${o.cliente_id && nombres.get(o.cliente_id) ? ` (${nombres.get(o.cliente_id)})` : ''}${o.estado ? ` · ${o.estado}` : ''}`).join('\n')}`.replace(/ :\n/, ':\n'),
      };
    }
    case 'CONSULTA_PRESUPUESTOS': {
      const est = orden.estado ?? 'pendientes';
      let q = ctx.supabase.from('presupuestos').select('numero_presupuesto, cliente_nombre, estado, importe_total').eq('business_id', ctx.businessId);
      if (est === 'pendientes') q = q.in('estado', ['borrador', 'pendiente', 'enviado']);
      else if (est === 'aceptados') q = q.in('estado', ['aceptado', 'aprobado']);
      const { data, error } = await q.order('numero_presupuesto', { ascending: true }).limit(100);
      if (error) return texto(error.message);
      const ps = (data ?? []) as Array<{ numero_presupuesto: number | null; cliente_nombre: string | null; estado: string | null; importe_total: number | null }>;
      if (ps.length === 0) return { tipo: 'respuesta', texto: `No tienes presupuestos ${est === 'pendientes' ? 'pendientes' : est === 'aceptados' ? 'aceptados' : ''}.`.replace(' .', '.') };
      return {
        tipo: 'respuesta',
        texto: `${ps.length} presupuesto${ps.length === 1 ? '' : 's'}:\n${ps.map((p) => `- nº ${p.numero_presupuesto ?? '—'} · ${p.cliente_nombre ?? 'sin cliente'} · ${p.estado ?? '—'} · ${eur(Number(p.importe_total ?? 0))}`).join('\n')}`,
      };
    }
    case 'CONSULTA_FACTURAS': {
      const estado = orden.estado ?? 'pendiente';
      const { data, error } = await ctx.supabase.from('facturas').select('numero_factura, cliente_nombre, total, estado, fecha').eq('business_id', ctx.businessId).eq('estado', estado).order('numero_factura', { ascending: true }).limit(100);
      if (error) return texto(error.message);
      const fs = (data ?? []) as Array<{ numero_factura: number | null; cliente_nombre: string | null; total: number | null }>;
      if (fs.length === 0) return { tipo: 'respuesta', texto: `No tienes facturas ${estado === 'pagada' ? 'pagadas' : estado === 'vencida' ? 'vencidas' : 'pendientes de cobro'}.` };
      const suma = r2(fs.reduce((a, f) => a + Number(f.total ?? 0), 0));
      return {
        tipo: 'respuesta',
        texto: `${fs.length} factura${fs.length === 1 ? '' : 's'} ${estado === 'pagada' ? 'pagadas' : estado === 'vencida' ? 'vencidas' : 'pendientes de cobro'} (${eur(suma)}):\n${fs.map((f) => `- nº ${f.numero_factura ?? '—'} · ${f.cliente_nombre ?? 'sin cliente'}: ${eur(Number(f.total ?? 0))}`).join('\n')}`,
      };
    }
  }
}

