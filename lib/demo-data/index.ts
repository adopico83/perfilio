/**
 * Datos mock del tenant demo (Orbegozo Dekorazio, Bizkaia).
 * Solo se usan cuando `useDemoTenant() && DEMO_MOCK_ENABLED`; el resto de tenants no los toca.
 * Todo es ficticio y las fechas son relativas a hoy (ver ./fechas).
 */
import { GASTO_CATEGORIAS } from '@/lib/gastos-categoria';
import type { LineaPresupuestoMetrica } from '@/lib/demo-metricas';
import type { EmpresaEmisor } from '@/lib/pdf/empresa';
import {
  DEMO_BUSINESS_ID,
  DEMO_CLIENTES,
  DEMO_EMPRESA,
  DEMO_OBRAS_BASE,
  descripcionObra,
} from './orbegozo-base';
import { construirAlbaranes, construirFacturas, construirPresupuestos } from './orbegozo-docs';
import {
  DEMO_OPERARIOS,
  construirAgenda,
  construirDiario,
  construirGastos,
  gastosDelMes,
  construirMensajes,
  construirRegistrosJornada,
} from './orbegozo-operativa';
import { demoFecha, demoHoy, demoMesActual } from './fechas';
import type {
  AgendaEvento,
  DemoClienteFicha,
  DemoClienteRow,
  DemoConversation,
  DemoDiarioEntrada,
  DemoObraDetalle,
  DemoObraRow,
  DemoOperarioResumenFila,
  DemoRegistroJornada,
  DemoResumenGastos,
  DemoResumenOperarios,
  HoyObra,
  HoyPresupuesto,
} from './types';

/** Datos del emisor para el editor de facturas en demo. */
export const DEMO_EMPRESA_EMISOR: EmpresaEmisor = {
  razonSocial: DEMO_EMPRESA.nombre,
  nif: null,
  rea: null,
  direccion: DEMO_EMPRESA.direccion,
  localidad: DEMO_EMPRESA.ciudad,
  telefono: DEMO_EMPRESA.telefono,
  email: DEMO_EMPRESA.email,
  web: null,
  instagram: null,
  cuentasBancarias: [],
};

/** Interruptor global del mock. Con `false` el tenant demo vuelve a leer de Supabase. */
export const DEMO_MOCK_ENABLED = true;

export { DEMO_BUSINESS_ID, DEMO_CLIENTES, DEMO_EMPRESA, DEMO_OPERARIOS };
export * from './fechas';
export type * from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const byCreatedDesc = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

/* ------------------------------ Documentos ------------------------------ */

export function getDemoPresupuestos(now: Date = new Date()) {
  return byCreatedDesc(construirPresupuestos(now));
}

export function getDemoFacturas(now: Date = new Date()) {
  return byCreatedDesc(construirFacturas(now));
}

export function getDemoAlbaranes(now: Date = new Date()) {
  return byCreatedDesc(construirAlbaranes(now));
}

export function getDemoPresupuestosMetrica(now: Date = new Date()): LineaPresupuestoMetrica[] {
  return getDemoPresupuestos(now).map((p) => ({
    id: p.id,
    cliente_nombre: p.cliente_nombre,
    fecha: p.fecha,
    importe_total: p.importe_total,
    presupuesto_generado: p.presupuesto_generado,
  }));
}

/* --------------------------------- Home --------------------------------- */

export function getDemoHoy(now: Date = new Date()): {
  clientes: Array<{ id: string; nombre: string }>;
  obras: HoyObra[];
  presupuestos: HoyPresupuesto[];
} {
  const nombres = new Map(DEMO_CLIENTES.map((c) => [c.id, c.nombre]));
  return {
    // Orden del dataset (clientes de las obras destacadas primero): la home solo enseña 3.
    clientes: DEMO_CLIENTES.map((c) => ({ id: c.id, nombre: c.nombre })),
    obras: DEMO_OBRAS_BASE.map((o) => ({
      id: o.id,
      nombre: o.nombre,
      estado: o.estado,
      direccion: o.direccion,
      cliente_nombre: nombres.get(o.clienteId) ?? null,
    })),
    presupuestos: getDemoPresupuestos(now).map((p) => ({
      id: p.id,
      estado: p.estado,
      obra_id: p.obra_id,
      importe_total: p.importe_total,
      cliente_nombre: p.cliente_nombre,
      presupuesto_generado: p.presupuesto_generado,
    })),
  };
}

/* --------------------------------- Agenda -------------------------------- */

/** Próximas citas (hoy en adelante), como la query de la card de la home. */
export function getDemoAgendaProximos(now: Date = new Date(), limite = 4): AgendaEvento[] {
  const hoy = demoHoy(now);
  return construirAgenda(now)
    .filter((e) => e.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? '').localeCompare(b.hora ?? ''))
    .slice(0, limite);
}

