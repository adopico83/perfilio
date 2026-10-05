/**
 * Cálculo puro del «Resumen del día». No toca base de datos: recibe filas ya cargadas
 * y devuelve los avisos agrupados, cada uno con el enlace a su obra, cita, presupuesto o factura.
 */

export const TZ_MADRID = 'Europe/Madrid';
/** Una obra activa sin entradas de diario en los últimos N días se considera parada. */
export const DIAS_OBRA_PARADA = 5;
/** Un presupuesto enviado hace más de N días sin respuesta se avisa. */
export const DIAS_PRESUPUESTO_SIN_RESPUESTA = 7;

export const ESTADOS_OBRA_ACTIVA = ['abierta', 'en_curso', 'activa'];
/** `pendiente` = enviado y a la espera del OK del cliente (no hay fecha de envío propia). */
export const ESTADOS_PRESUPUESTO_SIN_RESPUESTA = ['pendiente', 'enviado'];
export const ESTADOS_FACTURA_ABIERTA = ['pendiente', 'vencida'];

export type CitaRow = { id: string; titulo: string | null; hora: string | null; fecha: string | null };
export type ObraRow = {
  id: string;
  nombre: string | null;
  estado: string | null;
  created_at?: string | null;
  fecha_inicio?: string | null;
};
export type DiarioRow = { obra_id: string | null; fecha: string | null };
export type PresupuestoRow = {
  id: string;
  estado: string | null;
  cliente_nombre: string | null;
  numero_presupuesto?: string | number | null;
  importe_total: number | string | null;
  fecha?: string | null;
  created_at?: string | null;
};
export type FacturaRow = {
  id: string;
  estado: string | null;
  numero_factura: string | null;
  cliente_nombre: string | null;
  total: number | string | null;
  fecha_vencimiento: string | null;
};

export type ResumenTipo =
  | 'cita'
  | 'obra_parada'
  | 'presupuesto_sin_respuesta'
  | 'factura_pendiente'
  | 'factura_vencida';

export type ResumenItem = {
  tipo: ResumenTipo;
  id: string;
  titulo: string;
  detalle: string;
  href: string;
};

export type ResumenDia = {
  fecha: string;
  citasHoy: ResumenItem[];
  citasManana: ResumenItem[];
  obrasParadas: ResumenItem[];
  presupuestosSinRespuesta: ResumenItem[];
  facturasPendientes: ResumenItem[];
  facturasVencidas: ResumenItem[];
  totalAvisos: number;
  todoEnOrden: boolean;
};

export type ResumenDatos = {
  citas: CitaRow[];
  obras: ObraRow[];
  /** Entradas de diario recientes (basta con las de los últimos DIAS_OBRA_PARADA días). */
  diario: DiarioRow[];
  presupuestos: PresupuestoRow[];
  facturas: FacturaRow[];
};

