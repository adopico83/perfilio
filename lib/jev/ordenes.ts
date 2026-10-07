/**
 * Órdenes .jev: el vocabulario CERRADO con el que el modelo (GPT-4o mini) traduce lo que dice el usuario.
 *
 * Reglas del esquema (por qué es seguro):
 *  - Cada «slot» es un LITERAL del mensaje (`cliente_texto: "Iker PRUEBA"`, `fecha_texto: "el lunes"`,
 *    `importe_texto: "180"`). Nunca hay ids, fechas ISO ni totales calculados: eso lo decide el ejecutor
 *    (`lib/jev/ejecutor.ts`), que no usa ningún modelo.
 *  - Es una unión discriminada por `accion`: lo que no encaja en ninguna acción es `ACLARAR` (una pregunta)
 *    o `CHARLA` (conversación sin acción).
 */
import { z } from 'zod';

/** Un literal del mensaje, o nada. */
const lit = z.string().trim().min(1).max(600).nullish();

const iva = z.enum(['mas', 'incluido']).nullish();

const partidaSlot = z.object({
  concepto_texto: z.string().trim().min(1).max(300),
  cantidad_texto: lit,
  unidad_texto: lit,
  precio_texto: lit,
});

const cambioPartidaSlot = z.object({
  partida_texto: z.string().trim().min(1).max(200),
  cantidad_texto: lit,
  sumar_cantidad_texto: lit,
  precio_texto: lit,
  nuevo_nombre_texto: lit,
});