/** Citas del mes (`month` 0-11), como la query del calendario. */
export function getDemoAgendaMes(year: number, month: number, now: Date = new Date()): AgendaEvento[] {
  const prefijo = `${year}-${String(month + 1).padStart(2, '0')}`;
  return construirAgenda(now)
    .filter((e) => e.fecha.startsWith(prefijo))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/* ---------------------------------- Obras --------------------------------- */

export function getDemoObras(now: Date = new Date()): DemoObraRow[] {
  const presupuestos = construirPresupuestos(now);
  const facturas = construirFacturas(now);
  const albaranes = construirAlbaranes(now);
  const gastos = construirGastos(now);
  const diario = construirDiario(now);
  const nombres = new Map(DEMO_CLIENTES.map((c) => [c.id, c.nombre]));
  return DEMO_OBRAS_BASE.map((o) => {
    const num_presupuestos = presupuestos.filter((x) => x.obra_id === o.id).length;
    const num_facturas = facturas.filter((x) => x.obra_id === o.id).length;
    const num_albaranes = albaranes.filter((x) => x.obra_id === o.id).length;
    const num_gastos = gastos.filter((x) => x.obra_id === o.id).length;
    const tiene_diario = diario.some((x) => x.obra_id === o.id) ? 1 : 0;
    return {
      id: o.id,
      nombre: o.nombre,
      cliente_nombre: nombres.get(o.clienteId) ?? null,
      cliente_id: o.clienteId,
      direccion: o.direccion,
      estado: o.estado,
      fecha_inicio: demoFecha(o.inicio, now),
      fecha_fin: demoFecha(o.fin, now),
      descripcion: descripcionObra(o),
      num_presupuestos,
      num_facturas,
      num_albaranes,
      num_gastos,
      tiene_diario,
      total_documentos: num_presupuestos + num_facturas + num_albaranes + num_gastos + tiene_diario,
    };
  });
}

export function getDemoObraDetalle(id: string, now: Date = new Date()): DemoObraDetalle | null {
  const fila = getDemoObras(now).find((o) => o.id === id);
  if (!fila) return null;
  const cli = DEMO_CLIENTES.find((c) => c.id === fila.cliente_id) ?? null;
  const gastos = construirGastos(now)
    .filter((g) => g.obra_id === id)
    .map((g) => ({ id: g.id, fecha: g.fecha, proveedor: g.proveedor, descripcion: g.descripcion, categoria: g.categoria, importe: g.importe, iva: g.iva, importe_total: g.importe_total }));
  return {
    obra: {
      id: fila.id,
      business_id: DEMO_BUSINESS_ID,
      nombre: fila.nombre,
      cliente_id: fila.cliente_id,
      direccion: fila.direccion,
      estado: fila.estado,
      fecha_inicio: fila.fecha_inicio,
      fecha_fin: fila.fecha_fin,
      descripcion: fila.descripcion,
    },
    cliente: cli ? { id: cli.id, nombre: cli.nombre, direccion: cli.direccion } : null,
    presupuestos: getDemoPresupuestos(now).filter((x) => x.obra_id === id),
    facturas: getDemoFacturas(now).filter((x) => x.obra_id === id),
    albaranes: getDemoAlbaranes(now).filter((x) => x.obra_id === id),
    entradas_diario_obra: getDemoDiario(now).filter((x) => x.obra_id === id),
    gastos,
    registros_jornada: getDemoRegistrosJornada(id, now),
  };
}

/* ---------------------------------- Diario -------------------------------- */

export function getDemoDiario(now: Date = new Date()): DemoDiarioEntrada[] {
  return [...construirDiario(now)].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Igual que /api/diario: agrupado por nombre de obra. */
export function getDemoDiarioAgrupado(now: Date = new Date()): Record<string, DemoDiarioEntrada[]> {
  const out: Record<string, DemoDiarioEntrada[]> = {};
  for (const e of getDemoDiario(now)) (out[e.obra_nombre] ??= []).push(e);
  return out;
}

/* ---------------------------------- Gastos -------------------------------- */

export function getDemoResumenGastos(mes: string = demoMesActual(), now: Date = new Date()): DemoResumenGastos {
  const filas = gastosDelMes(mes, now);
  const nombres = new Map(DEMO_OBRAS_BASE.map((o) => [o.id, o.nombre]));
  const grupos = new Map<string, DemoResumenGastos['por_obra'][number]>();
  for (const { obra_id, ...fila } of filas) {
    const key = obra_id ?? '__sin_obra__';
    const g = grupos.get(key) ?? {
      obra_id,
      obra_nombre: obra_id ? (nombres.get(obra_id) ?? 'Obra') : 'Sin obra asignada',
      gastos: [],
      subtotal: 0,
    };
    g.gastos.push(fila);
    g.subtotal = round2(g.subtotal + fila.importe_total);
    grupos.set(key, g);
  }
  const por_obra = [...grupos.values()]
    .map((g) => ({ ...g, gastos: [...g.gastos].sort((a, b) => b.fecha.localeCompare(a.fecha)) }))
    .sort((a, b) => a.obra_nombre.localeCompare(b.obra_nombre, 'es'));
  return {
    mes,
    total_mes: round2(filas.reduce((s, f) => s + f.importe_total, 0)),
    por_categoria: GASTO_CATEGORIAS.map((categoria) => ({
      categoria,
      total: round2(filas.filter((f) => f.categoria === categoria).reduce((s, f) => s + f.importe_total, 0)),
    })),
    por_obra,
  };
}

/* -------------------------------- Operarios ------------------------------- */

export function getDemoRegistrosJornada(obraId: string, now: Date = new Date()): DemoRegistroJornada[] {
  return construirRegistrosJornada(demoMesActual(now), now)
    .filter((r) => r.obra_id === obraId)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function getDemoResumenOperarios(mes: string = demoMesActual(), now: Date = new Date()): DemoResumenOperarios {
  const registros = construirRegistrosJornada(mes, now);
  const nombres = new Map(DEMO_OBRAS_BASE.map((o) => [o.id, o.nombre]));
  const operarios: DemoOperarioResumenFila[] = DEMO_OPERARIOS.map((op) => {
    const propios = registros.filter((r) => r.operario_id === op.id);
    const porObra = new Map<string, DemoOperarioResumenFila['por_obra'][number]>();
    for (const r of propios) {
      const o = porObra.get(r.obra_id) ?? {
        obra_id: r.obra_id,
        obra_nombre: nombres.get(r.obra_id) ?? 'Obra',
        horas_reales: 0,
        horas_convenio: 0,
        por_dia: [],
      };
      o.horas_reales = round2(o.horas_reales + r.horas_reales);
      o.horas_convenio = round2(o.horas_convenio + r.horas_convenio);
      o.por_dia.push({ fecha: r.fecha, horas_reales: r.horas_reales, horas_convenio: r.horas_convenio });
      porObra.set(r.obra_id, o);
    }
    const por_obra = [...porObra.values()]
      .map((o) => ({ ...o, por_dia: [...o.por_dia].sort((a, b) => a.fecha.localeCompare(b.fecha)) }))
      .sort((a, b) => a.obra_nombre.localeCompare(b.obra_nombre, 'es'));
    return {
      id: op.id,
      nombre: op.nombre,
      dni: op.dni,
      horas_reales_mes: round2(por_obra.reduce((s, o) => s + o.horas_reales, 0)),
      horas_convenio_mes: round2(por_obra.reduce((s, o) => s + o.horas_convenio, 0)),
      por_obra,
    };
  });
  return {
    mes,
    operarios,
    totales: {
      horas_reales: round2(operarios.reduce((s, o) => s + o.horas_reales_mes, 0)),
      horas_convenio: round2(operarios.reduce((s, o) => s + o.horas_convenio_mes, 0)),
    },
  };
}

/* -------------------------------- Clientes -------------------------------- */

export function getDemoClientes(now: Date = new Date()): DemoClienteRow[] {
  const presupuestos = construirPresupuestos(now);
  const facturas = construirFacturas(now);
  const albaranes = construirAlbaranes(now);
  return [...DEMO_CLIENTES]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      email: c.email,
      num_presupuestos: presupuestos.filter((x) => x.cliente_id === c.id).length,
      num_facturas: facturas.filter((x) => x.cliente_id === c.id).length,
      num_albaranes: albaranes.filter((x) => x.cliente_id === c.id).length,
    }));
}

