/**
 * Para cada frase de `evals/frases-pino.ts`: la ORDEN .jev que debe sacar el traductor (aquí simulada) y lo que
 * debe pasar después en el ejecutor (con la base simulada). Así se prueba todo lo que hace el SERVIDOR: resolver
 * clientes/obras/fechas/importes, preguntar, guardar la orden pendiente y ejecutar tras el «Sí».
 *
 * `comportamiento` solo se indica cuando el motor .jev se porta distinto del antiguo (p. ej. una factura sin importe
 * ahora es una pregunta, no una lista de opciones).
 */
import { IDS } from './base-simulada';
import type { ComportamientoAgente } from './frases-pino';

export type CasoOrdenJev = {
  orden: Record<string, unknown>;
  comportamiento?: ComportamientoAgente;
  /** Trozos que debe llevar la respuesta (plantillas del servidor). */
  contiene?: string[];
  /** Historial previo (p. ej. con la marca del último presupuesto). */
  historial?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Comprobación sobre LO GUARDADO tras confirmar (filas de la base simulada). */
  guardado?: (tablas: Record<string, Array<Record<string, unknown>>>) => void;
};

const marcaPresupuesto = (id: string, numero: number) => `\n<!--presupuesto:${JSON.stringify({ id, numero })}-->`;
const aclarar = (pregunta: string) => ({ accion: 'ACLARAR', pregunta });
const ultimo = (t: Record<string, Array<Record<string, unknown>>>, tabla: string) => t[tabla]!.at(-1)!;

