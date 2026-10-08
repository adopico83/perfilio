/**
 * Resolvedores de entidades del ejecutor .jev. Convierten un texto del usuario («Iker PRUEBA», «el 3»,
 * «lo de Mikel») en un id REAL del negocio, siempre filtrando por business_id. Son la ÚNICA fuente de ids:
 * el modelo y el navegador nunca aportan uno.
 *  - 0 coincidencias → pregunta (u ofrece el alta).
 *  - varias → opciones numeradas (con los ids ya resueltos, guardadas en la tarea en curso).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseNumeroDocumento,
  resolverClientesPorNombre,
  resolverPresupuestosPorTexto,
  toolFailDesdePresupuestoResolve,
} from '@/lib/agente/modules/grounding';
import { localizarDesdeArgs, describirDocumento, type TipoDocumento } from '@/lib/agente/modules/documentos-localizar';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';
import { buscarOperariosPorNombre } from '@/lib/agente/modules/operarios';
import { resolverProveedorPorNombre } from '@/lib/agente/modules/proveedores';
import { ymdHoyMadrid } from '@/lib/fechas-madrid';

export type Opcion = { id: string; etiqueta: string };

export type Resuelto =
  | { ok: true; id: string; etiqueta: string; extra?: Record<string, unknown> }
  | { ok: false; tipo: 'pregunta'; texto: string; opciones: Opcion[]; ofrecerAlta?: boolean }
  | { ok: false; tipo: 'error'; texto: string };

export type CtxResolver = {
  supabase: SupabaseClient;
  businessId: string;
  /** Último presupuesto tratado en la conversación (para «ese presu»). */
  ultimoPresupuestoId?: string | null;
  /** Última factura tratada en la conversación (para «márcala pagada»). */
  ultimaFacturaId?: string | null;
  /** Última cita creada o movida en la conversación (para «pásala al viernes»). */
  ultimoEventoId?: string | null;
};

const lista = (ops: Opcion[]) => ops.slice(0, 8).map((o, i) => `${i + 1}. ${o.etiqueta}`).join('\n');
const pregunta = (texto: string, opciones: Opcion[], ofrecerAlta = false): Resuelto => ({ ok: false, tipo: 'pregunta', texto, opciones, ofrecerAlta });
const error = (texto: string): Resuelto => ({ ok: false, tipo: 'error', texto });

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function resolverCliente(ctx: CtxResolver, texto: string): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error('¿De qué cliente hablas?');
  const r = await resolverClientesPorNombre(ctx.supabase, ctx.businessId, t);
  if (r.status === 'one') return { ok: true, id: r.match.id, etiqueta: r.match.nombre ?? t };
  if (r.status === 'many') {
    // Un nombre idéntico a uno de los candidatos gana (pero solo si es único).
    const exactos = r.candidatos.filter((c) => norm(String(c.nombre ?? '')) === norm(t));
    if (exactos.length === 1) return { ok: true, id: exactos[0]!.id, etiqueta: exactos[0]!.nombre ?? t };
    const ops = r.candidatos.map((c) => ({ id: c.id, etiqueta: String(c.nombre ?? c.id) }));
    return pregunta(`Hay varios clientes que encajan con «${t}». ¿Cuál es?\n${lista(ops)}`, ops);
  }
  return pregunta(`No tengo a «${t}» como cliente. ¿Lo doy de alta o es otro nombre?`, [], true);
}

