import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { generarTextoCanonico, type PartidaCanonicaEntrada } from '@/lib/presupuestos/texto-canonico';
import { normalizarNombreComparable } from '@/lib/agente/modules/grounding';

/**
 * Cambiar, quitar o añadir partidas de un presupuesto YA guardado («quítale la mampara y pon 2 metros más
 * de alicatado»). El modelo solo dice QUÉ cambia; el texto, la base, el IVA y el total los recalcula el
 * servidor con `generarTextoCanonico` (el mismo formato que entiende el PDF y la factura).
 */

export type CambiosPartidas = {
  /** Fragmentos del concepto de las partidas a quitar («mampara»). */
  quitar?: string[];
  cambiar?: Array<{
    /** Fragmento del concepto de la partida a cambiar («alicatado»). */
    partida: string;
    cantidad?: number;
    /** «Dos metros más»: se SUMA a la cantidad actual. */
    sumar_cantidad?: number;
    precio_unitario?: number;
    concepto?: string;
    /** Sinónimo de `concepto`: el NUEVO nombre de la partida («Plato de ducha» sin mampara). */
    nuevo_concepto?: string;
    /** Unidad que dijo el usuario («metros» → m2) para no confundir partidas. */
    unidad?: string;
  }>;
  anadir?: Array<{ concepto: string; cantidad: number; precio_unitario?: number; capitulo?: string }>;
  iva_porcentaje?: number;
};

export type ResultadoEdicionPartidas =
  | {
      ok: true;
      presupuesto_id: string;
      numero: number | null;
      cliente: string | null;
      total_anterior: number | null;
      total_nuevo: number;
      /** Frases legibles de lo que cambia, para el resumen de la confirmación. */
      cambios: string[];
      /** Texto y totales nuevos (solo se guardan si `aplicar` es true). */
      texto: string;
      aplicado: boolean;
    }
  | {
      ok: false;
      error: string;
      necesita_aclaracion?: true;
      candidatos?: Array<{ id: string; etiqueta: string }>;
    };

type Partida = { concepto: string; cantidad: number; precio: number; capitulo: string };

const euros = (n: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' }).format(n)} €`;
const num = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 }).format(n);

const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'con', 'sin', 'en', 'a', 'al', 'un', 'una', 'para', 'por', 'que',
  'm', 'm2', 'm3', 'ml', 'ud', 'uds', 'metro', 'metros', 'unidad', 'unidades', 'partida', 'mas',
]);
/** Trabajos de retirada: «Quitar alicatado y plato viejo» NO es el alicatado nuevo. */
const RAICES_DEMOLICION = new Set(['quit', 'retir', 'demol', 'desmont', 'pic', 'levant', 'desescomb', 'tir']);

/** Raíz de una palabra: sin tildes, plural ni terminación (alicatado ≈ alicatar ≈ alicatados). */
export function raizPalabra(palabra: string): string {
  let w = normalizarNombreComparable(palabra);
  for (let pasada = 0; pasada < 2; pasada++) {
    const antes = w;
    for (const suf of ['aciones', 'acion', 'adores', 'ador', 'ados', 'adas', 'ado', 'ada', 'ando', 'ar', 'er', 'ir', 'es', 's', 'o', 'a']) {
      if (w.endsWith(suf) && w.length - suf.length >= 4) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
    if (w === antes) break;
  }
  return w;
}

function raices(texto: string): string[] {
  return normalizarNombreComparable(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w))
    .map(raizPalabra);
}

type PreguntaPartida = { ok: false; error: string; necesita_aclaracion: true; candidatos: Array<{ id: string; etiqueta: string }> };
type ResultadoBusqueda = { ok: true; indice: number } | { ok: false; error: string } | PreguntaPartida;

const etiquetaPartida = (p: Partida) => `${p.concepto} (${num(p.cantidad)} × ${euros(p.precio)})`;