export const ORDEN_POR_FRASE: Record<string, CasoOrdenJev> = {
  'Apúntame una visita mañana a las 10 con Ane en Olabide': {
    orden: { accion: 'CITA_CREAR', titulo_texto: 'Visita con Ane en Olabide', fecha_texto: 'mañana', hora_texto: 'a las 10' },
    contiene: ['Visita con Ane en Olabide', '2026-10-07', '10:00'],
    guardado: (t) => expect(ultimo(t, 'agenda')).toMatchObject({ titulo: 'Visita con Ane en Olabide', fecha: '2026-10-07', hora: '10:00' }),
  },
  'Hazme un presupuesto para Paqui: alicatar el baño, 12 metros a 40 euros': {
    orden: { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatar el baño', cantidad_texto: '12', unidad_texto: 'metros', precio_texto: '40' }] },
    contiene: ['Paqui', '12 m2 × 40,00 €', '580,80 €'],
    guardado: (t) => expect(t.presupuestos!.find((p) => p.cliente_nombre === 'Paqui' && p.estado === 'borrador')).toMatchObject({ importe_total: 580.8 }),
  },
  'Pon una partida de pintura de 30 metros a 8 euros en el presupuesto de Paqui': {
    orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'Paqui', anadir: [{ concepto_texto: 'Pintura', cantidad_texto: '30', unidad_texto: 'm2', precio_texto: '8' }] },
    comportamiento: 'pide_confirmacion',
    contiene: ['nº 7'],
  },
  'Anota en el diario de la obra de Paqui que hoy se ha picado el baño': {
    orden: { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'Hoy se ha picado el baño' },
    contiene: ['Reforma Paqui'],
    guardado: (t) => expect(ultimo(t, 'diario_obra')).toMatchObject({ obra_id: IDS.obraPaqui, texto: 'Hoy se ha picado el baño' }),
  },
  'Apunta en el diario de Olabide que ha llegado el material': { orden: { accion: 'DIARIO', obra_texto: 'Olabide', texto: 'Ha llegado el material' }, contiene: ['Olabide 9', 'Olabide 12'] },
  'Hazme la factura del presupuesto 7': {
    orden: { accion: 'FACTURAR', presupuesto_texto: '7' },
    contiene: ['nº 7'],
    guardado: (t) => expect(t.facturas!.find((f) => f.presupuesto_id === IDS.presupuesto7)).toMatchObject({ business_id: '8784450e-08a4-420a-8c37-d30bff8f0d39' }),
  },
  'Hazme la factura del presupuesto de García': { orden: { accion: 'FACTURAR', presupuesto_texto: 'García' }, contiene: ['García Norte', 'García Sur'] },
  'Mándame el PDF de la factura 3': { orden: { accion: 'PDF_ENLACE', documento: 'factura', ref_texto: '3' } },
  'Ponle 8 horas a Iker en lo de Paqui': {
    orden: { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui' },
    contiene: ['Iker Etxeberria', 'Reforma Paqui'],
    guardado: (t) => expect(ultimo(t, 'registros_jornada')).toMatchObject({ operario_id: IDS.operarioIker, obra_id: IDS.obraPaqui, horas_reales: 8 }),
  },
  'Ponle 5 horas a Mikel en lo de Paqui': { orden: { accion: 'HORAS', operario_texto: 'Mikel', horas_texto: '5', obra_texto: 'Paqui' }, contiene: ['Mikel Goñi', 'Mikel Ruiz'] },
  '¿Qué obras tengo activas?': { orden: { accion: 'CONSULTA_OBRAS', estado: 'abiertas' }, contiene: ['Reforma Paqui'] },
  '¿Qué facturas tengo pendientes de cobro?': { orden: { accion: 'CONSULTA_FACTURAS', estado: 'pendiente' }, contiene: ['nº 3'] },
  'Enséñame los presupuestos que tengo pendientes': { orden: { accion: 'CONSULTA_PRESUPUESTOS', estado: 'pendientes' }, contiene: ['nº 10'] },
  'Pasa el presupuesto 7 a rechazado': {
    orden: { accion: 'CAMBIAR_ESTADO_PRESUPUESTO', presupuesto_texto: '7', estado: 'rechazado' },
    guardado: (t) => expect(t.presupuestos!.find((p) => p.id === IDS.presupuesto7)).toMatchObject({ estado: 'rechazado' }),
  },
  'Anota esto': { orden: aclarar('¿En qué obra lo anoto y qué quieres apuntar?'), comportamiento: 'pregunta_o_error' },
  'Hola, buenas': { orden: { accion: 'CHARLA' } },
  '¿Qué tengo hoy?': { orden: { accion: 'CONSULTA_DIA' } },
  'Factúrame el albarán 12': {
    orden: { accion: 'FACTURAR', albaran_texto: '12' },
    contiene: ['nº 12', 'Paqui'],
    guardado: (t) => expect(t.albaranes!.find((a) => a.id === IDS.albaran12)).toMatchObject({ estado: 'facturado' }),
  },
  'Marca la factura 3 como pagada': {
    orden: { accion: 'MARCAR_PAGADA', factura_texto: '3', estado: 'pagada' },
    contiene: ['nº 3', 'Paqui'],
    guardado: (t) => expect(t.facturas!.find((f) => f.id === IDS.factura3)).toMatchObject({ estado: 'pagada' }),
  },
  'Hazle la factura a García': { orden: aclarar('¿De cuánto es la factura y por qué trabajo?'), comportamiento: 'pregunta_o_error' },
  'Ponle 6 horas a Iker': { orden: aclarar('¿En qué obra?'), comportamiento: 'pregunta_o_error' },
  'Hazme una factura de 800 para la obra del baño': { orden: aclarar('¿Para qué cliente es la factura?'), comportamiento: 'pregunta_o_error' },
  'Factura el albarán': { orden: aclarar('¿Qué albarán? Dime el número o el cliente.'), comportamiento: 'pregunta_o_error' },
  'Haz una factura para Paqui': { orden: aclarar('¿De cuánto es la factura?'), comportamiento: 'pregunta_o_error' },
  'Hazle una factura de 500 a Paqui': {
    orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', descripcion_texto: 'Reforma', importe_texto: '1500' }, // el modelo se inventa 1.500
    comportamiento: 'pregunta_o_error',
    contiene: ['No veo el importe 1500'],
  },
  'Cambia el albarán 14 a pendiente': { orden: aclarar('Eso todavía no lo hago desde el chat: cambia el estado del albarán en la pantalla de Albaranes.'), comportamiento: 'pregunta_o_error' },
  'Mete la factura de Txema de 300 euros': {
    orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Txema', descripcion_texto: 'Trabajos', importe_texto: '300' },
    comportamiento: 'pregunta_o_error',
    contiene: ['No tengo a «Txema»'],
  },
  'pásame el pdf de ese presu': {
    orden: { accion: 'PDF_ENLACE', documento: 'presupuesto', ref_texto: 'ese' },
    comportamiento: 'solo_lectura',
    historial: [{ role: 'assistant', content: `Presupuesto nº 10 de Mikel Etxeberria guardado como borrador.${marcaPresupuesto(IDS.presupuestoMikelBorrador, 10)}` }],
    contiene: ['BORRADOR'],
  },
  'quítale la mampara y pon 2 metros más de alicatado': {
    orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'ese', quitar_texto: ['mampara'], cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }] },
    historial: [{ role: 'assistant', content: `Presupuesto nº 10 guardado.${marcaPresupuesto(IDS.presupuestoMikelBorrador, 10)}` }],
    contiene: ['Mampara', '580,80'],
    guardado: (t) => expect(t.presupuestos!.find((p) => p.id === IDS.presupuestoMikelBorrador)).toMatchObject({ importe_total: 580.8 }),
  },
  'el cliente ha dicho que sí, márcalo aceptado': {
    orden: { accion: 'CAMBIAR_ESTADO_PRESUPUESTO', presupuesto_texto: 'ese', estado: 'aceptado' },
    historial: [{ role: 'assistant', content: `Presupuesto nº 10 guardado.${marcaPresupuesto(IDS.presupuestoMikelBorrador, 10)}` }],
    guardado: (t) => expect(t.presupuestos!.find((p) => p.id === IDS.presupuestoMikelBorrador)).toMatchObject({ estado: 'aceptado' }),
  },
  factúralo: {
    orden: { accion: 'FACTURAR', presupuesto_texto: 'ese' },
    comportamiento: 'pregunta_o_error',
    historial: [{ role: 'assistant', content: `Presupuesto nº 10 guardado.${marcaPresupuesto(IDS.presupuestoMikelBorrador, 10)}` }],
    contiene: ['aceptado'],
  },
  márcalaPagada: { orden: { accion: 'MARCAR_PAGADA', factura_texto: '3' } },
  'ponme cita con Mikel el jueves a las 10 y media en la obra': {
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Mikel Etxeberria', fecha_texto: 'el jueves', hora_texto: '10 y media' },
    contiene: ['Mikel Etxeberria', '2026-10-08', '10:30', 'Reforma baño Mikel Etxeberria'],
    guardado: (t) => expect(ultimo(t, 'agenda')).toMatchObject({ fecha: '2026-10-08', hora: '10:30', cliente_id: IDS.clienteMikelEtxeberria, obra_id: IDS.obraMikelEtxeberria }),
  },
  'ponme cita con Etxeberria el jueves a las 10': {
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Etxeberria', fecha_texto: 'el jueves', hora_texto: '10' },
    contiene: ['Mikel Etxeberria', 'Ainhoa Etxeberria', 'Amaia Etxeberria'],
  },
  'pasa lo de Mikel al viernes a la misma hora': {
    orden: { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al viernes' },
    contiene: ['2026-10-16'],
    guardado: (t) => expect(t.agenda!.find((e) => e.id === 'ev-mikel')).toMatchObject({ fecha: '2026-10-16' }),
  },
  '85 de material para lo de Mikel': {
    orden: { accion: 'GASTO', proveedor_texto: 'Material', importe_texto: '85', iva_modo: 'incluido', obra_texto: 'Mikel', categoria: 'material' },
    contiene: ['85,00 €'],
    guardado: (t) => expect(ultimo(t, 'gastos')).toMatchObject({ importe_total: 85, importe: 70.25, iva: 14.75, obra_id: IDS.obraMikelEtxeberria }),
  },
  'pon 2 metros más de alicatado en el 11': {
    orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }] },
    contiene: ['Alicatar 18 m2', '18 × 40'],
  },
  'quítale la mampara al 11': { orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', quitar_texto: ['mampara'] }, comportamiento: 'pregunta_o_error', contiene: ['Plato de ducha con mampara'] },
  'factura el 11': { orden: { accion: 'FACTURAR', presupuesto_texto: '11' }, contiene: ['Ainhoa Etxeberria', 'me falta el NIF'] },
  'el NIF de Ainhoa es 44444444B': {
    orden: { accion: 'ACTUALIZAR_CLIENTE', cliente_texto: 'Ainhoa Etxeberria', nif_texto: '44444444B' },
    contiene: ['NIF: 44444444B'],
    guardado: (t) => expect(t.clientes!.find((c) => c.id === IDS.clienteAinhoaEtxeberria)).toMatchObject({ nif: '44444444B' }),
  },
  'pasa lo de Mikel al miércoles de la semana que viene a la misma hora': {
    orden: { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al miércoles de la semana que viene' },
    contiene: ['2026-10-14', 'choca con «Visita obra Olabide»'],
  },
  '121 con IVA en Saltoki para lo de Leire, cable y mecanismos de la cocina': {
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', iva_modo: 'incluido', obra_texto: 'Leire', descripcion_texto: 'cable y mecanismos' },
    contiene: ['Reforma cocina Leire Ugarte', 'Leire Ugarte', 'Saltoki'],
    guardado: (t) =>
      expect(ultimo(t, 'gastos')).toMatchObject({ obra_id: IDS.obraLeire, cliente_id: IDS.clienteLeire, proveedor_id: IDS.proveedorSaltoki, descripcion: 'cable y mecanismos', importe_total: 121 }),
  },
  'ayer desmontamos los muebles en lo de Leire': {
    orden: { accion: 'DIARIO', obra_texto: 'Leire', texto: 'Desmontamos los muebles', fecha_texto: 'ayer' },
    contiene: ['2026-10-05'],
    guardado: (t) => expect(String(ultimo(t, 'diario_obra').fecha).slice(0, 10)).toBe('2026-10-05'),
  },
  '¿cómo va la obra de Amaia?': { orden: { accion: 'CONSULTA_OBRA', obra_texto: 'Amaia' }, contiene: ['Reforma terraza Amaia', 'obra cerrada'] },
  'cierra la obra de Leire': {
    orden: { accion: 'CERRAR_OBRA', obra_texto: 'Leire' },
    contiene: ['Voy a cerrar la obra «Reforma cocina Leire Ugarte»'],
    guardado: (t) => expect(t.obras!.find((o) => o.id === IDS.obraLeire)).toMatchObject({ estado: 'cerrada' }),
  },
  '¿cuánto me he gastado en Saltoki?': { orden: { accion: 'CONSULTA_GASTOS', proveedor_texto: 'Saltoki' } },
  'ponme cita con Mikel el lunes a las 10': {
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Mikel Etxeberria', fecha_texto: 'el lunes', hora_texto: '10' },
    contiene: ['2026-10-12'],
    guardado: (t) => expect(ultimo(t, 'agenda')).toMatchObject({ fecha: '2026-10-12', hora: '10:00' }),
  },
  'ponme cita con Mikel el jueves a las 11': {
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Mikel Etxeberria', fecha_texto: 'el jueves', hora_texto: '11' },
    guardado: (t) => expect(ultimo(t, 'agenda')).toMatchObject({ fecha: '2026-10-08', hora: '11:00' }),
  },
  'apunta 250 más IVA en Saltoki, plato de ducha y grifería para lo de Leire': {
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '250', iva_modo: 'incluido', obra_texto: 'Leire' }, // el modelo se equivoca; manda «más IVA»
    contiene: ['302,50 €'],
    guardado: (t) => expect(ultimo(t, 'gastos')).toMatchObject({ importe: 250, iva: 52.5, importe_total: 302.5, descripcion: 'Plato de ducha y grifería' }),
  },
  '250 con IVA en Saltoki, plato de ducha y grifería para lo de Leire': {
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '250', iva_modo: 'mas', obra_texto: 'Leire' },
    guardado: (t) => expect(ultimo(t, 'gastos')).toMatchObject({ importe: 206.61, iva: 43.39, importe_total: 250 }),
  },
  'crea la obra Reforma baño Ane Hondarribia para Mikel Etxeberria': {
    orden: { accion: 'CREAR_OBRA', nombre_texto: 'Reforma baño Ane Hondarribia', cliente_texto: 'Mikel Etxeberria' },
    contiene: ['«Reforma baño Ane Hondarribia»', 'Mikel Etxeberria'],
    guardado: (t) => expect(ultimo(t, 'obras')).toMatchObject({ nombre: 'Reforma baño Ane Hondarribia', cliente_id: IDS.clienteMikelEtxeberria }),
  },
  'crea la obra Reforma cocina Leire Ugarte': { orden: { accion: 'CREAR_OBRA', nombre_texto: 'Reforma cocina Leire Ugarte' }, contiene: ['Ya existe una obra llamada'] },
  'da de alta a Bricomart de Irún como proveedor': {
    orden: { accion: 'PROVEEDOR_CREAR', nombre_texto: 'Bricomart' },
    contiene: ['Población: Irún'],
    guardado: (t) => expect(t.proveedores!.find((p) => p.nombre === 'Bricomart')).toMatchObject({ notas: 'Población: Irún' }),
  },
  // ── Ronda 7: reglas generales del ejecutor ──
  'pon 14 en vez de 18 metros de alicatado en el 11': {
    orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', cambiar: [{ partida_texto: 'alicatado', cantidad_texto: '14', cantidad_anterior_texto: '18' }] },
    contiene: ['18 × 40 € → 14 × 40 €', 'ya está aceptado'],
  },
  'quítale 3 metros al alicatado del 11': {
    orden: { accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '-3' }] },
    contiene: ['18 × 40 € → 15 × 40 €'],
  },
  'ponle 6 horas a Aitor el pintor en lo de Paqui': {
    orden: { accion: 'HORAS', operario_texto: 'Aitor el pintor', horas_texto: '6', obra_texto: 'Paqui' },
    contiene: ['Aitor Gómez', 'Reforma Paqui'],
    guardado: (t) => expect(ultimo(t, 'registros_jornada')).toMatchObject({ operario_id: IDS.operarioAitor, obra_id: IDS.obraPaqui, horas_reales: 6 }),
  },
  'apunta en el diario del baño de Unai que hoy se ha picado': {
    orden: { accion: 'DIARIO', obra_texto: 'el baño de Unai', texto: 'Hoy se ha picado' },
    contiene: ['Reforma baño completo'],
    guardado: (t) => expect(ultimo(t, 'diario_obra')).toMatchObject({ obra_id: IDS.obraBanoUnai }),
  },
  'pasa lo de Mikel al jueves': {
    orden: { accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al jueves' },
    contiene: ['2026-10-15'],
    guardado: (t) => expect(t.agenda!.find((e) => e.id === 'ev-mikel')).toMatchObject({ fecha: '2026-10-15' }),
  },
  '121 con IVA en Saltoki para lo de Leire': {
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', iva_modo: 'incluido', obra_texto: 'Leire' },
    contiene: ['Saltoki (tel. 943 111 222)'],
  },
};

// «márcala pagada» está escrito con tilde en las frases de Pino.
ORDEN_POR_FRASE['márcala pagada'] = {
  orden: { accion: 'MARCAR_PAGADA', factura_texto: 'esa' },
  contiene: ['nº 3'],
  guardado: (t) => expect(t.facturas!.find((f) => f.id === IDS.factura3)).toMatchObject({ estado: 'pagada' }),
};
delete ORDEN_POR_FRASE.márcalaPagada;