export async function resolverObra(
  ctx: CtxResolver,
  texto: string,
  opciones: { cerradas?: boolean; clienteId?: string | null } = {}
): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error('¿De qué obra hablas?');
  // Con el cliente conocido, SOLO se miran (y se ofrecen) las obras de ese cliente. Nunca las de otro.
  if (opciones.clienteId) return resolverObraDeCliente(ctx, t, opciones.clienteId, opciones.cerradas === true);
  const r = await resolverObraDocumentoAgente(ctx.supabase, ctx.businessId, undefined, t, 'documento', {
    incluirCerradas: opciones.cerradas === true,
  });
  if (!r.ok || !r.obra_id) {
    // Regla general: «el baño de Unai» = una obra «baño» CUYO CLIENTE es Unai. Antes de preguntar o decir que no hay,
    // se miran las obras de los clientes que encajan con el nombre.
    const porCliente = await obrasPorClienteYTema(ctx, t, opciones.cerradas === true);
    if (porCliente) return porCliente;
  }
  if (!r.ok) {
    if (r.candidatos?.length) return pregunta(`Hay varias obras que encajan con «${t}». ¿Cuál es?\n${lista(r.candidatos)}`, r.candidatos);
    return error(r.mensaje);
  }
  if (!r.obra_id) return error(`No encuentro ninguna obra que coincida con «${t}»${opciones.cerradas ? '' : ' entre las abiertas'}. No te contesto con otra.`);
  if (opciones.clienteId) {
    const { data } = await ctx.supabase.from('obras').select('cliente_id').eq('id', r.obra_id).eq('business_id', ctx.businessId).maybeSingle();
    const cid = (data as { cliente_id?: string | null } | null)?.cliente_id;
    if (cid && cid !== opciones.clienteId) return error(`La obra «${r.obra_nombre ?? t}» es de otro cliente. Dime cuál es la obra de ese cliente.`);
  }
  return { ok: true, id: r.obra_id, etiqueta: r.obra_nombre ?? t };
}

/** Obras de UN cliente que encajan con lo dicho. Si no encaja ninguna pero tiene otras, se las ofrece (solo suyas). */
async function resolverObraDeCliente(ctx: CtxResolver, texto: string, clienteId: string, cerradas: boolean): Promise<Resuelto> {
  const { data } = await ctx.supabase
    .from('obras')
    .select('id, nombre, direccion, estado')
    .eq('business_id', ctx.businessId)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(50);
  type O = { id: string; nombre: string | null; direccion: string | null; estado: string | null };
  const esCerrada = (o: O) => /cerrad|finaliz|termin/.test(norm(String(o.estado ?? '')));
  const todas = ((data ?? []) as O[]).filter((o) => cerradas || !esCerrada(o));
  if (todas.length === 0) return error(`Ese cliente no tiene ninguna obra${cerradas ? '' : ' abierta'}.`);
  const pals = norm(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !ARTICULOS.has(w));
  const coincide = (o: O) => pals.length === 0 || pals.every((w) => norm(`${o.nombre ?? ''} ${o.direccion ?? ''}`).split(/[^a-z0-9ñ]+/).some((x) => x.startsWith(w) || w.startsWith(x)));
  const etiqueta = (o: O) => `${o.nombre ?? 'Obra'}${o.direccion ? ` · ${o.direccion}` : ''}${esCerrada(o) ? ' (cerrada)' : ''}`;
  const coinc = todas.filter(coincide);
  if (coinc.length === 1) return { ok: true, id: coinc[0]!.id, etiqueta: coinc[0]!.nombre ?? texto };
  const lote = coinc.length > 1 ? coinc : todas;
  const ops = lote.slice(0, 8).map((o) => ({ id: o.id, etiqueta: etiqueta(o) }));
  return pregunta(
    coinc.length > 1 ? `Hay varias obras de ese cliente que encajan con «${texto}». ¿Cuál es?\n${lista(ops)}` : `No veo ninguna obra de ese cliente que se llame «${texto}». Sus obras son:\n${lista(ops)}\n¿Cuál es?`,
    ops
  );
}

const MULETILLAS = new Set(['pal', 'pa', 'del', 'por', 'sobre', 'para', 'ahi', 'alli', 'esa', 'ese', 'una', 'uno', 'ticket', 'factura', 'gasto', 'compra']);
const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'lo', 'obra', 'para']);

