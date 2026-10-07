/**
 * ÚNICO sitio donde se «limpia» lo que devuelve el modelo antes de validarlo.
 *
 * GPT-4o mini, cuando el usuario no dice un dato, rellena el campo con "", "null", "N/A", "no indicado"…
 * Todo eso significa lo mismo: «no lo dijo». Aquí se convierte en `undefined` (el campo desaparece), se arreglan
 * tipos (un número donde iba texto), mayúsculas de los enums y sinónimos, y se tiran los campos que no existen.
 * No inventa nada: solo quita ruido. Lo que quede se valida en `completarOrden` (lib/jev/ordenes.ts).
 */

const sinAcentos = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
const clave = (s: string) => sinAcentos(s).toLowerCase().replace(/[.\s]+/g, ' ').trim();

const NULOS = new Set([
  '', 'null', 'none', 'nil', 'undefined', 'n/a', 'na', 'n a', 'nan', 'no indicado', 'no indicada', 'no especificado', 'no especificada',
  'no consta', 'no definido', 'no definida', 'no dicho', 'no dicha', 'no proporcionado', 'no proporcionada', 'sin dato', 'sin datos',
  'sin especificar', 'sin indicar', 'ninguno', 'ninguna', 'no aplica', 'desconocido', 'desconocida', 'no se', 'tbd', 'vacio', 'vacia',
  '-', '--', '---', '—', '–', '?', '??', '...', '…', '_', 'string', 'false',
]);

/** ¿Este texto significa «no lo dijo»? */
export const esNulo = (s: string) => NULOS.has(clave(s));

/** Texto limpio o undefined. Números → texto. Objetos/booleanos/listas → undefined (no son un literal). */
export function limpiarTexto(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  return esNulo(t) ? undefined : t.slice(0, 2000);
}

const SINONIMOS_IVA: Record<string, 'mas' | 'incluido'> = {
  mas: 'mas', '+': 'mas', 'mas iva': 'mas', '+ iva': 'mas', aparte: 'mas', 'iva aparte': 'mas', 'sin iva': 'mas', mas_iva: 'mas',
  incluido: 'incluido', 'iva incluido': 'incluido', 'con iva': 'incluido', 'ya con iva': 'incluido', incluida: 'incluido',
};
const CATEGORIAS = ['material', 'herramienta', 'vertido', 'subcontrata', 'transporte', 'otros'];
const SINONIMOS_CATEGORIA: Record<string, string> = { materiales: 'material', herramientas: 'herramienta', vertidos: 'vertido', subcontratas: 'subcontrata', transportes: 'transporte', otro: 'otros', combustible: 'transporte' };

/** Estado por acción: sinónimo → valor del esquema. */
const ESTADOS: Record<string, Record<string, string>> = {
  CERRAR_OBRA: { abierta: 'abierta', abrir: 'abierta', reabrir: 'abierta', reabierta: 'abierta', 'en curso': 'en_curso', en_curso: 'en_curso', pausada: 'pausada', pausa: 'pausada', parada: 'pausada', cerrada: 'cerrada', cerrar: 'cerrada', terminada: 'cerrada', finalizada: 'cerrada' },
  CAMBIAR_ESTADO_PRESUPUESTO: {
    borrador: 'borrador', pendiente: 'pendiente', pendientes: 'pendiente', enviado: 'enviado', enviada: 'enviado', aceptado: 'aceptado', aceptada: 'aceptado', aceptar: 'aceptado',
    aprobado: 'aprobado', aprobada: 'aprobado', rechazado: 'rechazado', rechazada: 'rechazado', rechazar: 'rechazado',
  },
  MARCAR_PAGADA: { pendiente: 'pendiente', pagada: 'pagada', pagado: 'pagada', cobrada: 'pagada', cobrado: 'pagada', vencida: 'vencida', vencido: 'vencida' },
  CONSULTA_OBRAS: { abiertas: 'abiertas', abierta: 'abiertas', activas: 'abiertas', activa: 'abiertas', 'en curso': 'abiertas', cerradas: 'cerradas', cerrada: 'cerradas', terminadas: 'cerradas', todas: 'todas', todos: 'todas' },
  CONSULTA_PRESUPUESTOS: { pendientes: 'pendientes', pendiente: 'pendientes', enviados: 'pendientes', borrador: 'pendientes', borradores: 'pendientes', aceptados: 'aceptados', aceptado: 'aceptados', aprobados: 'aceptados', todos: 'todos', todas: 'todos' },
  CONSULTA_FACTURAS: { pendiente: 'pendiente', pendientes: 'pendiente', 'sin cobrar': 'pendiente', pagada: 'pagada', pagadas: 'pagada', cobradas: 'pagada', cobrada: 'pagada', vencida: 'vencida', vencidas: 'vencida' },
};
ESTADOS.MARCAR_PAGADA!['pagadas'] = 'pagada';

