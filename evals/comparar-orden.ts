/**
 * Compara la orden que sacó el traductor REAL con la que debía salir (`evals/ordenes-jev.ts`, `evals/ronda6.ts`).
 * Es una comparación «de persona»: sin mayúsculas, tildes ni artículos, y solo de lo que el usuario DIJO.
 * También detecta datos INVENTADOS: un número o un nombre en un campo que no está en el mensaje.
 */
import type { ResultadoCompletar } from '@/lib/jev/ordenes';

export type Veredicto = { ok: boolean; motivos: string[]; inventados: string[] };

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'a', 'al', 'en', 'con', 'para', 'por', 'y', 'lo', 'que', 'se', 'ha', 'hoy']);
const tokens = (s: string) => norm(s).split(' ').filter((t) => t && !VACIAS.has(t));

/** ¿Dicen lo mismo? (todos los trozos de uno están en el otro). */
export function coincide(actual: unknown, esperado: unknown): boolean {
  const a = new Set(tokens(String(actual ?? '')));
  const e = new Set(tokens(String(esperado ?? '')));
  if (!a.size || !e.size) return a.size === e.size;
  return [...e].every((t) => a.has(t)) || [...a].every((t) => e.has(t));
}

const NUMERICOS = ['importe_texto', 'horas_texto', 'cantidad_texto', 'precio_texto'];
const ENTIDADES = ['cliente_texto', 'obra_texto', 'proveedor_texto', 'operario_texto', 'presupuesto_texto', 'factura_texto'];
/** Texto libre: basta con que el modelo lo haya rellenado. */
/** Texto libre opcional: si el modelo no lo rellena, el servidor pone uno por defecto. */
const LIBRES_OPCIONALES = ['titulo_texto', 'descripcion_texto'];
const LIBRES = ['titulo_texto', 'descripcion_texto', 'texto', 'notas_texto', 'unidad_texto', 'lugar_texto', 'nombre_texto', 'direccion_texto', 'dictado'];
const COMODINES = ['ese', 'esa', 'esta', 'este', 'ultimo', 'ultima', 'hoy', 'manana'];

const numeros = (s: string) => (norm(s).match(/\d+(?: \d+)?/g) ?? []).map((n) => n.replace(/ /g, ''));

/** Lo que el usuario quiso decir con el IVA, mirando el mensaje (no la orden esperada, que a veces simula un fallo del modelo). */
export function ivaDelMensaje(mensaje: string): 'mas' | 'incluido' | null {
  const m = norm(mensaje);
  if (/\bmas iva\b|\biva aparte\b|\bsin iva\b/.test(m)) return 'mas';
  if (/\bcon iva\b|\biva incluido\b/.test(m)) return 'incluido';
  return null;
}

export function datosInventados(mensaje: string, orden: Record<string, unknown>): string[] {
  const out: string[] = [];
  const dicho = norm(mensaje);
  const numerosDichos = new Set(numeros(mensaje));
  const dichoTokens = new Set(tokens(mensaje));
  const revisar = (k: string, v: unknown) => {
    if (typeof v !== 'string') return;
    if (NUMERICOS.includes(k)) {
      // Cifras en letras («doce») no se pueden comprobar: solo se revisan las que vienen en cifras.
      for (const n of numeros(v)) if (!numerosDichos.has(n)) out.push(`${k}="${v}" (no está en el mensaje)`);
    } else if (k === 'fecha_texto' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
      out.push(`${k}="${v}" (fecha calculada por el modelo)`);
    } else if (ENTIDADES.includes(k)) {
      const t = tokens(v);
      if (t.length && !COMODINES.includes(norm(v)) && !t.some((x) => dichoTokens.has(x) || dicho.includes(x))) out.push(`${k}="${v}" (no está en el mensaje)`);
    }
  };
  for (const [k, v] of Object.entries(orden)) {
    if (Array.isArray(v)) for (const it of v) for (const [kk, vv] of Object.entries((it ?? {}) as Record<string, unknown>)) revisar(kk, vv);
    else revisar(k, v);
  }
  return out;
}