export function getDemoClienteFicha(id: string, now: Date = new Date()): DemoClienteFicha | null {
  const cliente = DEMO_CLIENTES.find((c) => c.id === id);
  if (!cliente) return null;
  const obraIds = new Set(DEMO_OBRAS_BASE.filter((o) => o.clienteId === id).map((o) => o.id));
  return {
    cliente,
    presupuestos: getDemoPresupuestos(now)
      .filter((p) => p.cliente_id === id)
      .map((p) => ({ id: p.id, estado: p.estado, importe_total: p.importe_total, fecha: p.fecha })),
    facturas: getDemoFacturas(now)
      .filter((f) => f.cliente_id === id)
      .map((f) => ({
        id: f.id,
        estado: f.estado,
        total: f.total,
        fecha: f.fecha,
        numero_factura: f.numero_factura,
      })),
    albaranes: getDemoAlbaranes(now)
      .filter((a) => a.cliente_id === id)
      .map((a) => ({
        id: a.id,
        estado: a.estado,
        fecha: a.fecha,
        total: a.total,
        numero_albaran: a.numero_albaran,
      })),
    gastos: construirGastos(now)
      .filter((g) => g.obra_id && obraIds.has(g.obra_id))
      .map((g) => ({
        id: g.id,
        proveedor: g.proveedor,
        descripcion: g.descripcion,
        importe: g.importe,
        importe_total: g.importe_total,
        fecha: g.fecha,
      })),
    diario_obra: getDemoDiario(now)
      .filter((e) => e.obra_id && obraIds.has(e.obra_id))
      .map((e) => ({ id: e.id, obra_nombre: e.obra_nombre, texto: e.texto, fecha: e.fecha })),
  };
}

/* -------------------------------- Mensajes -------------------------------- */

export function getDemoMensajes(now: Date = new Date()): DemoConversation[] {
  const orden: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
  return construirMensajes(now).sort(
    (a, b) => (orden[a.priority ?? 'normal'] ?? 1) - (orden[b.priority ?? 'normal'] ?? 1)
  );
}