/** «el baño de Unai» → obras de clientes que encajan con «Unai» cuyo nombre encaja con «baño». */
async function obrasPorClienteYTema(ctx: CtxResolver, texto: string, cerradas: boolean): Promise<Resuelto | null> {
  const m = texto.match(/^(.*?)\s+(?:de|del|para)\s+(.+)$/i);
  if (!m) return null;
  const tema = norm(m[1]!).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !ARTICULOS.has(w) && !MULETILLAS.has(w));
  const rc = await resolverClientesPorNombre(ctx.supabase, ctx.businessId, m[2]!.trim());
  const clientes = rc.status === 'one' ? [rc.match] : rc.status === 'many' ? rc.candidatos : [];
  if (clientes.length === 0) return null;
  const { data } = await ctx.supabase
    .from('obras')
    .select('id, nombre, estado, direccion, cliente_id')
    .eq('business_id', ctx.businessId)
    .in('cliente_id', clientes.map((c) => c.id))
    .limit(50);
  type O = { id: string; nombre: string | null; estado: string | null; direccion: string | null; cliente_id: string | null };
  const abiertas = ((data ?? []) as O[]).filter((o) => cerradas || !/cerrad|finaliz|termin/.test(norm(String(o.estado ?? ''))));
  if (abiertas.length === 0) return null;
  // Puntuación por palabras del tema que aparecen en el nombre de la obra: gana la que más tenga (si es una sola).
  const puntos = (o: O) => tema.filter((w) => norm(String(o.nombre ?? '')).split(/[^a-z0-9ñ]+/).some((x) => x.startsWith(w) || w.startsWith(x))).length;
  const mejor = Math.max(0, ...abiertas.map(puntos));
  const candidatas = tema.length && mejor > 0 ? abiertas.filter((o) => puntos(o) === mejor) : abiertas;
  const nombreCli = (o: O) => clientes.find((c) => c.id === o.cliente_id)?.nombre ?? '';
  const etiqueta = (o: O) => `${o.nombre ?? 'Obra'}${nombreCli(o) ? ` · ${nombreCli(o)}` : ''}`;
  if (candidatas.length === 1) return { ok: true, id: candidatas[0]!.id, etiqueta: candidatas[0]!.nombre ?? texto };
  const lote = candidatas.length > 1 ? candidatas : abiertas;
  const ops = lote.slice(0, 8).map((o) => ({ id: o.id, etiqueta: etiqueta(o) }));
  return pregunta(`Hay varias obras de ${clientes.length === 1 ? clientes[0]!.nombre : 'esos clientes'} que pueden ser «${texto}». ¿Cuál es?\n${lista(ops)}`, ops);
}

