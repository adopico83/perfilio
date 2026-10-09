/**
 * CONTRATO DE ROLES. Cada hueco de una orden dice a QUÉ TIPO de entidad admite: `cliente_texto` solo clientes, `proveedor_texto` solo
 * proveedores, y los huecos de documentos (presupuesto, factura, albarán) se identifican por el nombre de un CLIENTE o por un número.
 * El dato fiable está en la base de datos, no en la palabra «factura»: antes de preparar nada, el código mira de qué lado está cada nombre.
 *  - Nombre del lado equivocado → no se prepara nada: se pregunta en una frase.
 *  - Nombre en los dos lados → se pregunta cuál es.
 *  - Un proveedor que el mensaje nombra y NINGUNA orden recoge como proveedor → las órdenes de documentos de su misma frase se bloquean.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDENES, type NombreAccion, type OrdenCruda } from '@/lib/jev/ordenes';
import { resolverCliente, resolverProveedor, type CtxResolver } from '@/lib/jev/resolvedores';
import { clausulaEn } from '@/lib/jev/sin-usar';

export type Rol = 'cliente' | 'proveedor' | 'cualquiera' | 'documento';

const CAMPOS_DOCUMENTO = ['presupuesto_texto', 'albaran_texto', 'factura_texto', 'ref_texto'];
/** Acciones donde la persona con quien se queda puede ser un cliente O un proveedor. */
const ACCIONES_CUALQUIERA = new Set<string>(['CITA_CREAR', 'CITA_MOVER', 'CONSULTA_AGENDA']);

/** Acciones que emiten o tocan documentos de CLIENTE (facturas, presupuestos). Nunca pueden salir de un proveedor. */
export const ACCIONES_DE_DOCUMENTO = new Set<string>([
  'CREAR_FACTURA',
  'FACTURAR',
  'PRESUPUESTO_DICTADO',
  'PRESUPUESTO_PARTIDAS',
  'EXTRA_PRESUPUESTO',
  'CAMBIAR_ESTADO_PRESUPUESTO',
  'MARCAR_PAGADA',
]);

/** El contrato de cada acción: campo → rol. Sale del propio esquema de la acción, así que no se puede quedar desfasado. */
export function contratoDe(accion: string): Record<string, Rol> {
  const orden = (ORDENES as Record<string, { shape?: Record<string, unknown> }>)[accion];
  const claves = Object.keys(orden?.shape ?? {});
  const out: Record<string, Rol> = {};
  for (const k of claves) {
    if (k === 'cliente_texto') out[k] = ACCIONES_CUALQUIERA.has(accion) ? 'cualquiera' : 'cliente';
    else if (k === 'proveedor_texto') out[k] = 'proveedor';
    else if (CAMPOS_DOCUMENTO.includes(k)) out[k] = 'documento';
  }
  return out;
}

export const ACCIONES_CON_CONTRATO = (Object.keys(ORDENES) as NombreAccion[]).filter((a) => Object.keys(contratoDe(a)).length > 0);

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const val = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** ¿El texto es un NOMBRE (no un número ni «ese/la última»)? */
const esNombre = (t: string): boolean => /[a-záéíóúñ]/i.test(t) && !/\d/.test(t) && !/^(?:ese|esa|este|esta|el ultimo|la ultima|ultimo|ultima)(?: \w+)?$/.test(norm(t));

type Lado = { cliente: 'one' | 'many' | 'none'; proveedor: 'one' | 'many' | 'none' };

/** De qué lado de la base de datos está un nombre. */
export async function ladoDe(ctx: CtxResolver, texto: string): Promise<Lado> {
  const c = await resolverCliente(ctx, texto);
  const p = await resolverProveedor(ctx, texto);
  const cliente: Lado['cliente'] = c.ok ? 'one' : c.tipo === 'pregunta' && c.opciones.length > 1 ? 'many' : c.tipo === 'pregunta' && c.opciones.length === 1 ? 'one' : 'none';
  const proveedor: Lado['proveedor'] = p.status === 'one' ? 'one' : p.status === 'many' ? 'many' : 'none';
  return { cliente, proveedor };
}

/**
 * Valida una orden contra el contrato. null = todo en su sitio. Si no, la frase con la que se pregunta (y NO se prepara nada).
 * Una factura a un proveedor (CREAR_FACTURA) la reencamina el ejecutor a GASTO con aviso, así que aquí no se pregunta por eso.
 */
export async function validarRoles(orden: OrdenCruda | Record<string, unknown>, ctx: CtxResolver): Promise<string | null> {
  const o = orden as Record<string, unknown>;
  const accion = String(o.accion ?? '');
  for (const [campo, rol] of Object.entries(contratoDe(accion))) {
    const t = val(o[campo]);
    if (!t || !esNombre(t)) continue;
    const lado = await ladoDe(ctx, t);
    const enCliente = lado.cliente !== 'none';
    const enProveedor = lado.proveedor !== 'none';
    if (enCliente && enProveedor) return `«${t}» está en tu agenda como cliente y también como proveedor. ¿Te refieres al cliente o al proveedor?`;
    if ((rol === 'cliente' || rol === 'documento') && !enCliente && enProveedor) {
      if (accion === 'CREAR_FACTURA') continue; // se reencamina a GASTO con aviso (ejecutor)
      return `«${t}» es un proveedor tuyo, no un cliente, y esto es para un cliente. No he hecho nada. Si es un gasto suyo, dímelo como gasto (por ejemplo «gasto de ${t} de 120 más IVA»).`;
    }
    if (rol === 'proveedor' && !enProveedor && enCliente) return `«${t}» es un cliente tuyo, no un proveedor. No he hecho nada. ¿De qué proveedor es?`;
  }
  return null;
}

