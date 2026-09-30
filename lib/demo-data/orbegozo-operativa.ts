/** Agenda, gastos, operarios/partes, diario de obra y mensajes del mock demo. */
import { DEMO_OBRAS_BASE } from './orbegozo-base';
import {
  DEMO_MIN_LABORABLES_MES,
  demoDiasLaborables,
  demoDiasLaborablesVentana,
  demoEsFinDeSemana,
  demoFecha,
  demoFechaLaborable,
  demoMesActual,
  demoSumarDias,
  demoTimestamp,
  demoTimestampReciente,
} from './fechas';
import type {
  AgendaEvento,
  DemoConversation,
  DemoDiarioEntrada,
  DemoGastoFila,
  DemoOperario,
  DemoRegistroJornada,
} from './types';
import { GASTO_CATEGORIAS } from '@/lib/gastos-categoria';

const obra = (id: string) => DEMO_OBRAS_BASE.find((o) => o.id === id)!;

/* ------------------------------ Agenda ------------------------------ */

const AGENDA_DEF: Array<{ id: string; titulo: string; offset: number; hora: string }> = [
  { id: 'demo-agenda-1', titulo: 'Revisión de certificación 1 · Algorta', offset: -2, hora: '12:00' },
  { id: 'demo-agenda-2', titulo: 'Comprobación de medidas de mampara · Deusto', offset: -1, hora: '17:30' },
  { id: 'demo-agenda-3', titulo: 'Visita de obra · Reforma integral piso Algorta', offset: 0, hora: '09:30' },
  { id: 'demo-agenda-4', titulo: 'Replanteo de cocina · Barakaldo', offset: 0, hora: '17:00' },
  { id: 'demo-agenda-5', titulo: 'Medición de local · Cafetería Durango', offset: 1, hora: '10:00' },
  { id: 'demo-agenda-6', titulo: 'Reunión con Iñigo Larrea · Presupuesto de baño', offset: 2, hora: '11:30' },
  { id: 'demo-agenda-7', titulo: 'Visita técnica a Aitor Elorriaga · Galdakao', offset: 3, hora: '09:00' },
  { id: 'demo-agenda-8', titulo: 'Entrega de llaves · Reforma baño Deusto', offset: 5, hora: '12:00' },
  { id: 'demo-agenda-9', titulo: 'Recepción de encimera · Leioa', offset: 7, hora: '10:00' },
];

export function construirAgenda(now: Date = new Date()): AgendaEvento[] {
  return AGENDA_DEF.map((d) => ({
    id: d.id,
    titulo: d.titulo,
    fecha: d.offset === 0 ? demoFecha(0, now) : demoFechaLaborable(d.offset, now),
    hora: d.hora,
  }));
}

/* ------------------------------ Gastos ------------------------------ */

type GastoDef = {
  obraId: string | null;
  /** Días naturales hacia atrás desde hoy (0-29). */
  atras: number;
  proveedor: string;
  descripcion: string;
  categoria: (typeof GASTO_CATEGORIAS)[number];
  importeCent: number;
};

const GASTOS_DEF: GastoDef[] = [
  { obraId: 'demo-obra-1', atras: 28, proveedor: 'Almacén de Materiales Uribe S.L.', descripcion: 'Adhesivo, junta y material de alicatado', categoria: 'material', importeCent: 41260 },
  { obraId: 'demo-obra-1', atras: 25, proveedor: 'Contenedores Nerbioi S.L.', descripcion: 'Contenedor de escombros de 6 m³ con retirada', categoria: 'vertido', importeCent: 18500 },
  { obraId: 'demo-obra-1', atras: 21, proveedor: 'Electricidad Arratia S.L.', descripcion: 'Cable, tubo corrugado y mecanismos', categoria: 'material', importeCent: 34890 },
  { obraId: null, atras: 18, proveedor: 'Ferretería Industrial Txori S.L.', descripcion: 'Reposición de herramienta y EPIs', categoria: 'herramienta', importeCent: 13240 },
  { obraId: 'demo-obra-1', atras: 14, proveedor: 'Transportes Ibaizabal S.L.', descripcion: 'Portes de material a obra', categoria: 'transporte', importeCent: 9600 },
  { obraId: 'demo-obra-2', atras: 11, proveedor: 'Almacén de Materiales Uribe S.L.', descripcion: 'Azulejo y pegamento del baño', categoria: 'material', importeCent: 52430 },
  { obraId: 'demo-obra-2', atras: 9, proveedor: 'Suministros de Fontanería Abando S.L.', descripcion: 'Plato de ducha, sifones y grifería', categoria: 'material', importeCent: 61800 },
  { obraId: 'demo-obra-3', atras: 8, proveedor: 'Ferretería Industrial Txori S.L.', descripcion: 'Discos de corte y brocas', categoria: 'herramienta', importeCent: 7450 },
  { obraId: null, atras: 6, proveedor: 'Parking Centro Bilbao S.L.', descripcion: 'Aparcamiento en visitas a clientes', categoria: 'otros', importeCent: 3800 },
  { obraId: 'demo-obra-3', atras: 5, proveedor: 'Ayudas de Albañilería Zorrotza S.L.', descripcion: 'Ayudas de albañilería subcontratadas', categoria: 'subcontrata', importeCent: 64000 },
  { obraId: 'demo-obra-4', atras: 2, proveedor: 'Contenedores Nerbioi S.L.', descripcion: 'Contenedor de demolición del local', categoria: 'vertido', importeCent: 26000 },
  { obraId: 'demo-obra-4', atras: 1, proveedor: 'Alquiler de Maquinaria Ercilla S.L.', descripcion: 'Martillo demoledor, 3 días', categoria: 'herramienta', importeCent: 18750 },
];

