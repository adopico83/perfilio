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
import { normalizarConAvisos, normalizarCrudo } from '@/lib/jev/normalizar';

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
  /** Sin partida («ponle 500») el ejecutor pregunta a cuál: nunca elige una por su cuenta. */
  partida_texto: lit,
  cantidad_texto: lit,
  sumar_cantidad_texto: lit,
  /** Lo que dijo que había antes («pon 14 en vez de 12» → «12»): solo informativo, nunca se usa como valor nuevo. */
  cantidad_anterior_texto: lit,
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
  /** Trabajo nuevo sobre un presupuesto ya aceptado o facturado: un presupuesto «hijo» (extra) vinculado, sin tocar el original. */
  EXTRA_PRESUPUESTO: z.object({
    accion: z.literal('EXTRA_PRESUPUESTO'),
    presupuesto_texto: z.string().trim().min(1).max(200),
    descripcion_texto: z.string().trim().min(1).max(500),
    importe_texto: z.string().trim().min(1).max(40),
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
    /** Más personas en la misma frase («Aitor 7 y media y Jon 6»): el motor las prepara una a una, ninguna se pierde. */
    mas_operarios: z.array(z.object({ operario_texto: z.string().trim().min(1).max(200), horas_texto: z.string().trim().min(1).max(40) })).max(10).nullish(),
  }),
  GASTO: z.object({
    accion: z.literal('GASTO'),
    /** Sin proveedor («85 de material para lo de Mikel»): se guarda como «Material» (o la categoría). */
    proveedor_texto: lit,
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
    /** Si no dice el concepto, la factura va como «Trabajos realizados». */
    descripcion_texto: lit,
    importe_texto: z.string().trim().min(1).max(40),
    iva_modo: iva,
    obra_texto: lit,
    /** «sin obra»: la factura no va ligada a ninguna obra (no se pregunta cuál). */
    sin_obra: z.enum(['si']).nullish(),
  }),
  CONSULTA_DIA: z.object({ accion: z.literal('CONSULTA_DIA') }),
  CONSULTA_OBRAS: z.object({ accion: z.literal('CONSULTA_OBRAS'), obra_texto: lit, estado: z.enum(['abiertas', 'cerradas', 'todas']).nullish() }),
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
  'CAMBIAR_ESTADO_PRESUPUESTO', 'EXTRA_PRESUPUESTO', 'FACTURAR', 'MARCAR_PAGADA', 'CREAR_FACTURA', 'DIARIO', 'HORAS', 'GASTO', 'PROVEEDOR_CREAR',
  'CITA_CREAR', 'CITA_MOVER', 'CITA_BORRAR',
]);

