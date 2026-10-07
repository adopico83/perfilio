import type { SupabaseClient } from '@supabase/supabase-js';
import { aclaracionObra, resolverObraDocumentoAgente } from '@/lib/obras-context';
import {
  failClosed,
  resolverClientesPorNombre,
  resultadoResolveATool,
} from '@/lib/agente/modules/grounding';

/**
 * «No inventar importes ni clientes». Antes de pedir confirmación para crear una factura, un albarán o
 * un presupuesto, el servidor comprueba que:
 *  - el importe SALE de lo que dijo el usuario (o del propio texto del documento): si el modelo se lo
 *    saca de la manga, se pregunta «¿qué importe le pongo?» en vez de escribir;
 *  - el cliente existe (si no, se pregunta antes de crearlo) y no es ambiguo (dos Garcías);
 *  - la obra no es ambigua (dos obras con «baño»).
 */

const REDONDEAR = (n: number) => Math.round(n * 100) / 100;

/** Números que aparecen en un texto, en formato español («1.210,50», «800», «800,5»). */
export function numerosDelTexto(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(/\d[\d.,]*/g)) {
    let t = m[0].replace(/[.,]+$/, '');
    if (!t) continue;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.210,50
    else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.'); // 800,5
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); // 1,210.50
    const n = Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const IVAS = [0, 4, 10, 21];

/**
 * ¿El importe sale de los textos? Vale si coincide con un número dicho, o con ese número más IVA
 * (el usuario dice «800 más IVA» y el modelo pone 968).
 */
export function importeSaleDe(importe: number, textos: string[]): boolean {
  const nums = textos.flatMap(numerosDelTexto);
  return nums.some((n) =>
    IVAS.some((iva) => Math.abs(REDONDEAR(n * (1 + iva / 100)) - importe) < 0.011) ||
    // «el 50 %» u otras cuentas del modelo no valen: solo coincidencias directas o con IVA.
    Math.abs(n - importe) < 0.011
  );
}

function aNumero(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ResultadoValidacion =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; result: Record<string, unknown> };

export type DepsValidacion = {
  supabase: SupabaseClient;
  businessId: string;
  mensajeUsuario: string;
  /** Últimos mensajes del usuario (el importe pudo decirse un turno antes). */
  historialUsuario?: string[];
};

const TOOLS_VALIDADAS = new Set(['crear_factura', 'crear_albaran', 'crear_presupuesto']);

export function requiereValidacionCreacion(tool: string): boolean {
  return TOOLS_VALIDADAS.has(tool);
}

export async function validarCreacionDocumento(
  tool: string,
  argsOriginal: Record<string, unknown>,
  deps: DepsValidacion
): Promise<ResultadoValidacion> {
  const args = { ...argsOriginal };
  const tipo = tool === 'crear_factura' ? 'la factura' : tool === 'crear_albaran' ? 'el albarán' : 'el presupuesto';
  const textos = [deps.mensajeUsuario, ...(deps.historialUsuario ?? [])].filter(Boolean);

  // ── Cliente ──────────────────────────────────────────────────────────────────────────────
  const clienteId = String(args.cliente_id ?? '').trim();
  const clienteNombre = String(args.cliente_nombre ?? '').trim();
  if (!clienteId && clienteNombre) {
    const resuelto = await resolverClientesPorNombre(deps.supabase, deps.businessId, clienteNombre);
    if (resuelto.status === 'none') {
      return {
        ok: false,
        result: failClosed(`No tengo a «${clienteNombre}» entre tus clientes. ¿Lo creo primero o es otro nombre?`),
      };
    }
    const r = resultadoResolveATool(resuelto, clienteNombre, 'cliente');
    if (!r.ok) return { ok: false, result: r as unknown as Record<string, unknown> };
    args.cliente_id = r.match.id;
    args.cliente_nombre = r.match.nombre ?? clienteNombre;
  }

  // Factura suelta ya resuelta por el ejecutor .jev (cliente, obra, importe e IVA comprobados): solo falta que la ficha del
  // cliente tenga NIF y dirección, y se pide ANTES del «sí» (guardando la tarea para retomarla sola).
  if (tool === 'crear_factura' && args._resuelto === true) {
    const cid = String(args.cliente_id ?? '').trim();
    if (!cid) return { ok: false, result: failClosed('¿Para qué cliente es la factura?') };
    const { data: cli } = await deps.supabase.from('clientes').select('id, nombre, nif, direccion').eq('id', cid).eq('business_id', deps.businessId).maybeSingle();
    const c = cli as { id: string; nombre?: string | null; nif?: string | null; direccion?: string | null } | null;
    if (!c) return { ok: false, result: failClosed('No encuentro a ese cliente en tu negocio.') };
    const faltan: string[] = [];
    if (!String(c.nif ?? '').trim()) faltan.push('nif');
    if (!String(c.direccion ?? '').trim()) faltan.push('direccion');
    if (faltan.length) {
      const que = faltan.map((f) => (f === 'nif' ? 'el NIF' : 'la dirección')).join(' y ');
      return {
        ok: false,
        result: {
          ok: false,
          error: `Para facturar a ${c.nombre ?? 'este cliente'} me falta ${que} (una factura necesita NIF y dirección). Dímelo y lo guardo en su ficha antes de facturar.`,
          faltan_datos_cliente: faltan,
          cliente_id: c.id,
        },
      };
    }
    return { ok: true, args };
  }

  // ── Obra (la resuelve la propia tool; aquí se pregunta ANTES de pedir el «sí») ─────────────
  if (tool !== 'crear_presupuesto' || !String(args.obra_id ?? '').trim()) {
    const explicita = typeof args.obra_id === 'string' && args.obra_id.trim() ? args.obra_id.trim() : undefined;
    const textoObra = [
      String(args.descripcion_trabajos ?? args.texto_presupuesto ?? ''),
      String(args.cliente_nombre ?? ''),
      deps.mensajeUsuario,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    const obra = await resolverObraDocumentoAgente(deps.supabase, deps.businessId, explicita, textoObra, 'documento');
    if (!obra.ok) return { ok: false, result: aclaracionObra(obra) };
    if (obra.obra_id) args.obra_id = obra.obra_id;
    // Factura/albarán sin cliente ni obra: no hay a quién ponérsela.
    if (tool !== 'crear_presupuesto' && !String(args.cliente_id ?? '').trim() && !String(args.cliente_nombre ?? '').trim() && !obra.obra_id) {
      return { ok: false, result: failClosed(`¿Para qué cliente u obra es ${tipo}?`) };
    }
  }

  // El importe se mira el último: antes hay que saber de QUIÉN es el documento (cliente y obra sin ambigüedad).
  // ── Importe ──────────────────────────────────────────────────────────────────────────────
  const campoImporte = tool === 'crear_presupuesto' ? 'importe_total' : 'total';
  const importe = aNumero(args[campoImporte]);
  if (tool === 'crear_factura' && (importe == null || importe <= 0)) {
    return { ok: false, result: failClosed('¿Qué importe le pongo a la factura? Dime el total (con IVA).') };
  }
  if (importe != null && importe > 0) {
    // En un presupuesto el importe también puede salir del propio texto del documento.
    const extra = tool === 'crear_presupuesto' ? [String(args.texto_presupuesto ?? '')] : [];
    if (!importeSaleDe(importe, [...textos, ...extra])) {
      return {
        ok: false,
        result: failClosed(
          `No me has dicho ese importe (${new Intl.NumberFormat('es-ES').format(importe)} €). ¿Qué importe le pongo a ${tipo}?`
        ),
      };
    }
  }

  return { ok: true, args };
}