export type DemoGastoConObra = DemoGastoFila & { obra_id: string | null };

/**
 * Día laborable para un gasto: nunca en fin de semana, nunca antes del inicio de su obra
 * ni después de hoy. Un fin de semana retrocede al viernes; si eso queda antes del inicio, avanza al lunes.
 */
function fechaGasto(atras: number, obraId: string | null, now: Date): string {
  const inicio = obraId ? demoFecha(obra(obraId).inicio, now) : null;
  let f = demoFecha(-atras, now);
  if (inicio && f < inicio) f = inicio;
  while (demoEsFinDeSemana(f)) f = demoSumarDias(f, -1);
  if (inicio && f < inicio) {
    f = inicio;
    while (demoEsFinDeSemana(f)) f = demoSumarDias(f, 1);
  }
  return f;
}

/** Gastos de los últimos 30 días naturales (todas las filas del mock). */
export function construirGastos(now: Date = new Date()): DemoGastoConObra[] {
  return GASTOS_DEF.map((d, i) => {
    const iva = Math.round((d.importeCent * 21) / 100);
    return {
      id: `demo-gasto-${i + 1}`,
      fecha: fechaGasto(d.atras, d.obraId, now),
      proveedor: d.proveedor,
      descripcion: d.descripcion,
      categoria: d.categoria,
      importe: d.importeCent / 100,
      iva: iva / 100,
      importe_total: (d.importeCent + iva) / 100,
      obra_id: d.obraId,
    };
  });
}

/**
 * Gastos que pinta la página para `mes` (YYYY-MM): los de ese mes dentro de la ventana de 30 días.
 * En el mes actual con menos de 10 días laborables se muestra toda la ventana para que no salga casi vacío.
 */
export function gastosDelMes(mes: string, now: Date = new Date()): DemoGastoConObra[] {
  const todos = construirGastos(now);
  if (mes === demoMesActual(now) && demoDiasLaborables(mes, now).length < DEMO_MIN_LABORABLES_MES) {
    return todos;
  }
  return todos.filter((g) => g.fecha.startsWith(mes));
}

/* --------------------------- Operarios y horas --------------------------- */

export const DEMO_OPERARIOS: DemoOperario[] = [
  { id: 'demo-operario-1', nombre: 'Unai G.', dni: null },
  { id: 'demo-operario-2', nombre: 'Ane M.', dni: '00000001R' },
  { id: 'demo-operario-3', nombre: 'Xabier L.', dni: null },
  { id: 'demo-operario-4', nombre: 'Mikel A.', dni: null },
];

/** Obras candidatas por operario y día de la semana (1 = lunes ... 5 = viernes). */
const ASIGNACION: Record<string, string[][]> = {
  'demo-operario-1': [
    ['demo-obra-1'], ['demo-obra-1'], ['demo-obra-1'], ['demo-obra-3', 'demo-obra-1'], ['demo-obra-3', 'demo-obra-1'],
  ],
  'demo-operario-2': [
    ['demo-obra-2', 'demo-obra-1'], ['demo-obra-2', 'demo-obra-1'], ['demo-obra-2', 'demo-obra-1'],
    ['demo-obra-2', 'demo-obra-1'], ['demo-obra-4', 'demo-obra-2', 'demo-obra-1'],
  ],
  'demo-operario-3': [
    ['demo-obra-1'], ['demo-obra-1'], ['demo-obra-1'], ['demo-obra-1'], ['demo-obra-1'],
  ],
  'demo-operario-4': [
    ['demo-obra-4', 'demo-obra-3', 'demo-obra-1'], ['demo-obra-4', 'demo-obra-3', 'demo-obra-1'],
    ['demo-obra-3', 'demo-obra-1'], ['demo-obra-3', 'demo-obra-1'], ['demo-obra-1'],
  ],
};