/** Qué acciones ve el traductor según la categoría que ya dio el router .jev de intención (categorías internas del agente). */
const DOCS: NombreAccion[] = ['EXTRA_PRESUPUESTO', 'CREAR_FACTURA', 'CONSULTA_OBRAS', 'CONSULTA_PRESUPUESTOS', 'FACTURAR', 'MARCAR_PAGADA', 'PDF_ENLACE', 'CONSULTA_FACTURAS', 'CAMBIAR_ESTADO_PRESUPUESTO', 'ACTUALIZAR_CLIENTE', 'CREAR_OBRA', 'CERRAR_OBRA', 'CONSULTA_OBRA', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS'];
export const ACCIONES_POR_CATEGORIA: Record<string, NombreAccion[]> = {
  presupuesto: ['CONSULTA_PRESUPUESTOS', 'PRESUPUESTO_DICTADO', 'PRESUPUESTO_PARTIDAS', 'EXTRA_PRESUPUESTO', 'CAMBIAR_ESTADO_PRESUPUESTO', 'FACTURAR', 'PDF_ENLACE', 'ACTUALIZAR_CLIENTE', 'CREAR_CLIENTE'],
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
  // y «cómo va la obra de Amaia» (lista de obras con una obra concreta) → la ficha de esa obra.
  const nombre: NombreAccion =
    accion === 'CONSULTA_OBRA' && n.obra_texto === undefined ? 'CONSULTA_OBRAS' : accion === 'CONSULTA_OBRAS' && n.obra_texto !== undefined ? 'CONSULTA_OBRA' : accion;

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
  if (nombre === 'MARCAR_PAGADA' && ok.estado === undefined) ok.estado = 'pagada'; // «márcala pagada» ya dice el estado
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

// ───────────────────────── Esquemas ESTRICTOS para OpenAI (Structured Outputs) en DOS pasos ─────────────────────────
//
// Paso 1 (`elegir_accion`): enum cerrado con el tipo de orden (un esquema diminuto: no hay campos que dejar a null).
// Paso 2 (`orden_jev`): esquema estricto SOLO de esa acción, con sus pocos campos. Los obligatorios NO admiten
// null (el modelo tiene que copiarlos del mensaje; si de verdad no los dijo, ""), los opcionales sí.

type JS = Record<string, unknown>;

/** Qué hace cada acción, para que el modelo no las confunda (una línea + un ejemplo). */
export const AYUDA_ACCION: Record<NombreAccion, { que: string; ejemplo: string }> = {
  ACLARAR: { que: 'No se entiende qué quiere, o pide algo que el asistente no puede hacer (p. ej. cambiar el estado de un albarán). Lleva una pregunta corta.', ejemplo: '«Anota esto» → ¿En qué obra lo anoto y qué quieres apuntar?' },
  CHARLA: { que: 'SOLO saludos, gracias o charla sin ninguna petición.', ejemplo: '«Hola, buenas»' },
  CREAR_CLIENTE: { que: 'Dar de alta un cliente nuevo.', ejemplo: '«crea el cliente Jon Arrieta, teléfono 600123123, de Irún» → nombre_texto «Jon Arrieta», telefono_texto «600123123», direccion_texto «Irún»' },
  ACTUALIZAR_CLIENTE: { que: 'Cambiar datos de un cliente que ya existe (NIF, dirección, teléfono, email).', ejemplo: '«el NIF de Ainhoa es 44444444B» → cliente_texto «Ainhoa», nif_texto «44444444B»' },
  CREAR_OBRA: { que: 'Abrir/crear una obra nueva.', ejemplo: '«crea la obra Reforma baño Ane para Mikel Etxeberria» → nombre_texto «Reforma baño Ane», cliente_texto «Mikel Etxeberria»' },
  CERRAR_OBRA: { que: 'Cerrar, pausar o reabrir una obra.', ejemplo: '«cierra la obra de Paqui» → obra_texto «Paqui», estado «cerrada»' },
  PRESUPUESTO_DICTADO: { que: 'Crear un presupuesto NUEVO para un cliente a partir de los trabajos que dicta.', ejemplo: '«presupuesto para Paqui: alicatar el baño, 12 metros a 40 euros» → cliente_texto «Paqui», partidas [{concepto_texto «alicatar el baño», cantidad_texto «12», unidad_texto «metros», precio_texto «40»}]' },
  PRESUPUESTO_PARTIDAS: { que: 'Quitar, cambiar o añadir partidas de un presupuesto que YA existe (borrador).', ejemplo: '«pon 14 en vez de 12 metros de alicatado en el 11» → presupuesto_texto «11», cambiar [{partida_texto «alicatado», cantidad_texto «14», cantidad_anterior_texto «12»}]; «quítale la mampara al 11 y pon 2 metros más de alicatado» → presupuesto_texto «11», quitar_texto [«mampara»], cambiar [{partida_texto «alicatado», sumar_cantidad_texto «2»}]; «pon una partida de pintura de 30 metros a 8 euros en el presupuesto de Paqui» → presupuesto_texto «Paqui», anadir [{concepto_texto «pintura», cantidad_texto «30», unidad_texto «metros», precio_texto «8»}]; «pon 2 metros más de alicatado en el 11» → presupuesto_texto «11», cambiar [{partida_texto «alicatado», sumar_cantidad_texto «2»}] (SIEMPRE rellena cambiar con la partida existente y lo que cambia); «quítale la mampara» (sin decir cuál) → presupuesto_texto «ese»; «añádele dos enchufes a 35» → presupuesto_texto «ese», anadir [{concepto_texto «enchufes», cantidad_texto «dos», precio_texto «35»}]; «añádele colocar campana extractora 120 y quítale la fontanería» → anadir [{concepto_texto «colocar campana extractora», cantidad_texto «1», precio_texto «120»}], quitar_texto [«fontanería»]; «ponle 500» (sin decir a qué partida) → cambiar [{partida_texto null, precio_texto «500»}]' },
  EXTRA_PRESUPUESTO: { que: 'Apuntar un trabajo EXTRA (nuevo) sobre un presupuesto ya aceptado o facturado, sin cambiar el original. Importe sin IVA.', ejemplo: '«extra en el 11: campana extractora, 120» → presupuesto_texto «11», descripcion_texto «campana extractora», importe_texto «120»' },
  CAMBIAR_ESTADO_PRESUPUESTO: { que: 'Pasar un presupuesto a aceptado, rechazado, enviado…', ejemplo: '«pasa el presupuesto 7 a rechazado» → presupuesto_texto «7», estado «rechazado»' },
  FACTURAR: { que: 'Convertir en factura un presupuesto o un albarán QUE YA EXISTE (se identifica por número o cliente).', ejemplo: '«hazme la factura del presupuesto de García» → presupuesto_texto «García»; «factura el 11» → presupuesto_texto «11»; «factúrame ese presu» → presupuesto_texto «ese»; «factúrame el albarán 12» → albaran_texto «12»' },
  MARCAR_PAGADA: { que: 'Marcar una factura como pagada/cobrada.', ejemplo: '«marca la factura 3 como pagada» → factura_texto «3», estado «pagada»' },
  PDF_ENLACE: { que: 'Dar el PDF de un presupuesto o de una factura.', ejemplo: '«mándame el PDF de la factura 3» → documento «factura», ref_texto «3»' },
  DIARIO: { que: 'Anotar algo en el diario de una obra.', ejemplo: '«en el diario de Paqui: hoy se ha picado el baño» → obra_texto «Paqui», texto «hoy se ha picado el baño»' },
  HORAS: { que: 'Apuntar horas trabajadas por uno o varios operarios en una obra.', ejemplo: '«ponle 8 horas a Iker en lo de Paqui» → operario_texto «Iker», horas_texto «8», obra_texto «Paqui»; «Aitor el pintor 7 y media y Jon el carpintero 6 en lo de Paqui» → operario_texto «Aitor el pintor», horas_texto «7 y media», mas_operarios [{operario_texto «Jon el carpintero», horas_texto «6»}], obra_texto «Paqui»' },
  GASTO: { que: 'Registrar un gasto/ticket de compra.', ejemplo: '«180 más IVA en Saltoki para lo de Leire» → importe_texto «180», iva_modo «mas», proveedor_texto «Saltoki», obra_texto «Leire»' },
  PROVEEDOR_CREAR: { que: 'Dar de alta un proveedor.', ejemplo: '«da de alta a Bricomart de Irún como proveedor» → nombre_texto «Bricomart», notas_texto «de Irún»' },
  CITA_CREAR: { que: 'Crear una cita o recordatorio en la agenda.', ejemplo: '«visita mañana a las 10 con Ane» → titulo_texto «Visita con Ane», cliente_texto «Ane», fecha_texto «mañana», hora_texto «a las 10». La persona con quien es la cita va SIEMPRE en cliente_texto (aunque salga en el título); «visita con el de Maderas Oria» → cliente_texto «el de Maderas Oria»' },
  CITA_MOVER: { que: 'Mover una cita que ya existe a otro día u hora.', ejemplo: '«pasa lo de Mikel al viernes a la misma hora» → evento_texto «Mikel», fecha_texto «el viernes»' },
  CITA_BORRAR: { que: 'Borrar una cita (solo si lo pide claramente).', ejemplo: '«borra la cita de Mikel» → evento_texto «Mikel»' },
  CONSULTA_AGENDA: { que: 'Preguntar qué hay en la agenda en un rango de días.', ejemplo: '«¿qué tengo esta semana?» → rango_texto «esta semana»' },
  CONSULTA_GASTOS: { que: 'Preguntar cuánto se ha gastado / listar gastos.', ejemplo: '«¿cuánto me he gastado en Saltoki?» → proveedor_texto «Saltoki»' },
  CONSULTA_OBRA: { que: 'Ficha de una obra concreta.', ejemplo: '«¿cómo va la obra de Amaia?» → obra_texto «Amaia»' },
  CREAR_FACTURA: { que: 'Crear una factura LIBRE para un cliente con un importe (sin partir de un presupuesto).', ejemplo: '«hazle una factura de 500 más IVA a Paqui por la reforma» → cliente_texto «Paqui», importe_texto «500», iva_modo «mas», descripcion_texto «la reforma»; «factura a Ane por 200» → iva_modo null (el sistema preguntará); «factura a Paqui por 85 sin obra» → sin_obra «si»' },
  CONSULTA_DIA: { que: 'Preguntar qué hay hoy (agenda, obras…).', ejemplo: '«¿qué tengo hoy?»' },
  CONSULTA_OBRAS: { que: 'Listar obras (abiertas/cerradas) o preguntar por una obra concreta con obra_texto.', ejemplo: '«¿qué obras tengo activas?» → estado «abiertas»; «¿cómo va la obra de Amaia?» → obra_texto «Amaia»' },
  CONSULTA_PRESUPUESTOS: { que: 'Listar presupuestos (pendientes, aceptados, todos).', ejemplo: '«¿qué presupuestos tengo pendientes?» → estado «pendientes»' },
  CONSULTA_FACTURAS: { que: 'Listar facturas (pendientes de cobro, pagadas, vencidas).', ejemplo: '«¿qué facturas tengo pendientes de cobro?» → estado «pendiente»' },
};

/** Cómo rellenar cada campo (se manda en la `description` del esquema). Lo que no dijo: null (opcional) o "" (obligatorio). */
const DESCRIPCION_CAMPO: Record<string, string> = {
  pregunta: 'La pregunta corta al usuario.',
  nombre_texto: 'El nombre tal como lo dijo («Jon PRUEBA Arrieta», «Reforma baño Ane»).',
  cliente_texto: 'El cliente tal como lo dijo («Paqui», «Mikel Etxeberria»).',
  obra_texto: 'La obra tal como la nombró, completa («Paqui», «lo de Leire», «Olabide 9», «el baño de Unai»).',
  proveedor_texto: 'El proveedor o tienda tal como lo dijo («Saltoki»). Si no nombra tienda pero dice qué compró («85 de material»), pon esa palabra («Material»).',
  operario_texto: 'La persona tal como la dijo, con su oficio si lo dijo («Iker», «Aitor el pintor»). No quites el oficio.',
  presupuesto_texto:
    'RELLÉNALO SIEMPRE que el usuario hable de un presupuesto, copiando la referencia tal cual: «el 11» → «11»; «el presupuesto de Paqui» / «en el de Paqui» → «Paqui»; «ese», «ese presu», «el último» → «ese». Si el mensaje no dice cuál, pon «ese» (nunca un número que no esté en el mensaje).',
  factura_texto: 'Qué factura: su número («3»), el cliente o «esa» si dice «esa factura / la última».',
  albaran_texto: 'Número o cliente del albarán («12»).',
  evento_texto: 'La cita que mueve o borra, por la persona o el título («Mikel»).',
  ref_texto: 'Número («3») o «ese»/«esa» si dice «ese presu / esa factura».',
  importe_texto: 'La cifra tal como la dijo, sin símbolo («180», «1.500»).',
  horas_texto: 'Las horas TAL COMO las dijo, con letras o cifras («8», «7 y media», «7 y cuarto», «8 menos cuarto», «7:30», «media hora», «siete y media»). No las conviertas.',
  cantidad_texto: 'Cantidad dicha («12», «dos»); si el usuario da SOLO un número tras el concepto, sin unidad ni «x» («colocar campana extractora 120»), es el PRECIO: cantidad_texto «1» y precio_texto «120». La cantidad FINAL que dijo («14» en «pon 14 en vez de 12»); si es un trabajo a precio cerrado, «1». En «N más» va a null (usa sumar_cantidad_texto). Nunca la calcules tú.',
  sumar_cantidad_texto: 'SOLO si dice «N más» / «N menos» / «quítale N»: el delta tal como lo dijo («2»; para restar, «-2»). NO calcules el total: el servidor suma. Si dice «pon 14» (valor final), esto va a null.',
  cantidad_anterior_texto: 'Solo si dice lo que había antes («pon 14 en vez de 12» → «12»).',
  precio_texto: 'El precio unitario dicho («40»); si es un precio cerrado del trabajo, ese importe.',
  unidad_texto: 'La unidad dicha («metros», «m2», «unidades»).',
  concepto_texto: 'El trabajo o material dictado («alicatar el baño»).',
  partida_texto: 'La partida existente a la que se refiere («alicatado»). Si el usuario NO dice a cuál («ponle 500»), null: nunca elijas una.',
  mas_operarios: 'Las demás personas de la misma frase, cada una con sus horas («Aitor 7 y media y Jon 6» → operario_texto «Aitor», horas_texto «7 y media», mas_operarios [{operario_texto «Jon», horas_texto «6»}]).',
  nuevo_nombre_texto: 'Nuevo nombre de la partida, solo si lo cambia.',
  quitar_texto: 'Partidas que hay que quitar («mampara»).',
  cambiar: 'Partidas EXISTENTES que cambian: una por cada «pon N más de X», «cámbiale el precio a X», «ponle otro nombre». partida_texto = la partida («alicatado»); «N más» va en sumar_cantidad_texto.',
  anadir: 'Partidas nuevas que se añaden.',
  partidas: 'Una por cada trabajo dictado, con cantidad y precio solo si los dijo.',
  fecha_texto: 'COPIA las palabras del usuario («hoy», «ayer», «el jueves», «el lunes que viene», «12 de octubre»). NUNCA una fecha en formato 2026-10-05 ni calculada.',
  hora_texto: 'La hora tal como la dijo («a las 10», «10 y media», «a las 5»).',
  hora_fin_texto: 'Hora de fin, solo si la dijo.',
  rango_texto: 'El rango dicho («esta semana», «mañana», «el jueves»).',
  periodo_texto: 'El periodo dicho («este mes»).',
  titulo_texto: 'Título corto de la cita, solo si se puede deducir («Visita con Ane»).',
  lugar_texto: 'Lugar, solo si lo dijo.',
  notas_texto: 'Notas extra, solo si las dijo.',
  descripcion_texto: 'El concepto o descripción, solo si lo dijo («la reforma», «cable y mecanismos»).',
  texto: 'Lo que hay que anotar, tal como lo dijo.',
  direccion_texto: 'Dirección o población, tal como la dijo.',
  telefono_texto: 'Teléfono tal como lo dijo.',
  email_texto: 'Email tal como lo dijo.',
  nif_texto: 'NIF/CIF tal como lo dijo.',
  nombre_nuevo_texto: 'Nuevo nombre del cliente, solo si lo cambia.',
  iva_modo: '"mas" si dijo «más IVA» o «+ IVA»; "incluido" si dijo «con IVA / IVA incluido»; null si no lo dijo (también con «sin IVA»: el sistema preguntará).',
  categoria: 'Categoría del gasto, solo si se deduce («material», «herramienta»…).',
  estado: 'El estado pedido, tal como lo dijo («pagada», «rechazado», «pendientes», «cerrada»).',
  documento: '«presupuesto» o «factura».',
  sin_obra: '"si" solo si dice que la factura NO es de ninguna obra («sin obra», «suelta»); si no, null.',
};

/** Una propiedad de zod→JSON Schema → su versión estricta. `obligatoria`: sin null (hay que rellenarla). */
function propEstricta(js: JS, obligatoria: boolean): JS {
  const variantes = (js.anyOf as JS[] | undefined) ?? [js];
  const base: JS = variantes.find((x) => x.type !== 'null') ?? {};
  const tipo = (t: string) => (obligatoria ? t : [t, 'null']);
  if (base.type === 'array') return { type: tipo('array'), items: objetoEstricto(base.items as JS) };
  if (base.enum) return { type: tipo('string'), enum: obligatoria ? [...(base.enum as string[])] : [...(base.enum as string[]), null] };
  return { type: tipo('string') };
}

/** Objeto estricto: TODAS las propiedades obligatorias en el esquema (los opcionales pueden valer null), sin extras. */
function objetoEstricto(js: JS): JS {
  if (js.type !== 'object') return { type: 'string' };
  const props = (js.properties ?? {}) as Record<string, JS>;
  const oblig = new Set((js.required ?? []) as string[]);
  const out: Record<string, JS> = {};
  for (const [k, p] of Object.entries(props)) {
    // Dentro de una lista, el campo clave no admite null; el resto sí.
    out[k] = { ...propEstricta(p, oblig.has(k)), ...(DESCRIPCION_CAMPO[k] ? { description: DESCRIPCION_CAMPO[k] } : {}) };
  }
  return { type: 'object', properties: out, required: Object.keys(out), additionalProperties: false };
}

/** Acciones que ve el modelo: `CONSULTA_OBRA` no está (es CONSULTA_OBRAS con `obra_texto`). */
export function accionesDelModelo(acciones: NombreAccion[]): NombreAccion[] {
  const l = new Set<NombreAccion>([...acciones, 'ACLARAR', 'CHARLA']);
  if (l.delete('CONSULTA_OBRA')) l.add('CONSULTA_OBRAS');
  return [...l];
}

/** Paso 1: solo el tipo de orden (enum cerrado) y si continúa la tarea en curso. */
export function jsonSchemaAccion(acciones: NombreAccion[]): JS {
  return {
    type: 'object',
    properties: {
      accion: { type: 'string', enum: accionesDelModelo(acciones), description: 'El tipo de orden que pide el usuario.' },
      continua_tarea: { type: ['boolean', 'null'], description: 'true solo si corrige o completa la TAREA EN CURSO o la orden PENDIENTE; si no, null.' },
      otras_acciones: {
        type: ['array', 'null'],
        items: { type: 'string', enum: accionesDelModelo(acciones).filter((a) => a !== 'ACLARAR' && a !== 'CHARLA') },
        description: 'Solo si el mensaje pide VARIAS cosas de tipos DISTINTOS: los tipos de las demás, en orden. Varias personas en horas = una sola HORAS. Si no, null.',
      },
    },
    required: ['accion', 'continua_tarea', 'otras_acciones'],
    additionalProperties: false,
  };
}

/** Paso 2: esquema estricto de UNA acción (sin el campo `accion`, que ya se sabe). `null` si no tiene campos. */
export function jsonSchemaCampos(accion: NombreAccion): JS | null {
  if (accion === 'CHARLA') return null;
  const js = z.toJSONSchema(ORDENES[accion], { io: 'input' }) as JS;
  const props = { ...((js.properties ?? {}) as Record<string, JS>) };
  delete props.accion;
  if (!Object.keys(props).length) return null;
  const obj = objetoEstricto({ type: 'object', properties: props, required: ((js.required ?? []) as string[]).filter((k) => k !== 'accion') });
  return obj;
}

/** Nombre de acción que viene del modelo → un `NombreAccion` válido (o null). */
export function normalizarAccionPublica(v: unknown): NombreAccion | null {
  const a = normalizarCrudo({ accion: v }).accion;
  return esAccion(a) ? a : null;
}

/** Lo que se va a hacer, en pocas palabras (para «después te pregunto por…»). */
export function etiquetaOrden(o: Record<string, unknown>): string {
  const a = String(o.accion ?? '') as NombreAccion;
  const t = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  if (a === 'HORAS') return `las horas de ${t('operario_texto') || 'otra persona'}${t('horas_texto') ? ` (${t('horas_texto')})` : ''}`;
  if (a === 'CREAR_CLIENTE') return `dar de alta a ${t('nombre_texto')}`;
  if (a === 'ACTUALIZAR_CLIENTE') return `guardar datos de ${t('cliente_texto') || 'un cliente'}`;
  const que = (AYUDA_ACCION[a]?.que ?? a).split(/[.(]/)[0]!.trim();
  return que.charAt(0).toLowerCase() + que.slice(1);
}

/** Una frase con varias órdenes iguales (varias personas en horas) → una orden por persona. Nada se pierde. */
export function expandirOrden(o: OrdenCruda): OrdenCruda[] {
  if (o.accion === 'HORAS' && Array.isArray(o.mas_operarios) && o.mas_operarios.length) {
    const { mas_operarios, ...primera } = o as unknown as Record<string, unknown> & { mas_operarios: Array<Record<string, unknown>> };
    const comunes = Object.fromEntries(['obra_texto', 'fecha_texto', 'notas_texto'].filter((k) => primera[k] !== undefined).map((k) => [k, primera[k]]));
    return [primera as OrdenCruda, ...mas_operarios.map((m) => ({ accion: 'HORAS', ...comunes, ...m }) as OrdenCruda)];
  }
  return [o];
}