/** «el presu 8 de Mikel», «presupuesto nº 8», «la factura 3», «el 8 de García» → 8. Sin número explícito, null. */
export function numeroExplicito(texto: string): number | null {
  const t = norm(texto);
  const m =
    t.match(/\b(?:presu(?:puesto)?|factura|albaran|nº|n°|numero|num|n\.?o)\s*#?\s*(\d{1,6})\b/) ??
    t.match(/^(?:el|la|ese|esa)?\s*#?(\d{1,6})\b(?:\s+(?:de|del|para)\b|$)/);
  return m ? Number(m[1]) : null;
}

const RE_ESE = /^(?:ese|este|esa|esta|aquel|el ultimo|la ultima|ultimo|ultima|el que acabo de (?:hacer|dictar|crear)|ese presu(?:puesto)?|este presu(?:puesto)?)$/;

export async function resolverPresupuesto(ctx: CtxResolver, texto: string): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error('¿Qué presupuesto? Dime el número o el cliente.');
  if (RE_ESE.test(norm(t).replace(/[¿?¡!.]/g, ''))) {
    if (!ctx.ultimoPresupuestoId) return error('¿De qué presupuesto hablas? Dime el número o el cliente (por ejemplo «el 3»).');
    const r = await resolverPresupuestosPorTexto(ctx.supabase, ctx.businessId, { id: ctx.ultimoPresupuestoId });
    const f = toolFailDesdePresupuestoResolve(r, t);
    if (!f.ok) return error('No encuentro ese presupuesto en tu negocio. Dime el número o el cliente.');
    return { ok: true, id: f.match.id, etiqueta: etiquetaPresupuesto(f.match), extra: f.match as unknown as Record<string, unknown> };
  }
  // Un número explícito («el presu 8 de Mikel», «el 8») gana siempre sobre el nombre.
  const numero = numeroExplicito(t) ?? parseNumeroDocumento(t);
  const r = await resolverPresupuestosPorTexto(ctx.supabase, ctx.businessId, numero != null ? { numero } : { clienteNombre: t });
  const f = toolFailDesdePresupuestoResolve(r, t);
  if (f.ok) return { ok: true, id: f.match.id, etiqueta: etiquetaPresupuesto(f.match), extra: f.match as unknown as Record<string, unknown> };
  if (r.status === 'many') {
    const d = await desempatarPresupuestos(ctx, r.candidatos, t);
    if (d) return { ok: true, id: d.id, etiqueta: etiquetaPresupuesto(d), extra: d as unknown as Record<string, unknown> };
  }
  if (f.candidatos?.length) return pregunta(f.error, f.candidatos);
  return error(f.error);
}

/**
 * Varios presupuestos encajan con lo dicho: gana el que coincide por TEMA con la obra («el presu del baño de Mikel» = el de la
 * obra del baño) si es único, o el último presupuesto tratado en la conversación si es uno de ellos. Si no, se pregunta.
 */
async function desempatarPresupuestos<T extends { id: string; cliente_nombre: string | null; numero_presupuesto?: number | null }>(ctx: CtxResolver, candidatos: T[], texto: string): Promise<T | null> {
  const ids = candidatos.map((c) => c.id);
  const { data } = await ctx.supabase.from('presupuestos').select('id, obra_id').eq('business_id', ctx.businessId).in('id', ids);
  const obraDe = new Map(((data ?? []) as Array<{ id: string; obra_id: string | null }>).map((x) => [x.id, x.obra_id]));
  const obraIds = [...new Set([...obraDe.values()].filter((x): x is string => Boolean(x)))];
  if (obraIds.length) {
    const { data: obras } = await ctx.supabase.from('obras').select('id, nombre').eq('business_id', ctx.businessId).in('id', obraIds);
    const nombreObra = new Map(((obras ?? []) as Array<{ id: string; nombre: string | null }>).map((o) => [o.id, norm(String(o.nombre ?? ''))]));
    const tema = norm(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !ARTICULOS.has(w) && !norm(candidatos.map((c) => c.cliente_nombre ?? '').join(' ')).split(/[^a-z0-9ñ]+/).includes(w) && !['presu', 'presupuesto', 'factura'].includes(w));
    if (tema.length) {
      const porTema = candidatos.filter((c) => {
        const nom = nombreObra.get(String(obraDe.get(c.id) ?? '')) ?? '';
        return tema.every((w) => nom.includes(w));
      });
      if (porTema.length === 1) return porTema[0]!;
    }
  }
  return candidatos.find((c) => c.id === ctx.ultimoPresupuestoId) ?? null;
}

function etiquetaPresupuesto(p: { numero_presupuesto?: number | null; cliente_nombre: string | null }): string {
  return `presupuesto${p.numero_presupuesto != null ? ` nº ${p.numero_presupuesto}` : ''} de ${p.cliente_nombre ?? 'sin cliente'}`;
}

export async function resolverDocumento(ctx: CtxResolver, tipo: TipoDocumento, texto: string): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error(`¿Qué ${tipo === 'factura' ? 'factura' : 'albarán'}? Dime el número o el cliente.`);
  // «la última / esa»: la más reciente del negocio (el resumen enseña cuál es antes del «Sí»).
  if (RE_ESE.test(norm(t).replace(/[¿?¡!.]/g, ''))) {
    const tabla = tipo === 'factura' ? 'facturas' : 'albaranes';
    let id = tipo === 'factura' ? ctx.ultimaFacturaId ?? undefined : undefined;
    if (!id) {
      const { data } = await ctx.supabase.from(tabla).select('id').eq('business_id', ctx.businessId).order('created_at', { ascending: false }).limit(1);
      id = (data as Array<{ id: string }> | null)?.[0]?.id;
    }
    if (!id) return error(`No tienes ninguna ${tipo === 'factura' ? 'factura' : 'albarán'}.`);
    const l = await localizarDesdeArgs(ctx.supabase, ctx.businessId, tipo, { id });
    return l.ok ? { ok: true, id: l.match.id, etiqueta: describirDocumento(tipo, l.match), extra: l.match as unknown as Record<string, unknown> } : error(l.error);
  }
  const numero = numeroExplicito(t) ?? parseNumeroDocumento(t);
  const l = await localizarDesdeArgs(ctx.supabase, ctx.businessId, tipo, numero != null ? { numero } : { cliente: t });
  if (l.ok) return { ok: true, id: l.match.id, etiqueta: describirDocumento(tipo, l.match), extra: l.match as unknown as Record<string, unknown> };
  if (l.candidatos?.length) return pregunta(l.error, l.candidatos);
  return error(l.error);
}