function pregunta(error: string, candidatos: Array<{ id: string; etiqueta: string }>): PreguntaPartida {
  const lista = candidatos.map((c, n) => `${n + 1}. ${c.etiqueta}`).join('\n');
  return { ok: false, error: `${error}\n${lista}`, necesita_aclaracion: true, candidatos };
}

/**
 * Busca UNA partida por fragmento comparando raíces (sin tildes, plural ni terminación) y exigiendo
 * todas las palabras. No adivina: con varias candidatas, o con una coincidencia parcial (la palabra es
 * solo una parte pequeña del nombre), pregunta con opciones.
 * `modo` solo cambia lo que se ofrece cuando la coincidencia es parcial al quitar.
 */
function buscarUna(partidas: Partida[], fragmento: string, modo: 'cambiar' | 'quitar', unidad?: string): ResultadoBusqueda {
  const frag = [...new Set(raices(fragmento))];
  if (frag.length === 0) return { ok: false, error: 'Falta decir qué partida (por ejemplo «la mampara»).' };
  const pideDemolicion = frag.some((r) => RAICES_DEMOLICION.has(r));

  let idx = partidas.flatMap((p, i) => {
    const rc = new Set(raices(p.concepto));
    return frag.every((r) => rc.has(r)) ? [i] : [];
  });
  if (idx.length === 0) {
    return { ok: false, error: `No encuentro ninguna partida con «${fragmento}» en ese presupuesto. No he cambiado nada.` };
  }
  // «Metros»: si la partida dice otra unidad (p. ej. «ud»), no es esa.
  if (unidad && idx.length > 1) {
    const esMetro = /^(m|m2|m²|m3|ml|metros?)$/i.test(unidad.trim());
    const conUnidadDistinta = (p: Partida) => (esMetro ? /\b(ud|uds|unidad(es)?)\b/i.test(p.concepto) : /\b(m2|m²|ml)\b/i.test(p.concepto));
    const filtrado = idx.filter((i) => !conUnidadDistinta(partidas[i]));
    if (filtrado.length > 0) idx = filtrado;
  }
  if (idx.length > 1 && !pideDemolicion) {
    const sinDemolicion = idx.filter((i) => !RAICES_DEMOLICION.has(raices(partidas[i].concepto)[0] ?? ''));
    if (sinDemolicion.length > 0) idx = sinDemolicion;
  }
  if (idx.length > 1) {
    return pregunta(
      `Hay varias partidas con «${fragmento}». ¿Cuál es? No he cambiado nada.`,
      idx.map((i) => ({ id: `partida-${i + 1}`, etiqueta: etiquetaPartida(partidas[i]) }))
    );
  }
  const i = idx[0];
  const p = partidas[i];
  const cobertura = frag.length / Math.max(1, new Set(raices(p.concepto)).size);
  if (cobertura < 0.5) {
    if (modo === 'quitar') {
      return pregunta(
        `«${fragmento}» es solo una parte de la partida «${p.concepto}» (${euros(p.cantidad * p.precio)}). ¿Qué hago? No he cambiado nada.`,
        [
          { id: `partida-${i + 1}-quitar`, etiqueta: `Quitar la partida entera «${p.concepto}» (${euros(p.cantidad * p.precio)})` },
          {
            id: `partida-${i + 1}-renombrar`,
            etiqueta: `Dejar la partida pero cambiándole el nombre y/o el precio (dime cómo debe quedar y a cuánto, p. ej. «Plato de ducha» sin «${fragmento}»)`,
          },
        ]
      );
    }
    return pregunta(
      `Solo encuentro «${p.concepto}», que contiene «${fragmento}» pero parece otra cosa. ¿Es esa la partida? No he cambiado nada.`,
      [{ id: `partida-${i + 1}`, etiqueta: etiquetaPartida(p) }]
    );
  }
  return { ok: true, indice: i };
}