type FilaNombre = { nombre: string | null };
const palabras = (s: string): string[] => norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3);
/** Palabras con mayúscula del mensaje (incluida la primera), sin siglas ni días: candidatas a nombre de persona o empresa. */
function candidatosNombre(mensaje: string): string[] {
  const NO = new Set(['iva', 'nif', 'cif', 'dni', 'pdf', 'hola', 'buenas', 'gracias', 'vale', 'prueba', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']);
  return [...new Set([...mensaje.matchAll(/\b[A-ZÁÉÍÓÚÑ][\wáéíóúñ]{2,}/g)].map((m) => norm(m[0])).filter((w) => !NO.has(w)))];
}

export type ResultadoPlan = { ordenes: OrdenCruda[]; avisos: string[] };

/**
 * Plan completo del mensaje: si nombra un PROVEEDOR (y solo proveedor) que ninguna orden recoge, las órdenes de documentos de cliente
 * de esa misma frase se quitan. «Aitor 4 y media en lo de Paqui; también la factura de Saltoki de 120 más IVA de lo de Leire» no puede
 * acabar en una factura de cliente ni en tocar el presupuesto de Leire: Saltoki es un proveedor.
 */
export async function validarPlan(supabase: SupabaseClient, businessId: string, mensaje: string, ordenes: OrdenCruda[]): Promise<ResultadoPlan> {
  if (!ordenes.some((o) => ACCIONES_DE_DOCUMENTO.has(String((o as Record<string, unknown>).accion)))) return { ordenes, avisos: [] };
  const candidatos = candidatosNombre(mensaje);
  if (!candidatos.length) return { ordenes, avisos: [] };
  const [{ data: provs }, { data: clis }] = await Promise.all([
    supabase.from('proveedores').select('nombre').eq('business_id', businessId).limit(500),
    supabase.from('clientes').select('nombre').eq('business_id', businessId).limit(1000),
  ]);
  const pal = (filas: unknown) => new Set(((filas ?? []) as FilaNombre[]).flatMap((f) => palabras(String(f.nombre ?? ''))));
  const deProveedor = pal(provs);
  const deCliente = pal(clis);
  const soloProveedor = candidatos.filter((c) => deProveedor.has(c) && !deCliente.has(c));
  if (!soloProveedor.length) return { ordenes, avisos: [] };

  const textoDe = (o: OrdenCruda) => norm(Object.entries(o as Record<string, unknown>).filter(([k, v]) => typeof v === 'string' && !['descripcion_texto', 'notas_texto', 'titulo_texto'].includes(k)).map(([, v]) => String(v)).join(' | '));
  const cubierto = (n: string) => ordenes.some((o) => !ACCIONES_DE_DOCUMENTO.has(String((o as Record<string, unknown>).accion)) && textoDe(o).includes(n));
  const huerfanos = soloProveedor.filter((n) => !cubierto(n));
  if (!huerfanos.length) return { ordenes, avisos: [] };

  const avisos: string[] = [];
  const quedan = ordenes.filter((o) => {
    if (!ACCIONES_DE_DOCUMENTO.has(String((o as Record<string, unknown>).accion))) return true;
    const propio = textoDe(o);
    for (const n of huerfanos) {
      if (propio.includes(n)) continue; // la propia orden nombra al proveedor: lo resuelve el contrato de sus huecos (o el ejecutor la reencamina a GASTO)
      const idx = norm(mensaje).indexOf(n);
      const clausula = norm(clausulaEn(mensaje, Math.max(0, idx)));
      // Bloquea si la orden de documento habla de lo mismo que la frase del proveedor (comparten alguna palabra de nombre/dato), o no dice nada propio.
      const comparte = propio.split(/[^a-z0-9ñ]+/).some((w) => w.length >= 3 && clausula.includes(w));
      if (comparte || propio.replace(/\b(?:crear_factura|facturar|presupuesto_\w+|extra_presupuesto|cambiar_estado_presupuesto|marcar_pagada)\b/g, '').replace(/[^a-z0-9ñ]/g, '') === '') {
        avisos.push(`«${n.charAt(0).toUpperCase()}${n.slice(1)}» es un proveedor tuyo, no un cliente: no he creado ninguna factura ni tocado ningún presupuesto por eso. Si es un gasto suyo, dímelo como gasto (por ejemplo «gasto de ${n.charAt(0).toUpperCase()}${n.slice(1)} de 120 más IVA»).`);
        return false;
      }
    }
    return true;
  });
  return { ordenes: quedan, avisos: [...new Set(avisos)] };
}