export function ymdMadrid(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MADRID,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function sumarDias(ymd: string, dias: number): string {
  return new Date(ymdToUtcMs(ymd) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Días naturales entre dos fechas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / 86_400_000);
}

/** Primer AAAA-MM-DD de un valor `date` o `timestamptz`; los timestamps se pasan a hora de Madrid. */
function aYmd(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : ymdMadrid(d);
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function euros(v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function unir(...partes: Array<string | null>): string {
  return partes.filter((p): p is string => Boolean(p && p.trim())).join(' · ');
}

function itemsCitas(rows: CitaRow[], fecha: string): ResumenItem[] {
  return rows
    .filter((c) => c.fecha === fecha)
    .sort((a, b) => (a.hora ?? '99:99').localeCompare(b.hora ?? '99:99'))
    .map((c) => ({
      tipo: 'cita' as const,
      id: c.id,
      titulo: (c.titulo ?? '').trim() || 'Cita',
      detalle: (c.hora ?? '').trim() || 'Sin hora',
      href: '/agenda',
    }));
}

export function calcularObrasParadas(obras: ObraRow[], diario: DiarioRow[], hoy: string): ResumenItem[] {
  const desde = sumarDias(hoy, -DIAS_OBRA_PARADA);
  const conEntradaReciente = new Set(
    diario.filter((e) => e.obra_id && (e.fecha ?? '') >= desde).map((e) => e.obra_id as string)
  );
  const items: ResumenItem[] = [];
  for (const o of obras) {
    if (!ESTADOS_OBRA_ACTIVA.includes(norm(o.estado) || 'abierta')) continue;
    if (conEntradaReciente.has(o.id)) continue;
    // Una obra recién creada todavía no ha tenido tiempo de acumular entradas.
    const inicio = aYmd(o.fecha_inicio) ?? aYmd(o.created_at);
    if (inicio && inicio >= desde) continue;
    items.push({
      tipo: 'obra_parada',
      id: o.id,
      titulo: (o.nombre ?? '').trim() || 'Obra sin nombre',
      detalle: `Sin entradas en el diario en los últimos ${DIAS_OBRA_PARADA} días`,
      href: `/obras?id=${encodeURIComponent(o.id)}`,
    });
  }
  return items;
}

export function calcularPresupuestosSinRespuesta(rows: PresupuestoRow[], hoy: string): ResumenItem[] {
  return rows
    .filter((p) => ESTADOS_PRESUPUESTO_SIN_RESPUESTA.includes(norm(p.estado)))
    .map((p) => ({ p, base: aYmd(p.fecha) ?? aYmd(p.created_at) }))
    .filter((x): x is { p: PresupuestoRow; base: string } => x.base !== null)
    .map((x) => ({ ...x, dias: diasEntre(x.base, hoy) }))
    .filter((x) => x.dias > DIAS_PRESUPUESTO_SIN_RESPUESTA)
    .sort((a, b) => b.dias - a.dias)
    .map(({ p, dias }) => ({
      tipo: 'presupuesto_sin_respuesta' as const,
      id: p.id,
      titulo: unir(p.numero_presupuesto != null ? `Presupuesto ${p.numero_presupuesto}` : 'Presupuesto', (p.cliente_nombre ?? '').trim()),
      detalle: unir(euros(p.importe_total), `enviado hace ${dias} días`),
      href: `/presupuestos?id=${encodeURIComponent(p.id)}`,
    }));
}

export function calcularFacturas(
  rows: FacturaRow[],
  hoy: string
): { pendientes: ResumenItem[]; vencidas: ResumenItem[] } {
  const pendientes: ResumenItem[] = [];
  const vencidas: ResumenItem[] = [];
  for (const f of rows) {
    const estado = norm(f.estado);
    if (!ESTADOS_FACTURA_ABIERTA.includes(estado)) continue;
    const venc = aYmd(f.fecha_vencimiento);
    const vencida = estado === 'vencida' || (venc !== null && venc < hoy);
    const titulo = unir(f.numero_factura ? `Factura ${f.numero_factura}` : 'Factura', (f.cliente_nombre ?? '').trim());
    const href = `/facturas?id=${encodeURIComponent(f.id)}`;
    if (vencida) {
      const dias = venc ? diasEntre(venc, hoy) : null;
      vencidas.push({
        tipo: 'factura_vencida',
        id: f.id,
        titulo,
        detalle: unir(euros(f.total), dias && dias > 0 ? `vencida hace ${dias} días` : 'vencida'),
        href,
      });
    } else {
      pendientes.push({
        tipo: 'factura_pendiente',
        id: f.id,
        titulo,
        detalle: unir(euros(f.total), venc ? `vence el ${venc}` : null),
        href,
      });
    }
  }
  return { pendientes, vencidas };
}

export function calcularResumenDia(datos: ResumenDatos, now: Date = new Date()): ResumenDia {
  const hoy = ymdMadrid(now);
  const manana = sumarDias(hoy, 1);
  const citas = datos.citas;
  const citasHoy = itemsCitas(citas, hoy);
  const citasManana = itemsCitas(citas, manana);
  const obrasParadas = calcularObrasParadas(datos.obras, datos.diario, hoy);
  const presupuestosSinRespuesta = calcularPresupuestosSinRespuesta(datos.presupuestos, hoy);
  const { pendientes, vencidas } = calcularFacturas(datos.facturas, hoy);
  const totalAvisos =
    citasHoy.length +
    citasManana.length +
    obrasParadas.length +
    presupuestosSinRespuesta.length +
    pendientes.length +
    vencidas.length;
  return {
    fecha: hoy,
    citasHoy,
    citasManana,
    obrasParadas,
    presupuestosSinRespuesta,
    facturasPendientes: pendientes,
    facturasVencidas: vencidas,
    totalAvisos,
    todoEnOrden: totalAvisos === 0,
  };
}

const SECCIONES: Array<[keyof ResumenDia, string]> = [
  ['citasHoy', 'Citas de hoy'],
  ['citasManana', 'Citas de mañana'],
  ['obrasParadas', 'Obras paradas'],
  ['presupuestosSinRespuesta', 'Presupuestos sin respuesta'],
  ['facturasVencidas', 'Facturas vencidas'],
  ['facturasPendientes', 'Facturas pendientes de cobro'],
];

/** Texto plano del resumen: lo que se guarda como mensaje de la notificación. */
export function textoResumen(r: ResumenDia): string {
  if (r.todoEnOrden) return 'Resumen del día: todo en orden.';
  const lineas = ['Resumen del día:'];
  for (const [clave, titulo] of SECCIONES) {
    const items = r[clave] as ResumenItem[];
    if (items.length === 0) continue;
    lineas.push(`${titulo} (${items.length}):`);
    for (const i of items) lineas.push(`- ${unir(i.titulo, i.detalle)}`);
  }
  return lineas.join('\n');
}