/** «Aitor el pintor», «Zubizarreta de carpintero» → { nombre: «Aitor», rol: «pintor» }. */
export function separarNombreYRol(texto: string): { nombre: string; rol: string } | null {
  const m = texto.trim().match(/^(.+?)\s+(?:el|la|de|del|como|que es)\s+(?:el\s+|la\s+)?([\p{L}]{3,})$/iu);
  return m ? { nombre: m[1]!.trim(), rol: m[2]!.trim() } : null;
}

export async function resolverOperario(ctx: CtxResolver, texto: string): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error('¿De qué operario hablas?');
  const unico = (f: { id: string; nombre: string }): Resuelto => ({ ok: true, id: f.id, etiqueta: f.nombre });
  const varios = (filas: Array<{ id: string; nombre: string }>): Resuelto => {
    const ops = filas.map((f) => ({ id: f.id, etiqueta: f.nombre }));
    return pregunta(`Hay varios operarios que encajan con «${t}». ¿Cuál es?\n${lista(ops)}`, ops);
  };
  const r = await buscarOperariosPorNombre(ctx.supabase, ctx.businessId, t);
  if (!r.ok) return error(r.error);
  if (r.filas.length === 1) return unico(r.filas[0]!);
  if (r.filas.length > 1) return varios(r.filas);
  // Regla general: «nombre + oficio». Se busca por el nombre y el oficio sirve para desempatar (si el nombre guardado
  // lo lleva); si el nombre es único, el oficio sobra. Si solo encaja el oficio («Pintor Aitor»), se prueba también.
  const sr = separarNombreYRol(t);
  if (sr) {
    const porNombre = await buscarOperariosPorNombre(ctx.supabase, ctx.businessId, sr.nombre);
    if (porNombre.ok && porNombre.filas.length === 1) return unico(porNombre.filas[0]!);
    if (porNombre.ok && porNombre.filas.length > 1) {
      const rol = norm(sr.rol).replace(/(?:es|s)$/, '');
      const conRol = porNombre.filas.filter((f) => norm(f.nombre).includes(rol));
      return conRol.length === 1 ? unico(conRol[0]!) : varios(conRol.length > 1 ? conRol : porNombre.filas);
    }
    const porRol = await buscarOperariosPorNombre(ctx.supabase, ctx.businessId, sr.rol);
    if (porRol.ok && porRol.filas.length === 1 && norm(porRol.filas[0]!.nombre).includes(norm(sr.nombre))) return unico(porRol.filas[0]!);
  }
  const { data } = await ctx.supabase.from('operarios').select('nombre').eq('business_id', ctx.businessId).eq('activo', true).order('nombre', { ascending: true }).limit(30);
  const nombres = ((data ?? []) as Array<{ nombre: string | null }>).map((x) => String(x.nombre ?? '').trim()).filter(Boolean);
  return error(`No encuentro a «${t}».${nombres.length ? ` Los operarios que tengo son: ${nombres.join(', ')}. ¿Cuál es?` : ' No tienes operarios activos.'}`);
}

const RE_ESA_CITA = /^(?:ella|ese|esa|este|esta|esa cita|esa visita|ese evento|la cita|la visita|el evento|la ultima|la ultima cita|esa reunion|la reunion|lo|la)$/;