export const ORDENES = {
  ACLARAR: z.object({ accion: z.literal('ACLARAR'), pregunta: z.string().trim().min(1).max(400) }),
  CHARLA: z.object({ accion: z.literal('CHARLA') }),

  CREAR_CLIENTE: z.object({
    accion: z.literal('CREAR_CLIENTE'),
    nombre_texto: z.string().trim().min(1).max(200),
    telefono_texto: lit,
    email_texto: lit,
    direccion_texto: lit,
    nif_texto: lit,
  }),
  ACTUALIZAR_CLIENTE: z.object({
    accion: z.literal('ACTUALIZAR_CLIENTE'),
    cliente_texto: z.string().trim().min(1).max(200),
    nif_texto: lit,
    direccion_texto: lit,
    telefono_texto: lit,
    email_texto: lit,
    nombre_nuevo_texto: lit,
  }),
  CREAR_OBRA: z.object({
    accion: z.literal('CREAR_OBRA'),
    nombre_texto: z.string().trim().min(1).max(200),
    cliente_texto: lit,
    direccion_texto: lit,
  }),
  CERRAR_OBRA: z.object({
    accion: z.literal('CERRAR_OBRA'),
    obra_texto: z.string().trim().min(1).max(200),
    estado: z.enum(['abierta', 'en_curso', 'pausada', 'cerrada']).nullish(),
  }),

  PRESUPUESTO_DICTADO: z.object({
    accion: z.literal('PRESUPUESTO_DICTADO'),
    cliente_texto: z.string().trim().min(1).max(200),
    obra_texto: lit,
    partidas: z.array(partidaSlot).min(1).max(30),
  }),
  PRESUPUESTO_PARTIDAS: z.object({
    accion: z.literal('PRESUPUESTO_PARTIDAS'),
    presupuesto_texto: z.string().trim().min(1).max(200),
    quitar_texto: z.array(z.string().trim().min(1).max(200)).max(20).nullish(),
    cambiar: z.array(cambioPartidaSlot).max(20).nullish(),
    anadir: z.array(partidaSlot).max(20).nullish(),
  }),
  CAMBIAR_ESTADO_PRESUPUESTO: z.object({
    accion: z.literal('CAMBIAR_ESTADO_PRESUPUESTO'),
    presupuesto_texto: z.string().trim().min(1).max(200),
    estado: z.enum(['borrador', 'pendiente', 'enviado', 'aceptado', 'aprobado', 'rechazado']),
  }),
  FACTURAR: z.object({
    accion: z.literal('FACTURAR'),
    presupuesto_texto: lit,
    albaran_texto: lit,
  }),
  MARCAR_PAGADA: z.object({
    accion: z.literal('MARCAR_PAGADA'),
    factura_texto: z.string().trim().min(1).max(200),
    estado: z.enum(['pendiente', 'pagada', 'vencida']).nullish(),
  }),
  PDF_ENLACE: z.object({
    accion: z.literal('PDF_ENLACE'),
    documento: z.enum(['presupuesto', 'factura']),
    ref_texto: lit,
  }),

  DIARIO: z.object({
    accion: z.literal('DIARIO'),
    obra_texto: z.string().trim().min(1).max(200),
    texto: z.string().trim().min(1).max(2000),
    fecha_texto: lit,
  }),
  HORAS: z.object({
    accion: z.literal('HORAS'),
    operario_texto: z.string().trim().min(1).max(200),
    horas_texto: z.string().trim().min(1).max(40),
    obra_texto: z.string().trim().min(1).max(200),
    fecha_texto: lit,
    notas_texto: lit,
  }),
  GASTO: z.object({
    accion: z.literal('GASTO'),
    proveedor_texto: z.string().trim().min(1).max(200),
    importe_texto: z.string().trim().min(1).max(40),
    iva_modo: iva,
    obra_texto: lit,
    cliente_texto: lit,
    descripcion_texto: lit,
    fecha_texto: lit,
    categoria: z.enum(['material', 'herramienta', 'vertido', 'subcontrata', 'transporte', 'otros']).nullish(),
  }),
  PROVEEDOR_CREAR: z.object({
    accion: z.literal('PROVEEDOR_CREAR'),
    nombre_texto: z.string().trim().min(1).max(200),
    nif_texto: lit,
    telefono_texto: lit,
    email_texto: lit,
    notas_texto: lit,
  }),

  CITA_CREAR: z.object({
    accion: z.literal('CITA_CREAR'),
    cliente_texto: lit,
    obra_texto: lit,
    titulo_texto: lit,
    fecha_texto: z.string().trim().min(1).max(80),
    hora_texto: lit,
    hora_fin_texto: lit,
    lugar_texto: lit,
    notas_texto: lit,
  }),
  CITA_MOVER: z.object({
    accion: z.literal('CITA_MOVER'),
    evento_texto: z.string().trim().min(1).max(200),
    fecha_texto: lit,
    hora_texto: lit,
  }),
  CITA_BORRAR: z.object({
    accion: z.literal('CITA_BORRAR'),
    evento_texto: z.string().trim().min(1).max(200),
    fecha_texto: lit,
  }),

  CONSULTA_AGENDA: z.object({ accion: z.literal('CONSULTA_AGENDA'), rango_texto: lit }),
  CONSULTA_GASTOS: z.object({
    accion: z.literal('CONSULTA_GASTOS'),
    proveedor_texto: lit,
    obra_texto: lit,
    cliente_texto: lit,
    periodo_texto: lit,
  }),
  CONSULTA_OBRA: z.object({ accion: z.literal('CONSULTA_OBRA'), obra_texto: z.string().trim().min(1).max(200) }),
  CREAR_FACTURA: z.object({
    accion: z.literal('CREAR_FACTURA'),
    cliente_texto: z.string().trim().min(1).max(200),
    descripcion_texto: z.string().trim().min(1).max(500),
    importe_texto: z.string().trim().min(1).max(40),
    iva_modo: iva,
    obra_texto: lit,
  }),
  CONSULTA_DIA: z.object({ accion: z.literal('CONSULTA_DIA') }),
  CONSULTA_OBRAS: z.object({ accion: z.literal('CONSULTA_OBRAS'), estado: z.enum(['abiertas', 'cerradas', 'todas']).nullish() }),
  CONSULTA_PRESUPUESTOS: z.object({ accion: z.literal('CONSULTA_PRESUPUESTOS'), estado: z.enum(['pendientes', 'aceptados', 'todos']).nullish() }),
  CONSULTA_FACTURAS: z.object({ accion: z.literal('CONSULTA_FACTURAS'), estado: z.enum(['pendiente', 'pagada', 'vencida']).nullish() }),
} as const;

