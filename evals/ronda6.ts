/**
 * Frases de la prueba REAL de producción (ronda 6) en las que el traductor devolvió «No te he entendido bien».
 * Cada una lleva la orden .jev que debe salir. Se usan en:
 *  - `__tests__/jev.ronda6.test.ts`: el modelo simulado devuelve la orden BIEN y también «mal educada»
 *    ("", "null", "N/A", campos de más…); el resultado tiene que ser el mismo.
 *  - `evals/jev-real.eval.ts` (`npm run eval:jev-real`): el traductor REAL con GPT-4o mini.
 */
export type FraseRonda6 = {
  frase: string;
  /** Categoría que daría el router de intención. */
  categoria: string;
  /** La orden que debe salir del traductor. */
  orden: Record<string, unknown>;
  /** `lectura` se responde sin «Sí, hazlo»; `escritura` queda como orden pendiente. */
  tipo: 'lectura' | 'escritura';
  /** Trozos que debe llevar la respuesta del servidor. */
  contiene?: string[];
};

export const FRASES_RONDA6: FraseRonda6[] = [
  {
    frase: 'Crea el cliente Jon PRUEBA Arrieta, teléfono 600123123, de Hondarribia',
    categoria: 'clientes',
    orden: { accion: 'CREAR_CLIENTE', nombre_texto: 'Jon PRUEBA Arrieta', telefono_texto: '600123123', direccion_texto: 'Hondarribia' },
    tipo: 'escritura',
    contiene: ['Jon PRUEBA Arrieta'],
  },
  {
    frase: '¿Qué presupuestos tengo pendientes?',
    categoria: 'presupuesto',
    orden: { accion: 'CONSULTA_PRESUPUESTOS', estado: 'pendientes' },
    tipo: 'lectura',
    contiene: ['nº 10'],
  },
  {
    frase: 'Abre una obra de reforma de baño para Mikel Etxeberria en Olabide 5',
    categoria: 'clientes',
    orden: { accion: 'CREAR_OBRA', nombre_texto: 'Reforma de baño', cliente_texto: 'Mikel Etxeberria', direccion_texto: 'Olabide 5' },
    tipo: 'escritura',
    contiene: ['Reforma de baño'],
  },
  {
    frase: 'Hazme un presupuesto para Paqui: alicatar el baño, 12 metros a 40 euros, y pintar el salón, 30 metros a 8 euros',
    categoria: 'presupuesto',
    orden: {
      accion: 'PRESUPUESTO_DICTADO',
      cliente_texto: 'Paqui',
      partidas: [
        { concepto_texto: 'alicatar el baño', cantidad_texto: '12', unidad_texto: 'metros', precio_texto: '40' },
        { concepto_texto: 'pintar el salón', cantidad_texto: '30', unidad_texto: 'metros', precio_texto: '8' },
      ],
    },
    tipo: 'escritura',
    contiene: ['Paqui'],
  },
  {
    frase: 'Ponme una cita con Mikel Etxeberria el jueves a las 10',
    categoria: 'agenda',
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Mikel Etxeberria', fecha_texto: 'el jueves', hora_texto: 'a las 10' },
    tipo: 'escritura',
    contiene: ['2026-10-08', '10:00'],
  },
  {
    frase: 'Apunta un gasto de 180 más IVA en Saltoki para la obra de Leire',
    categoria: 'gastos',
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas', obra_texto: 'Leire' },
    tipo: 'escritura',
    contiene: ['217,80 €'],
  },
  {
    frase: '¿Qué tengo en la agenda esta semana?',
    categoria: 'agenda',
    orden: { accion: 'CONSULTA_AGENDA', rango_texto: 'esta semana' },
    tipo: 'lectura',
  },
  {
    frase: 'Anota 6 horas de Iker hoy en lo de Paqui',
    categoria: 'operarios',
    orden: { accion: 'HORAS', operario_texto: 'Iker', horas_texto: '6', obra_texto: 'Paqui', fecha_texto: 'hoy' },
    tipo: 'escritura',
    contiene: ['Iker Etxeberria', 'Reforma Paqui'],
  },
  {
    frase: 'Apunta en el diario de Paqui que hoy se ha puesto el plato de ducha',
    categoria: 'diario',
    orden: { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'Hoy se ha puesto el plato de ducha' },
    tipo: 'escritura',
    contiene: ['Reforma Paqui'],
  },
  {
    frase: '¿Qué obras tengo abiertas?',
    categoria: 'documentos',
    orden: { accion: 'CONSULTA_OBRAS', estado: 'abiertas' },
    tipo: 'lectura',
    contiene: ['Reforma Paqui'],
  },
  {
    frase: '¿Qué facturas me quedan por cobrar?',
    categoria: 'documentos',
    orden: { accion: 'CONSULTA_FACTURAS', estado: 'pendiente' },
    tipo: 'lectura',
    contiene: ['nº 3'],
  },
  {
    frase: '¿Cuánto me he gastado en Saltoki este mes?',
    categoria: 'gastos',
    orden: { accion: 'CONSULTA_GASTOS', proveedor_texto: 'Saltoki', periodo_texto: 'este mes' },
    tipo: 'lectura',
  },
  {
    frase: 'Hazme una factura para Paqui de 1500 euros por la reforma, más IVA',
    categoria: 'documentos',
    orden: { accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', descripcion_texto: 'Reforma', importe_texto: '1500', iva_modo: 'mas' },
    tipo: 'escritura',
    contiene: ['Paqui'],
  },
];