export async function resolverEvento(ctx: CtxResolver, texto: string, fechaYmd?: string | null, hoy: string = ymdHoyMadrid()): Promise<Resuelto> {
  const t = texto.trim();
  if (!t) return error('¿Qué cita? Dime con quién o qué día.');
  type Ev = { id: string; titulo: string | null; fecha: string | null; hora: string | null };
  const etiqueta = (e: Ev) => `${e.titulo ?? 'Evento'} (${e.fecha ?? '—'}${e.hora ? ` ${String(e.hora).slice(0, 5)}` : ''})`;
  // «pásala al viernes» justo después de crear o mover una cita = ESA cita.
  if (RE_ESA_CITA.test(norm(t).replace(/[¿?¡!.]/g, ''))) {
    if (!ctx.ultimoEventoId) return error('¿Qué cita? Dime con quién es o qué día (por ejemplo «la de Ane»).');
    const { data } = await ctx.supabase.from('agenda').select('id, titulo, fecha, hora').eq('id', ctx.ultimoEventoId).eq('business_id', ctx.businessId).maybeSingle();
    const ev = data as Ev | null;
    if (!ev) return error('No encuentro esa cita en tu agenda. Dime con quién es o qué día.');
    return { ok: true, id: ev.id, etiqueta: etiqueta(ev), extra: ev as unknown as Record<string, unknown> };
  }
  // Palabras de 3 letras o más cuentan («Ane»); solo se descartan las genéricas.
  const GENERICAS = new Set(['cita', 'visita', 'reunion', 'con', 'del', 'las', 'los', 'por', 'que', 'una', 'uno', 'ese', 'esa']);
  const palabras = norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !GENERICAS.has(w));
  let q = ctx.supabase.from('agenda').select('id, titulo, fecha, hora').eq('business_id', ctx.businessId);
  if (fechaYmd) q = q.eq('fecha', fechaYmd);
  const { data, error: err } = await q.order('fecha', { ascending: true }).limit(200);
  if (err) return error(err.message);
  let filas = ((data ?? []) as Ev[]).filter((e) => palabras.length === 0 || palabras.every((w) => norm(String(e.titulo ?? '')).includes(w)));
  // Sin fecha dicha, importan las de hoy en adelante (lo que se mueve o se borra suele ser futuro).
  const futuras = filas.filter((e) => String(e.fecha ?? '') >= hoy);
  if (!fechaYmd && futuras.length > 0) filas = futuras;
  if (filas.length === 0) return error(`No encuentro ninguna cita que coincida con «${t}».`);
  if (filas.length === 1) return { ok: true, id: filas[0]!.id, etiqueta: etiqueta(filas[0]!), extra: filas[0] as unknown as Record<string, unknown> };
  // Ante varias candidatas, gana la última cita tratada en la conversación si es una de ellas (se enseña igualmente antes del «Sí»).
  const ultima = ctx.ultimoEventoId ? filas.find((e) => e.id === ctx.ultimoEventoId) : undefined;
  if (ultima) return { ok: true, id: ultima.id, etiqueta: etiqueta(ultima), extra: ultima as unknown as Record<string, unknown> };
  const ops = filas.slice(0, 8).map((e) => ({ id: e.id, etiqueta: etiqueta(e) }));
  return pregunta(`Hay varias citas que encajan con «${t}». ¿Cuál es?\n${lista(ops)}`, ops);
}

export async function resolverProveedor(ctx: CtxResolver, texto: string): Promise<
  { status: 'one'; id: string; nombre: string; telefono?: string | null } | { status: 'many'; opciones: Opcion[] } | { status: 'none' } | { status: 'sin_tabla' }
> {
  const r = await resolverProveedorPorNombre(ctx.supabase, ctx.businessId, texto);
  if (r.status === 'one') return { status: 'one', id: r.match.id, nombre: r.match.nombre, telefono: (r.match as { telefono?: string | null }).telefono ?? null };
  if (r.status === 'many') return { status: 'many', opciones: r.candidatos.map((c) => ({ id: c.id, etiqueta: c.nombre })) };
  return { status: r.status };
}