export type NombreAccion = keyof typeof ORDENES;
export const NOMBRES_ACCION = Object.keys(ORDENES) as NombreAccion[];

export const OrdenSchema = z.discriminatedUnion('accion', Object.values(ORDENES) as [typeof ORDENES.ACLARAR, ...Array<(typeof ORDENES)[NombreAccion]>]);
export type OrdenJev = z.infer<typeof OrdenSchema>;
export type OrdenDe<A extends NombreAccion> = z.infer<(typeof ORDENES)[A]>;

/** Acciones que escriben (necesitan «Sí, hazlo»). El resto solo lee o conversa. */
export const ACCIONES_ESCRITURA: ReadonlySet<NombreAccion> = new Set<NombreAccion>([
  'CREAR_CLIENTE', 'ACTUALIZAR_CLIENTE', 'CREAR_OBRA', 'CERRAR_OBRA', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS',
  'CAMBIAR_ESTADO_PRESUPUESTO', 'FACTURAR', 'MARCAR_PAGADA', 'CREAR_FACTURA', 'DIARIO', 'HORAS', 'GASTO', 'PROVEEDOR_CREAR',
  'CITA_CREAR', 'CITA_MOVER', 'CITA_BORRAR',
]);

/** Qué acciones ve el traductor según la categoría que ya dio el router .jev de intención (categorías internas del agente). */
const DOCS: NombreAccion[] = ['CREAR_FACTURA', 'CONSULTA_OBRAS', 'CONSULTA_PRESUPUESTOS', 'FACTURAR', 'MARCAR_PAGADA', 'PDF_ENLACE', 'CONSULTA_FACTURAS', 'CAMBIAR_ESTADO_PRESUPUESTO', 'ACTUALIZAR_CLIENTE', 'CREAR_OBRA', 'CERRAR_OBRA', 'CONSULTA_OBRA', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS'];
export const ACCIONES_POR_CATEGORIA: Record<string, NombreAccion[]> = {
  presupuesto: ['CONSULTA_PRESUPUESTOS', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS', 'CAMBIAR_ESTADO_PRESUPUESTO', 'FACTURAR', 'PDF_ENLACE', 'ACTUALIZAR_CLIENTE', 'CREAR_CLIENTE'],
  documentos: [...DOCS, 'CREAR_CLIENTE'],
  diario: ['DIARIO'],
  operarios: ['HORAS'],
  gastos: ['GASTO', 'PROVEEDOR_CREAR', 'CONSULTA_GASTOS'],
  clientes: ['CREAR_CLIENTE', 'ACTUALIZAR_CLIENTE', 'CREAR_OBRA'],
  agenda: ['CITA_CREAR', 'CITA_MOVER', 'CITA_BORRAR', 'CONSULTA_AGENDA', 'CONSULTA_DIA'],
  general: NOMBRES_ACCION.filter((a) => a !== 'ACLARAR' && a !== 'CHARLA'),
  emails: [],
  calculo: [],
};

/** Esquema JSON de la función `orden_jev` para una lista de acciones. */
export function jsonSchemaOrden(acciones: NombreAccion[]): Record<string, unknown> {
  const lista = [...new Set<NombreAccion>([...acciones, 'ACLARAR', 'CHARLA'])];
  const variantes = lista.map((a) => {
    const js = z.toJSONSchema(ORDENES[a], { io: 'input' }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  });
  return { anyOf: variantes };
}

export function validarOrden(raw: unknown): { ok: true; orden: OrdenJev } | { ok: false; error: string } {
  const r = OrdenSchema.safeParse(raw);
  if (r.success) return { ok: true, orden: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 300) };
}