export function compararOrden(mensaje: string, esperada: Record<string, unknown>, r: ResultadoCompletar): Veredicto {
  const motivos: string[] = [];
  const accionEsperada = String(esperada.accion);
  const actual: Record<string, unknown> = r.estado === 'completa' ? (r.orden as Record<string, unknown>) : r.estado === 'faltan' ? r.cruda : {};
  const inventados = datosInventados(mensaje, actual);

  if (accionEsperada === 'ACLARAR') {
    if (r.estado === 'completa' && r.orden.accion !== 'ACLARAR') motivos.push(`esperaba una pregunta y salió ${r.orden.accion} completa`);
    return { ok: motivos.length === 0 && inventados.length === 0, motivos, inventados };
  }
  if (r.estado === 'aclarar') return { ok: false, motivos: [`ACLARAR (${r.motivo}): «${r.pregunta}»`], inventados };
  if (actual.accion !== accionEsperada) motivos.push(`acción ${String(actual.accion)} en vez de ${accionEsperada}`);
  if (r.estado === 'faltan') motivos.push(`faltan datos que sí dijo: ${r.faltantes.join(', ')}`);

  for (const [k, e] of Object.entries(esperada)) {
    if (k === 'accion') continue;
    const a = actual[k];
    if (k === 'iva_modo') {
      const q = ivaDelMensaje(mensaje);
      if ((a ?? null) !== q) motivos.push(`iva_modo ${JSON.stringify(a ?? null)} en vez de ${JSON.stringify(q)}`);
    } else if (Array.isArray(e)) {
      const la = Array.isArray(a) ? (a as Array<Record<string, unknown>>) : [];
      if (la.length !== e.length) motivos.push(`${k}: ${la.length} elementos en vez de ${e.length}`);
      else
        e.forEach((it, i) => {
          for (const [kk, ee] of Object.entries(it as Record<string, unknown>)) {
            if (LIBRES.includes(kk) && kk !== 'concepto_texto') continue;
            if (!coincide(la[i]![kk], ee)) motivos.push(`${k}[${i}].${kk}: «${String(la[i]![kk] ?? '')}» en vez de «${String(ee)}»`);
          }
        });
    } else if (k === 'proveedor_texto' && a === undefined && esperada.accion === 'GASTO') {
      // Sin tienda nombrada, el servidor guarda el gasto con la categoría («Material») como proveedor: mismo resultado.
    } else if (LIBRES.includes(k)) {
      if (a === undefined && !LIBRES_OPCIONALES.includes(k)) motivos.push(`${k}: vacío`);
    } else if (k === 'estado' || k === 'documento' || k === 'categoria') {
      if (a !== e) motivos.push(`${k}: ${JSON.stringify(a ?? null)} en vez de ${JSON.stringify(e)}`);
    } else if (typeof e === 'string' && !dichoEnMensaje(mensaje, e, k)) {
      // El valor esperado no sale del mensaje (en las pruebas simuladas a veces simula un fallo del modelo): no se exige.
    } else if (!coincide(a, e)) motivos.push(`${k}: «${String(a ?? '')}» en vez de «${String(e)}»`);
  }
  if (inventados.length) motivos.push(`datos inventados: ${inventados.join('; ')}`);
  return { ok: motivos.length === 0, motivos, inventados };
}

function dichoEnMensaje(mensaje: string, valor: string, clave: string): boolean {
  if (COMODINES.includes(norm(valor))) return true;
  if (NUMERICOS.includes(clave)) return numeros(mensaje).includes(numeros(valor)[0] ?? '#');
  const t = tokens(valor);
  const d = new Set(tokens(mensaje));
  return t.length > 0 && t.every((x) => d.has(x) || norm(mensaje).includes(x));
}