const HORAS_REALES = [8, 7.5, 8, 6.5, 7, 8, 7, 6, 8, 7.5];
const NOTAS: Record<number, string> = {
  3: 'Horas extra por entrega de material',
  7: 'Salida temprana por visita al proveedor',
};

function obraActiva(obraId: string, iso: string, now: Date): boolean {
  const o = obra(obraId);
  return iso >= demoFecha(o.inicio, now) && iso <= demoFecha(o.fin, now);
}

/** Partes de horas de lunes a viernes de `mes` hasta hoy (ver demoDiasLaborablesVentana a principio de mes). */
export function construirRegistrosJornada(mes: string, now: Date = new Date()): DemoRegistroJornada[] {
  const dias = demoDiasLaborablesVentana(mes, now);
  const out: DemoRegistroJornada[] = [];
  DEMO_OPERARIOS.forEach((op, opIdx) => {
    dias.forEach((iso, diaIdx) => {
      const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
      const candidatas = ASIGNACION[op.id][dow - 1];
      const obraId = candidatas.find((c) => obraActiva(c, iso, now)) ?? 'demo-obra-1';
      const k = (diaIdx + opIdx * 3) % HORAS_REALES.length;
      out.push({
        id: `demo-jornada-${opIdx + 1}-${iso}`,
        fecha: iso,
        horas_reales: HORAS_REALES[k],
        horas_convenio: 8,
        notas: NOTAS[k] ?? null,
        operario_id: op.id,
        obra_id: obraId,
      });
    });
  });
  return out;
}

/* ------------------------------ Diario ------------------------------ */

type DiarioDef = {
  id: string;
  obraId: string;
  offset: number;
  hora: string;
  texto: string;
  fotos?: string[];
};

const DIARIO_DEF: DiarioDef[] = [
  {
    id: 'demo-diario-1',
    obraId: 'demo-obra-1',
    offset: -20,
    hora: '18:10',
    texto:
      'Estado inicial de la vivienda tras la demolición: tabiquería y alicatados retirados, escombro gestionado en contenedor. Se deja registrado el estado de la cocina antes de tabicar. Pendiente: replanteo de instalaciones.',
    fotos: ['/demo/obras/algorta-antes-cocina.jpg'],
  },
  {
    id: 'demo-diario-2',
    obraId: 'demo-obra-1',
    offset: -13,
    hora: '17:45',
    texto:
      'Rozas terminadas en cocina y baño. Colocados tubos de fontanería, corrugado y cajas de mecanismos. Incidencia: una tubería antigua de bajante no estaba en planos; se ha reforzado y protegido. Material pendiente: placas de pladur para el jueves.',
    fotos: ['/demo/obras/algorta-durante-instalaciones.jpg'],
  },
  {
    id: 'demo-diario-3',
    obraId: 'demo-obra-1',
    offset: -6,
    hora: '18:00',
    texto:
      'Tabiquería de pladur montada en el pasillo y el dormitorio principal. Instalado aislante acústico en el trasdosado del salón. Falta recibir perfilería para el falso techo (albarán pendiente).',
  },
  {
    id: 'demo-diario-4',
    obraId: 'demo-obra-1',
    offset: 0,
    hora: '13:30', // hoy: se sustituye por «ahora menos 2 h» (o ayer si es muy temprano)
    texto:
      'Iniciado el alicatado del baño principal. Cliente confirma la elección de azulejo. Falta el plato de ducha, previsto para la próxima semana.',
  },
  {
    id: 'demo-diario-5',
    obraId: 'demo-obra-2',
    offset: -9,
    hora: '17:20',
    texto:
      'Demolición del alicatado y retirada de la bañera. Fontanería nueva instalada y probada sin fugas. Escombros en contenedor de la comunidad, con autorización de la administración de fincas.',
  },
  {
    id: 'demo-diario-6',
    obraId: 'demo-obra-2',
    offset: -5,
    hora: '17:55',
    texto:
      'Alicatado de las tres paredes del baño en marcha, pieza de 60x30 en horizontal. Preparado el desagüe del plato de ducha. Sin incidencias; mañana se coloca el solado.',
    fotos: ['/demo/obras/deusto-bano-durante-alicatado.jpg'],
  },
  {
    id: 'demo-diario-7',
    obraId: 'demo-obra-2',
    offset: -1,
    hora: '19:00',
    texto:
      'Baño terminado: mampara instalada, mueble de lavabo colocado y silicona curada. Limpieza final hecha. Queda el repaso de pintura del techo y la entrega de llaves con el cliente.',
    fotos: ['/demo/obras/deusto-bano-despues.jpg'],
  },
  {
    id: 'demo-diario-8',
    obraId: 'demo-obra-3',
    offset: -8,
    hora: '17:30',
    texto:
      'Desmontaje de la cocina antigua y picado del alicatado del frente. Contenedor retirado por la tarde. Se detecta una toma de agua sin llave de corte; se sustituirá en la fase de fontanería.',
  },
  {
    id: 'demo-diario-9',
    obraId: 'demo-obra-3',
    offset: -2,
    hora: '18:05',
    texto:
      'Replanteo de muebles y ayudas de fontanería. Pendiente confirmar con la cliente la altura de la campana. Material pendiente: tomas de agua y desagües para el jueves.',
  },
  {
    id: 'demo-diario-10',
    obraId: 'demo-obra-4',
    offset: -2,
    hora: '16:40',
    texto:
      'Demolición de la tabiquería antigua del local con martillo eléctrico. Contenedor lleno al 70 %. Incidencia: se ha encontrado una arqueta no reflejada en los planos, se revisará antes de picar el solado.',
    fotos: ['/demo/obras/durango-local-demolicion.jpg'],
  },
];