export async function modificarPartidasPresupuesto(
  supabase: SupabaseClient,
  businessId: string,
  presupuestoId: string,
  cambios: CambiosPartidas,
  opciones: { aplicar: boolean }
): Promise<ResultadoEdicionPartidas> {
  const { data, error } = await supabase
    .from('presupuestos')
    .select('id, numero_presupuesto, cliente_nombre, estado, presupuesto_generado, importe_total, preview_id')
    .eq('id', presupuestoId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'No se encontró el presupuesto o no pertenece a este negocio' };
  const pres = data as Record<string, unknown>;
  const estado = String(pres.estado ?? '').toLowerCase();
  if (estado === 'facturado' || estado === 'pagado') {
    return { ok: false, error: `El presupuesto ya está «${estado}»: no se pueden cambiar sus partidas.` };
  }

  // Un borrador reabierto desde la pantalla tiene sus propias partidas: se editaría por ahí, no a ciegas.
  const { data: borrador } = await supabase
    .from('presupuesto_borrador')
    .select('id')
    .eq('presupuesto_id', presupuestoId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (borrador) {
    return {
      ok: false,
      error: 'Este presupuesto tiene un borrador abierto en la pantalla Presupuestos: cámbialo desde ahí para que no se descuadren las partidas.',
    };
  }

  const texto = String(pres.presupuesto_generado ?? '');
  const parseado = parsePresupuestoGenerado(texto);
  const partidas: Partida[] = parseado.capitulos.flatMap((c) =>
    c.partidas.map((p) => ({
      concepto: p.concepto,
      cantidad: p.cantidad,
      precio: p.precio,
      capitulo: c.nombre.replace(/^CAP[IÍ]TULO\s+/i, '').trim() || 'GENERAL',
    }))
  );
  if (partidas.length === 0) {
    return { ok: false, error: 'No encuentro partidas en ese presupuesto (no está en formato de partidas), así que no puedo modificarlas.' };
  }

  const totalAnterior = Number(pres.importe_total);
  const frases: string[] = [];

  for (const frag of cambios.quitar ?? []) {
    const r = buscarUna(partidas, frag, 'quitar');
    if (!r.ok) return r;
    const [q] = partidas.splice(r.indice, 1);
    frases.push(`quitar «${q.concepto}» (${euros(q.cantidad * q.precio)})`);
  }
  for (const c of cambios.cambiar ?? []) {
    const r = buscarUna(partidas, c.partida, 'cambiar', c.unidad);
    if (!r.ok) return r;
    const p = partidas[r.indice];
    const antes = `${num(p.cantidad)} × ${euros(p.precio)}`;
    const conceptoAntes = p.concepto;
    if (c.sumar_cantidad !== undefined) {
      if (!Number.isFinite(c.sumar_cantidad)) return { ok: false, error: 'La cantidad a sumar no es válida.' };
      p.cantidad = p.cantidad + c.sumar_cantidad;
    }
    if (c.cantidad !== undefined) {
      if (!Number.isFinite(c.cantidad) || c.cantidad < 0) return { ok: false, error: 'La cantidad no es válida.' };
      p.cantidad = c.cantidad;
    }
    if (c.precio_unitario !== undefined) {
      if (!Number.isFinite(c.precio_unitario) || c.precio_unitario < 0) return { ok: false, error: 'El precio no es válido.' };
      p.precio = c.precio_unitario;
    }
    const nuevoNombre = (c.nuevo_concepto ?? c.concepto)?.trim();
    if (nuevoNombre) p.concepto = nuevoNombre;
    frases.push(`«${conceptoAntes}»${p.concepto !== conceptoAntes ? ` pasa a «${p.concepto}»` : ''}: ${antes} → ${num(p.cantidad)} × ${euros(p.precio)}`);
  }
  for (const a of cambios.anadir ?? []) {
    const concepto = String(a.concepto ?? '').trim();
    if (!concepto) return { ok: false, error: 'Falta el concepto de la partida a añadir.' };
    if (a.precio_unitario === undefined || !Number.isFinite(a.precio_unitario)) {
      // Nunca se inventa un precio.
      return { ok: false, error: `¿Qué precio le pongo a «${concepto}»? No he cambiado nada.` };
    }
    if (!Number.isFinite(a.cantidad) || a.cantidad <= 0) {
      return { ok: false, error: `¿Qué cantidad le pongo a «${concepto}»? No he cambiado nada.` };
    }
    const capitulo = a.capitulo?.trim() || partidas[partidas.length - 1]?.capitulo || 'GENERAL';
    partidas.push({ concepto, cantidad: a.cantidad, precio: a.precio_unitario, capitulo });
    frases.push(`añadir «${concepto}» (${num(a.cantidad)} × ${euros(a.precio_unitario)})`);
  }
  if (frases.length === 0) {
    return { ok: false, error: 'Dime qué quieres cambiar: quitar una partida, cambiar una cantidad o precio, o añadir una.' };
  }
  if (partidas.length === 0) {
    return { ok: false, error: 'Con eso no quedaría ninguna partida en el presupuesto. No he cambiado nada.' };
  }

  const iva = cambios.iva_porcentaje ?? (parseado.porcentajeIva > 0 ? parseado.porcentajeIva : 21);
  const canon = generarTextoCanonico(
    partidas.map<PartidaCanonicaEntrada>((p) => ({ concepto: p.concepto, cantidad: p.cantidad, precio: p.precio, capitulo: p.capitulo })),
    iva
  );
  if (!canon.ok) return { ok: false, error: canon.error };

  // Lo que hubiera detrás del pie (p. ej. «Observaciones: …») se conserva tal cual.
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  const idxPie = lineas.map((l) => /BASE\s+IMPONIBLE:/i.test(l)).lastIndexOf(true);
  const cola = idxPie >= 0 ? lineas.slice(idxPie + 1).join('\n') : '';
  const textoNuevo = cola.trim() ? `${canon.texto}\n${cola}` : canon.texto;

  if (cambios.iva_porcentaje !== undefined && cambios.iva_porcentaje !== parseado.porcentajeIva) {
    frases.push(`IVA ${parseado.porcentajeIva} % → ${cambios.iva_porcentaje} %`);
  }

  if (opciones.aplicar) {
    const { error: errUpd } = await supabase
      .from('presupuestos')
      .update({ presupuesto_generado: textoNuevo, importe_total: canon.total })
      .eq('id', presupuestoId)
      .eq('business_id', businessId);
    if (errUpd) return { ok: false, error: errUpd.message };

    // Si nació de una previsualización, la factura leería SUS partidas: se dejan al día para que coincidan.
    const previewId = typeof pres.preview_id === 'string' ? pres.preview_id : '';
    if (previewId) {
      const { error: errPrev } = await supabase
        .from('presupuesto_previews')
        .update({
          partidas: canon.partidas.map((p) => ({ concepto: p.concepto, cantidad: p.cantidad, precio: p.precio, capitulo: p.capitulo, unidad: null })),
          texto_canonico: canon.texto,
          iva_porcentaje: iva,
          base_imponible: canon.base,
          iva_importe: canon.ivaImporte,
          total: canon.total,
        })
        .eq('id', previewId)
        .eq('business_id', businessId);
      if (errPrev) return { ok: false, error: `Se guardó el presupuesto, pero no se pudo actualizar su previsualización: ${errPrev.message}` };
    }
  }

  return {
    ok: true,
    presupuesto_id: presupuestoId,
    numero: pres.numero_presupuesto == null ? null : Number(pres.numero_presupuesto),
    cliente: typeof pres.cliente_nombre === 'string' ? pres.cliente_nombre : null,
    total_anterior: Number.isFinite(totalAnterior) ? totalAnterior : null,
    total_nuevo: canon.total,
    cambios: frases,
    texto: textoNuevo,
    aplicado: opciones.aplicar,
  };
}