/** Nombre de acción tolerante: «crear cliente», «crear-cliente», «Crear_Cliente» → CREAR_CLIENTE. */
export function normalizarAccion(v: unknown): string | undefined {
  const t = limpiarTexto(v);
  return t ? sinAcentos(t).toUpperCase().replace(/[\s-]+/g, '_') : undefined;
}

type Obj = Record<string, unknown>;
const esObjeto = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Items de una lista (partidas, cambios): cada item se limpia; se tira el que no tiene su campo clave. */
function limpiarItems(v: unknown, claveItem: string): Obj[] | undefined {
  const lista = Array.isArray(v) ? v : esObjeto(v) ? [v] : undefined;
  if (!lista) return undefined;
  const out: Obj[] = [];
  for (const it of lista) {
    if (!esObjeto(it)) continue;
    const limpio: Obj = {};
    for (const [k, val] of Object.entries(it)) {
      const t = limpiarTexto(val);
      if (t !== undefined) limpio[k] = t;
    }
    if (limpio[claveItem] !== undefined) out.push(limpio);
  }
  return out;
}

/**
 * Orden cruda del modelo → orden limpia. Idempotente. `unknown` en cualquier cosa: nunca lanza.
 * Devuelve `{}` (sin `accion`) si ni siquiera hay objeto.
 */
export function normalizarCrudo(raw: unknown): Obj {
  return normalizarConAvisos(raw).orden;
}

/** Igual que `normalizarCrudo`, pero también dice qué valores NO nulos se tiraron por no entenderse (para el log). */
export function normalizarConAvisos(raw: unknown): { orden: Obj; descartados: Array<{ campo: string; motivo: string }> } {
  const descartados: Array<{ campo: string; motivo: string }> = [];
  if (!esObjeto(raw)) return { orden: {}, descartados };
  const out: Obj = {};
  const accion = normalizarAccion(raw.accion);
  if (accion) out.accion = accion;

  for (const [k, v] of Object.entries(raw)) {
    if (k === 'accion') continue;
    if (k === 'partidas' || k === 'anadir') {
      const l = limpiarItems(v, 'concepto_texto');
      if (l !== undefined && l.length) out[k] = l;
    } else if (k === 'cambiar') {
      const l = limpiarItems(v, 'partida_texto');
      if (l !== undefined && l.length) out[k] = l;
    } else if (k === 'quitar_texto') {
      const lista = (Array.isArray(v) ? v : [v]).map(limpiarTexto).filter((x): x is string => x !== undefined);
      if (lista.length) out[k] = lista;
    } else {
      const t = limpiarTexto(v);
      if (t !== undefined) out[k] = t;
      else if (v !== null && v !== undefined && typeof v !== 'string') descartados.push({ campo: k, motivo: `tipo ${Array.isArray(v) ? 'array' : typeof v}` });
    }
  }

  const str = (k: string) => (typeof out[k] === 'string' ? (out[k] as string) : undefined);
  const iva = str('iva_modo');
  if (iva) {
    const m = SINONIMOS_IVA[clave(iva)];
    if (m) out.iva_modo = m;
    else {
      delete out.iva_modo;
      descartados.push({ campo: 'iva_modo', motivo: 'valor no válido' });
    }
  }
  const cat = str('categoria');
  if (cat) {
    const c = clave(cat);
    const v = CATEGORIAS.includes(c) ? c : SINONIMOS_CATEGORIA[c];
    if (v) out.categoria = v;
    else {
      delete out.categoria;
      descartados.push({ campo: 'categoria', motivo: 'valor no válido' });
    }
  }
  const doc = str('documento');
  if (doc) {
    const d = clave(doc);
    if (/presu/.test(d)) out.documento = 'presupuesto';
    else if (/factur/.test(d)) out.documento = 'factura';
    else {
      delete out.documento;
      descartados.push({ campo: 'documento', motivo: 'valor no válido' });
    }
  }
  const est = str('estado');
  if (est) {
    const tabla = accion ? ESTADOS[accion] : undefined;
    const e = tabla?.[clave(est)];
    if (e) out.estado = e;
    else {
      delete out.estado;
      descartados.push({ campo: 'estado', motivo: 'valor no válido' });
    }
  }
  return { orden: out, descartados };
}
