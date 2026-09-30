/** Tipos del mock demo: misma forma que las páginas que los consumen. */
import type { ObrasNombreJoin } from '@/lib/obras-nombre-join';

export type { AgendaEvento } from '@/lib/demo-calendario';
export type { HoyObra, HoyPresupuesto } from '@/lib/hoy';

export type DemoEmpresa = {
  nombre: string;
  ciudad: string;
  direccion: string;
  telefono: string;
  email: string;
};

export type DemoCliente = {
  id: string;
  business_id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  nif: string | null;
  notas: string | null;
};

/** Fila de app/clientes/page.tsx. */
export type DemoClienteRow = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  num_presupuestos: number;
  num_facturas: number;
  num_albaranes: number;
};

/** Fila de app/obras/page.tsx (respuesta de /api/obras). */
export type DemoObraRow = {
  id: string;
  nombre: string;
  cliente_nombre: string | null;
  cliente_id: string | null;
  direccion: string | null;
  estado: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  descripcion: string | null;
  num_presupuestos: number;
  num_facturas: number;
  num_albaranes: number;
  num_gastos: number;
  tiene_diario: number;
  total_documentos?: number;
};

export type DemoPresupuesto = {
  id: string;
  business_id: string;
  presupuesto_generado: string | null;
  fecha: string | null;
  estado: string | null;
  created_at: string;
  obra_id: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  numero_presupuesto: number | null;
  importe_total: number | null;
  obras?: ObrasNombreJoin;
};

export type DemoLineaDocumento = {
  concepto: string;
  cantidad: number;
  precio: number;
  importe: number;
};

export type DemoAlbaran = {
  id: string;
  business_id: string;
  numero_albaran: string | null;
  cliente_nombre: string | null;
  cliente_id: string | null;
  cliente_direccion: string | null;
  descripcion_trabajos: string | null;
  lineas: DemoLineaDocumento[];
  total: number | null;
  fecha: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
  obra_id: string | null;
  obras?: ObrasNombreJoin;
};

export type DemoFactura = {
  id: string;
  business_id: string;
  numero_factura: string | null;
  cliente_nombre: string | null;
  cliente_id: string | null;
  cliente_direccion: string | null;
  cliente_nif: string | null;
  descripcion_trabajos: string | null;
  lineas: DemoLineaDocumento[];
  base_imponible: number | null;
  iva: number | null;
  total: number | null;
  fecha: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
  obra_id: string | null;
  obras?: ObrasNombreJoin;
};

export type DemoDiarioEntrada = {
  id: string;
  obra_nombre: string;
  obra_id: string | null;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
};

export type DemoGastoFila = {
  id: string;
  fecha: string;
  proveedor: string;
  descripcion: string | null;
  categoria: string;
  importe: number;
  iva: number;
  importe_total: number;
};

export type DemoGastoResumenPorObra = {
  obra_id: string | null;
  obra_nombre: string;
  gastos: DemoGastoFila[];
  subtotal: number;
};

/** Respuesta de /api/gastos/resumen. */
export type DemoResumenGastos = {
  mes: string;
  total_mes: number;
  por_categoria: Array<{ categoria: string; total: number }>;
  por_obra: DemoGastoResumenPorObra[];
};

export type DemoOperarioResumenPorObra = {
  obra_id: string;
  obra_nombre: string;
  horas_reales: number;
  horas_convenio: number;
  por_dia: Array<{ fecha: string; horas_reales: number; horas_convenio: number }>;
};

export type DemoOperarioResumenFila = {
  id: string;
  nombre: string;
  dni: string | null;
  horas_reales_mes: number;
  horas_convenio_mes: number;
  por_obra: DemoOperarioResumenPorObra[];
};

/** Respuesta de /api/operarios/resumen. */
export type DemoResumenOperarios = {
  mes: string;
  operarios: DemoOperarioResumenFila[];
  totales: { horas_reales: number; horas_convenio: number };
};

/** Fila de registros_jornada (tab «Horas» de la ficha de obra). */
export type DemoRegistroJornada = {
  id: string;
  fecha: string;
  horas_reales: number;
  horas_convenio: number;
  notas: string | null;
  operario_id: string;
  obra_id: string;
};

export type DemoOperario = { id: string; nombre: string; dni: string | null };

/** Respuesta de /api/obras/[id]. */
export type DemoObraDetalle = {
  obra: {
    id: string;
    business_id: string;
    nombre: string;
    cliente_id: string | null;
    direccion: string | null;
    estado: string | null;
    fecha_inicio: string | null;
    fecha_fin: string | null;
    descripcion: string | null;
  };
  cliente: { id: string; nombre: string; direccion: string | null } | null;
  presupuestos: DemoPresupuesto[];
  facturas: DemoFactura[];
  albaranes: DemoAlbaran[];
  entradas_diario_obra: DemoDiarioEntrada[];
  gastos: DemoGastoFila[];
  registros_jornada: DemoRegistroJornada[];
};

/** Respuesta de /api/clientes/[id]. */
export type DemoClienteFicha = {
  cliente: DemoCliente;
  presupuestos: Array<{ id: string; estado: string | null; importe_total: number | null; fecha: string | null }>;
  facturas: Array<{
    id: string;
    estado: string | null;
    total: number | null;
    fecha: string | null;
    numero_factura: string | null;
  }>;
  albaranes: Array<{
    id: string;
    estado: string | null;
    fecha: string | null;
    total: number | null;
    numero_albaran: string | null;
  }>;
  gastos: Array<{
    id: string;
    proveedor: string;
    descripcion: string | null;
    importe: number | null;
    importe_total: number | null;
    fecha: string | null;
  }>;
  diario_obra: Array<{ id: string; obra_nombre: string; texto: string | null; fecha: string }>;
};

export type DemoAiResponse = {
  id: string;
  ai_response?: string | null;
  edited_response?: string | null;
};

/** Conversación de app/mensajes/page.tsx. */
export type DemoConversation = {
  id: string;
  customer_name?: string | null;
  customer_contact?: string | null;
  channel?: string | null;
  priority?: string | null;
  status?: string | null;
  created_at: string;
  message?: string | null;
  ai_responses?: DemoAiResponse[] | null;
};
