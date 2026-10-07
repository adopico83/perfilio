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
import { logJev } from '@/lib/jev/log';
import { normalizarConAvisos } from '@/lib/jev/normalizar';

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

/** Orden tal y como sale del modelo tras limpiarla: puede estar a medias. */
export type OrdenCruda = { accion: string } & Record<string, unknown>;

/** Qué se pregunta cuando falta un dato imprescindible (por campo; algunas acciones lo dicen distinto). */
const PREGUNTA_CAMPO: Record<string, string> = {
  cliente_texto: '¿Para qué cliente es?',
  obra_texto: '¿En qué obra?',
  nombre_texto: '¿Cómo se llama?',
  proveedor_texto: '¿A qué proveedor?',
  importe_texto: '¿De cuánto es el importe?',
  descripcion_texto: '¿Qué trabajos o concepto pongo?',
  horas_texto: '¿Cuántas horas?',
  operario_texto: '¿Qué operario?',
  fecha_texto: '¿Para qué día?',
  evento_texto: '¿Qué cita?',
  presupuesto_texto: '¿De qué presupuesto hablas?',
  factura_texto: '¿De qué factura hablas?',
  estado: '¿A qué estado lo paso?',
  documento: '¿Quieres el PDF de un presupuesto o de una factura?',
  partidas: '¿Qué trabajos incluye el presupuesto y a cuánto?',
  texto: '¿Qué quieres que anote?',
};
const PREGUNTA_ACCION_CAMPO: Record<string, string> = {
  'CREAR_CLIENTE.nombre_texto': '¿Cómo se llama el cliente?',
  'CREAR_OBRA.nombre_texto': '¿Cómo se llama la obra?',
  'PROVEEDOR_CREAR.nombre_texto': '¿Cómo se llama el proveedor?',
  'PRESUPUESTO_DICTADO.cliente_texto': '¿Para qué cliente es el presupuesto?',
  'CREAR_FACTURA.cliente_texto': '¿Para qué cliente es la factura?',
  'ACTUALIZAR_CLIENTE.cliente_texto': '¿Qué cliente quieres actualizar?',
  'CREAR_FACTURA.importe_texto': '¿Cuánto es la factura?',
  'GASTO.importe_texto': '¿Cuánto ha sido el gasto?',
  'HORAS.obra_texto': '¿En qué obra ha trabajado?',
  'DIARIO.obra_texto': '¿En qué obra lo anoto?',
  'CERRAR_OBRA.obra_texto': '¿Qué obra?',
  'CITA_CREAR.fecha_texto': '¿Para qué día es la cita?',
  'CITA_MOVER.evento_texto': '¿Qué cita quieres mover?',
  'CITA_BORRAR.evento_texto': '¿Qué cita quieres borrar?',
  'GASTO.proveedor_texto': '¿A qué proveedor es el gasto?',
  'CAMBIAR_ESTADO_PRESUPUESTO.estado': '¿A qué estado paso el presupuesto (aceptado, rechazado, enviado…)?',
};
export const preguntaDeCampo = (accion: string, campo: string) =>
  PREGUNTA_ACCION_CAMPO[`${accion}.${campo}`] ?? PREGUNTA_CAMPO[campo] ?? `Me falta un dato (${campo}).`;

export const PREGUNTA_NO_ENTENDIDO = 'No te he entendido bien. ¿Me lo dices de otra forma?';

export type ResultadoCompletar =
  | { estado: 'completa'; orden: OrdenJev }
  /** Hay intención y parte de los datos: se conserva lo bueno y se pregunta SOLO lo que falta. */
  | { estado: 'faltan'; cruda: OrdenCruda; faltantes: string[]; pregunta: string }
  /** No hay ninguna intención reconocible (o el modelo mismo pidió aclarar). */
  | { estado: 'aclarar'; pregunta: string; motivo: string };

const campos = (a: NombreAccion) => (ORDENES[a] as unknown as { shape: Record<string, z.ZodType> }).shape;
const esAccion = (a: unknown): a is NombreAccion => typeof a === 'string' && Object.prototype.hasOwnProperty.call(ORDENES, a);

/**
 * Orden cruda del modelo → resultado. Es la ÚNICA puerta: normaliza (lib/jev/normalizar.ts), valida campo a campo
 * y decide. Un campo opcional mal puesto se descarta; uno obligatorio que falta o viene mal se PREGUNTA; la orden
 * no se tira entera. Las consultas (solo lectura) salen siempre: todos sus campos son opcionales.
 */
