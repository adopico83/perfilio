/**
 * COLA de órdenes de una misma frase. Cuando el usuario pide varias cosas, cada orden tiene una CLAVE (lo que la hace «la misma»: tipo +
 * datos que importan, sin importar cómo estén escritos) y un estado:
 *   en_cola  → todavía no se ha enseñado,
 *   enseñada → está pendiente del «Sí» (existe como orden pendiente en el servidor),
 *   hecha    → ya se guardó.
 * Los estados viajan con la orden pendiente (en su JSON; la tabla no admite estados nuevos sin migración). Con ellos:
 *   - una orden idéntica a otra de la misma frase NO se prepara ni se guarda dos veces;
 *   - una orden en cola solo puede confirmarse después de haberse enseñado (solo existe como pendiente cuando se enseña);
 *   - lo ya hecho no se repite.
 */
import { numerosDelMensaje } from '@/lib/jev/fechas';

export type EstadoCola = 'en_cola' | 'enseñada' | 'hecha';
export type PlanCola = Record<string, EstadoCola>;

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Campos que no cambian «qué orden es» (el modelo los rellena distinto en cada copia). */
const IGNORADOS = new Set(['accion', 'iva_modo', 'descripcion_texto', 'notas_texto', 'titulo_texto', 'sin_obra', 'estado', 'documento']);
const RELLENO = new Set(['el', 'la', 'los', 'las', 'lo', 'de', 'del', 'un', 'una', 'para', 'pa', 'en', 'a', 'al', 'con', 'y', 'horas', 'hora', 'h', 'euros', 'euro', 'eur', 'metros', 'metro', 'm', 'm2', 'ud', 'uds', 'unidades']);

function canonico(valor: string): string {
  const t = sinTildes(valor).replace(/€/g, ' ');
  // Los números se escriben igual («87,40» = «87.40» = «87,4»).
  const conNumeros = t.replace(/\d+(?:[.,]\d+)*/g, (m) => String(numerosDelMensaje(m)[0] ?? m));
  return conNumeros
    .split(/[^a-z0-9ñ.]+/)
    .filter((w) => w && !RELLENO.has(w))
    .join(' ');
}

function recoge(v: unknown, clave: string, out: string[]): void {
  if (typeof v === 'string') {
    if (!IGNORADOS.has(clave) && v.trim()) out.push(`${clave}=${canonico(v)}`);
  } else if (Array.isArray(v)) {
    const sub = v.map((x) => {
      const hijos: string[] = [];
      recoge(x, clave, hijos);
      return hijos.sort().join(',');
    });
    out.push(`${clave}=[${sub.sort().join(';')}]`);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) recoge(x, k, out);
  }
}

/** La clave de una orden: dos órdenes con la misma clave son «la misma» aunque estén escritas distinto. */
export function claveOrden(orden: unknown): string {
  const o = (orden ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  for (const [k, v] of Object.entries(o)) recoge(v, k, partes);
  return `${String(o.accion ?? '')}|${partes.filter((p) => !/=$/.test(p)).sort().join('|')}`;
}

/** Quita las órdenes que repiten a otra anterior (misma clave). Devuelve también las que se han quitado. */
export function sinRepetidas<T>(ordenes: T[]): { ordenes: T[]; repetidas: T[] } {
  const vistas = new Set<string>();
  const out: T[] = [];
  const repetidas: T[] = [];
  for (const o of ordenes) {
    const k = claveOrden(o);
    if (vistas.has(k)) repetidas.push(o);
    else {
      vistas.add(k);
      out.push(o);
    }
  }
  return { ordenes: out, repetidas };
}

/** Plan de una frase: la primera se enseña ya; las demás esperan en la cola. */
export function planInicial(primera: unknown, siguientes: unknown[], previo: PlanCola = {}): PlanCola {
  const plan: PlanCola = { ...previo };
  plan[claveOrden(primera)] = 'enseñada';
  for (const s of siguientes) {
    const k = claveOrden(s);
    if (!plan[k]) plan[k] = 'en_cola';
  }
  return plan;
}

/**
 * La siguiente orden de la cola que de verdad toca preparar: se saltan las que ya están hechas o ya enseñadas (repeticiones).
 * `saltadas` se cuentan al usuario; nada se descarta sin decirlo.
 */
export function siguienteDeLaCola<T>(siguientes: T[], plan: PlanCola): { sig: T | null; resto: T[]; saltadas: T[] } {
  const saltadas: T[] = [];
  const cola = [...siguientes];
  while (cola.length) {
    const cand = cola.shift()!;
    const estado = plan[claveOrden(cand)];
    if (estado === 'hecha' || estado === 'enseñada') {
      saltadas.push(cand);
      continue;
    }
    return { sig: cand, resto: cola, saltadas };
  }
  return { sig: null, resto: [], saltadas };
}