export function construirDiario(now: Date = new Date()): DemoDiarioEntrada[] {
  return DIARIO_DEF.map((d) => ({
    id: d.id,
    obra_nombre: obra(d.obraId).nombre,
    obra_id: d.obraId,
    obra_direccion: obra(d.obraId).direccion,
    texto: d.texto,
    fotos: d.fotos ?? [],
    videos: [],
    fecha: d.offset === 0 ? demoTimestampReciente(2, d.hora, now) : demoTimestamp(d.offset, d.hora, now),
  }));
}

/* ------------------------------ Mensajes ------------------------------ */

export function construirMensajes(now: Date = new Date()): DemoConversation[] {
  return [
    {
      id: 'demo-conversacion-1',
      customer_name: 'Leire Olabarria',
      customer_contact: '944 00 00 05',
      channel: 'whatsapp',
      priority: 'urgent',
      status: 'pending',
      created_at: demoTimestampReciente(1, '19:15', now),
      message:
        'Buenos días, ¿sabéis ya cuándo llega la encimera? Llevamos semanas sin cocina y necesitamos saber una fecha para organizarnos.',
      ai_responses: [
        {
          id: 'demo-respuesta-1',
          ai_response:
            'Hola Leire, gracias por escribirnos. La encimera de cuarzo está pedida y la agenda marca su recepción para dentro de una semana. En cuanto llegue, retomamos la obra y le confirmamos el día exacto de la colocación. Sentimos las molestias.',
          edited_response: null,
        },
      ],
    },
    {
      id: 'demo-conversacion-2',
      customer_name: 'Kafetegi Berria S.L.',
      customer_contact: 'administracion@example.com',
      channel: 'email',
      priority: 'normal',
      status: 'pending',
      created_at: demoTimestamp(-1, '17:15', now),
      message:
        'Buenas tardes. Necesitamos saber cuándo podéis empezar con la adecuación del local, ya que queremos abrir la cafetería antes de fin de año.',
      ai_responses: [
        {
          id: 'demo-respuesta-2',
          ai_response:
            'Buenas tardes. Hemos comenzado la demolición del local esta semana y el plan de obra prevé unas seis semanas hasta la entrega. Le enviamos el calendario detallado para que pueda planificar la apertura.',
          edited_response: null,
        },
      ],
    },
    {
      id: 'demo-conversacion-3',
      customer_name: 'Iñigo Larrea',
      customer_contact: 'inigo.larrea@example.com',
      channel: 'email',
      priority: 'normal',
      status: 'pending',
      created_at: demoTimestamp(-1, '10:05', now),
      message:
        'Hola, ¿habéis podido preparar ya el presupuesto del cambio de bañera por ducha? Me gustaría verlo antes del fin de semana.',
      ai_responses: [
        {
          id: 'demo-respuesta-3',
          ai_response:
            'Hola Iñigo. El presupuesto está en borrador y lo repasamos en la reunión de esta semana. Le enviamos la versión final con el desglose por partidas justo después.',
          edited_response: null,
        },
      ],
    },
    {
      id: 'demo-conversacion-4',
      customer_name: 'Jon Arrieta',
      customer_contact: '944 00 00 02',
      channel: 'whatsapp',
      priority: 'low',
      status: 'pending',
      created_at: demoTimestamp(-2, '19:30', now),
      message: 'Perfecto, confirmo que el día de la entrega de llaves me viene bien. Gracias por todo.',
      ai_responses: [
        {
          id: 'demo-respuesta-4',
          ai_response:
            'Gracias a usted, Jon. Queda confirmada la entrega de llaves en la fecha acordada. Nos vemos en el baño para el último repaso.',
          edited_response: null,
        },
      ],
    },
  ];
}