export function completarOrden(raw: unknown): ResultadoCompletar {
  const { orden: n, descartados: sucios } = normalizarConAvisos(raw);
  const accion = n.accion;
  if (!esAccion(accion)) {
    logJev('accion_desconocida', { accion: (raw as { accion?: unknown } | null)?.accion ?? null, orden: raw });
    return { estado: 'aclarar', pregunta: PREGUNTA_NO_ENTENDIDO, motivo: 'accion_desconocida' };
  }
  if (accion === 'CHARLA') return { estado: 'completa', orden: { accion: 'CHARLA' } };
  if (accion === 'ACLARAR') {
    const pregunta = typeof n.pregunta === 'string' ? n.pregunta.slice(0, 400) : PREGUNTA_NO_ENTENDIDO;
    logJev('aclarar', { motivo: 'el modelo pide aclarar', pregunta, orden: raw });
    return { estado: 'aclarar', pregunta, motivo: 'modelo' };
  }
  // «Qué hay en la obra X» sin obra → lista de obras (solo lectura).
  const nombre: NombreAccion = accion === 'CONSULTA_OBRA' && n.obra_texto === undefined ? 'CONSULTA_OBRAS' : accion;

  const ok: Record<string, unknown> = { accion: nombre };
  const faltantes: string[] = [];
  const descartados: Array<{ campo: string; motivo: string }> = sucios.filter((d) => d.campo in campos(nombre));
  for (const [k, schema] of Object.entries(campos(nombre))) {
    if (k === 'accion') continue;
    const valor = n[k];
    const obligatorio = !schema.safeParse(undefined).success;
    if (valor === undefined) {
      if (obligatorio) faltantes.push(k);
      continue;
    }
    const r = schema.safeParse(valor);
    if (r.success) {
      if (r.data !== undefined && r.data !== null) ok[k] = r.data;
      continue;
    }
    if (obligatorio) faltantes.push(k);
    descartados.push({ campo: k, motivo: r.error.issues[0]?.message ?? 'inválido' });
  }
  if (descartados.length) logJev('campo_descartado', { accion: nombre, descartados, orden: raw });
  if (faltantes.length) {
    logJev('orden_incompleta', { accion: nombre, faltantes, orden: raw });
    return { estado: 'faltan', cruda: ok as OrdenCruda, faltantes, pregunta: faltantes.map((f) => preguntaDeCampo(nombre, f)).join(' ') };
  }
  const v = OrdenSchema.safeParse(ok);
  if (!v.success) {
    // No debería pasar (cada campo ya se validó); si pasa, se ve en los logs y se pregunta en vez de ejecutar.
    logJev('orden_incompleta', { accion: nombre, faltantes: [], orden: raw, error: v.error.issues[0]?.message });
    return { estado: 'aclarar', pregunta: PREGUNTA_NO_ENTENDIDO, motivo: 'esquema' };
  }
  return { estado: 'completa', orden: v.data };
}

/** Compatibilidad: ok solo si la orden está completa. */
export function validarOrden(raw: unknown): { ok: true; orden: OrdenJev } | { ok: false; error: string } {
  const r = completarOrden(raw);
  if (r.estado === 'completa') return { ok: true, orden: r.orden };
  return { ok: false, error: r.estado === 'faltan' ? `faltan: ${r.faltantes.join(', ')}` : r.motivo };
}

// ───────────────────────── Esquema ESTRICTO para OpenAI (Structured Outputs) ─────────────────────────

type JS = Record<string, unknown>;

/** Una propiedad del esquema de una acción → su versión estricta: tipo + "null", sin límites de longitud. */
function propEstricta(js: JS): JS {
  const variantes = (js.anyOf as JS[] | undefined) ?? [js];
  const base: JS = variantes.find((x) => x.type !== 'null') ?? {};
  if (base.type === 'array') return { type: ['array', 'null'], items: objetoEstricto(base.items as JS) };
  if (base.enum) return { type: ['string', 'null'], enum: [...(base.enum as string[]), null] };
  return { type: ['string', 'null'] };
}

/** Objeto estricto: TODAS las propiedades obligatorias (pueden valer null) y nada de propiedades de más. */
function objetoEstricto(js: JS): JS {
  if (js.type !== 'object') return { type: 'string' };
  const props = (js.properties ?? {}) as Record<string, JS>;
  const out: Record<string, JS> = {};
  for (const [k, p] of Object.entries(props)) out[k] = propEstricta(p);
  return { type: 'object', properties: out, required: Object.keys(out), additionalProperties: false };
}

const DESCRIPCION: Record<string, string> = {
  continua_tarea: 'true solo si corrige o completa la TAREA EN CURSO; si no, null',
  pregunta: 'Solo para ACLARAR: la pregunta corta al usuario',
  estado: 'Estado tal como lo dijo el usuario, si lo dijo',
  iva_modo: '"mas" si dijo «más IVA»; "incluido" si dijo «con IVA / IVA incluido»; si no lo dijo, null',
  partidas: 'Una por cada trabajo dictado',
  texto: 'Lo que hay que anotar en el diario, tal como lo dijo',
};

/**
 * Esquema de la función `orden_jev` para una lista de acciones, listo para `strict: true`.
 *
 * Es UN solo objeto plano: `accion` (enum cerrado) + la unión de los campos de todas las órdenes (~45). Todos
 * obligatorios pero con `null` permitido (así el modelo puede decir «esto no lo dijo» sin inventar un ""), y
 * `additionalProperties: false` en todos los niveles. `completarOrden` se queda después solo con los campos
 * que pertenecen a la acción elegida.
 */
export function jsonSchemaEstricto(acciones: NombreAccion[]): JS {
  const lista = [...new Set<NombreAccion>([...acciones, 'ACLARAR', 'CHARLA'])];
  const props: Record<string, JS> = { accion: { type: 'string', enum: lista } };
  const enums: Record<string, Set<string>> = {};
  for (const a of lista) {
    const js = z.toJSONSchema(ORDENES[a], { io: 'input' }) as JS;
    for (const [k, p] of Object.entries((js.properties ?? {}) as Record<string, JS>)) {
      if (k === 'accion') continue;
      const est = propEstricta(p);
      if (est.enum) {
        enums[k] ??= new Set();
        for (const e of est.enum as Array<string | null>) if (e !== null) enums[k]!.add(e);
      }
      if (!props[k]) props[k] = est;
    }
  }
  for (const [k, vals] of Object.entries(enums)) props[k] = { type: ['string', 'null'], enum: [...vals, null] };
  const todas: Record<string, JS> = { continua_tarea: { type: ['boolean', 'null'] }, ...props };
  for (const [k, d] of Object.entries(DESCRIPCION)) if (todas[k]) todas[k] = { ...todas[k]!, description: d };
  return { type: 'object', properties: todas, required: Object.keys(todas), additionalProperties: false };
}
