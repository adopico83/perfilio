/**
 * Negocio de mentira para probar el agente SIN tocar la base de datos real.
 * Lo usan la batería de tests (`__tests__/agente.evals-simuladas.test.ts`) y el script opcional
 * contra el modelo real (`npm run eval:agente`).
 *
 * Hay DOS negocios con datos parecidos a propósito: el de Pino (A) y otro (B) con un presupuesto
 * nº 7, una factura nº 3 y una «Reforma Paqui» también. Así se comprueba que un número o un nombre
 * nunca se resuelve contra el negocio equivocado.
 */
import type { Fila } from '../__tests__/helpers/fake-db';

export const NEGOCIO_A = '8784450e-08a4-420a-8c37-d30bff8f0d39';
export const NEGOCIO_B = '900ed462-7640-4893-9030-a41163219f7a';
export const USUARIO = 'user-pino';

export const IDS = {
  clientePaqui: 'cli-paqui',
  clienteGarciaNorte: 'cli-garcia-norte',
  clienteGarciaSur: 'cli-garcia-sur',
  obraPaqui: 'obra-paqui',
  obraOlabide9: 'obra-olabide-9',
  obraOlabide12: 'obra-olabide-12',
  presupuesto7: 'aaaaaaaa-0000-4000-8000-000000000007',
  presupuesto7Ajeno: 'bbbbbbbb-0000-4000-8000-000000000007',
  presupuestoGarciaNorte: 'aaaaaaaa-0000-4000-8000-000000000008',
  presupuestoGarciaSur: 'aaaaaaaa-0000-4000-8000-000000000009',
  factura3: 'aaaaaaaa-1111-4000-8000-000000000003',
  factura3Ajena: 'bbbbbbbb-1111-4000-8000-000000000003',
  operarioIker: 'op-iker',
  operarioMikelGoni: 'op-mikel-goni',
  operarioMikelRuiz: 'op-mikel-ruiz',
  obraPaquiAjena: 'obra-b-paqui',
  obraBanoNorte: 'obra-bano-norte',
  obraBanoSur: 'obra-bano-sur',
  albaran12: 'aaaaaaaa-2222-4000-8000-000000000012',
  albaran12Ajeno: 'bbbbbbbb-2222-4000-8000-000000000012',
  albaran14Facturado: 'aaaaaaaa-2222-4000-8000-000000000014',
  clienteMikelEtxeberria: 'cli-mikel-etxeberria',
  clienteAinhoaEtxeberria: 'cli-ainhoa-etxeberria',
  clienteUnai: 'cli-unai-sarasola',
  obraBanoUnai: 'obra-bano-unai',
  operarioAitor: 'op-aitor-gomez',
  operarioJon: 'op-jon-arrieta',
  clienteMikelUrkiola: 'cli-mikel-urkiola',
  clienteAneLasa: 'cli-ane-lasa',
  clienteAneMendia: 'cli-ane-mendia',
  proveedorMaderas: 'prov-maderas-oria',
  clienteAmaiaEtxeberria: 'cli-amaia-etxeberria',
  obraMikelEtxeberria: 'obra-mikel-etxeberria',
  presupuestoMikelBorrador: 'aaaaaaaa-0000-4000-8000-000000000010',
  presupuestoAinhoaPendiente: 'aaaaaaaa-0000-4000-8000-000000000011',
  clienteLeire: 'cli-leire',
  obraLeire: 'obra-leire',
  obraCocinaAjena: 'obra-cocina-zarautz',
  obraTerrazaAmaia: 'obra-terraza-amaia',
  proveedorSaltoki: 'prov-saltoki',
} as const;

/** Líneas del presupuesto nº 7 (formato de `presupuesto_generado`): hacen falta para poder facturarlo. */
const TEXTO_PRESUPUESTO = [
  'CAPÍTULO BAÑO',
  '1. Alicatado de paredes | Cantidad: 12 | Precio: 40,00 € | Importe: 480,00 €',
  'TOTAL BAÑO: 480,00 €',
  'BASE IMPONIBLE: 480,00 € | IVA (21%): 100,80 € | TOTAL: 580,80 €',
].join('\n');

/** Presupuesto nº 10 de Mikel Etxeberria: lo que dicta el reformista (mampara + alicatado). */
const TEXTO_PRESUPUESTO_MIKEL = [
  'CAPÍTULO BAÑO',
  '1. Alicatado de paredes | Cantidad: 10 | Precio: 40,00 € | Importe: 400,00 €',
  '2. Mampara de ducha | Cantidad: 1 | Precio: 350,00 € | Importe: 350,00 €',
  'TOTAL BAÑO: 750,00 €',
  'BASE IMPONIBLE: 750,00 € | IVA (21%): 157,50 € | TOTAL: 907,50 €',
].join('\n');

/** Presupuesto nº 11: partidas con nombres parecidos a propósito («Quitar alicatado…» ≠ «Alicatar»). */
const TEXTO_PRESUPUESTO_TRAMPA = [
  'CAPÍTULO BAÑO',
  '1. Quitar alicatado y plato viejo | Cantidad: 1 | Precio: 150,00 € | Importe: 150,00 €',
  '2. Alicatar 18 m2 | Cantidad: 18 | Precio: 40,00 € | Importe: 720,00 €',
  '3. Plato de ducha con mampara | Cantidad: 1 | Precio: 900,00 € | Importe: 900,00 €',
  'TOTAL BAÑO: 1.770,00 €',
  'BASE IMPONIBLE: 1.770,00 € | IVA (21%): 371,70 € | TOTAL: 2.141,70 €',
].join('\n');

const perfil = (id: string, nombre: string): Fila => ({
  id,
  nombre,
  sector: 'Reformas',
  descripcion: '',
  servicios: '',
  tarifas: '',
  contexto_adicional: '',
  ciudad: 'Irún',
  direccion: null,
});

export function crearBaseSimulada(): Record<string, Fila[]> {
  return {
    business_profiles: [perfil(NEGOCIO_A, 'Pino Albañilería'), perfil(NEGOCIO_B, 'Estudio Orbegozo')],
    clientes: [
      { id: IDS.clienteMikelUrkiola, business_id: NEGOCIO_A, nombre: 'Mikel PRUEBA Urkiola', nif: '44444444D', direccion: 'Calle Urkiola 8, Irún', telefono: null },
      { id: IDS.clienteAneLasa, business_id: NEGOCIO_A, nombre: 'Ane Lasa', nif: '66666666Q', direccion: 'Calle Lasa 1, Irún', telefono: null },
      { id: IDS.clienteAneMendia, business_id: NEGOCIO_A, nombre: 'Ane Mendia', nif: '77777777B', direccion: 'Calle Mendia 2, Irún', telefono: null },
      { id: IDS.clienteUnai, business_id: NEGOCIO_A, nombre: 'Unai Sarasola', nif: '33333333P', direccion: 'Calle Unai 4, Irún', telefono: null },
      { id: IDS.clientePaqui, business_id: NEGOCIO_A, nombre: 'Paqui', nif: '12345678Z', direccion: 'Calle Mayor 1, Irún', telefono: '600111222' },
      { id: IDS.clienteGarciaNorte, business_id: NEGOCIO_A, nombre: 'García Norte', nif: 'B11111111', direccion: 'Calle Norte 2', telefono: null },
      { id: IDS.clienteGarciaSur, business_id: NEGOCIO_A, nombre: 'García Sur', nif: 'B22222222', direccion: 'Calle Sur 3', telefono: null },
      { id: IDS.clienteLeire, business_id: NEGOCIO_A, nombre: 'Leire Ugarte', nif: '55555555K', direccion: 'Calle Leire 7, Irún', telefono: '655000777' },
      // Tres Etxeberria: «Mikel Etxeberria» NUNCA puede acabar siendo Ainhoa ni Amaia (comparten apellido).
      { id: IDS.clienteMikelEtxeberria, business_id: NEGOCIO_A, nombre: 'Mikel Etxeberria', nif: '33333333A', direccion: 'Calle Mikel 3, Irún', telefono: '611000333' },
      { id: IDS.clienteAinhoaEtxeberria, business_id: NEGOCIO_A, nombre: 'Ainhoa Etxeberria', nif: null, direccion: 'Calle Ainhoa 4', telefono: '622000444' },
      { id: IDS.clienteAmaiaEtxeberria, business_id: NEGOCIO_A, nombre: 'Amaia Etxeberria', nif: '55555555C', direccion: 'Calle Amaia 5', telefono: '633000555' },
      { id: 'cli-b-lola', business_id: NEGOCIO_B, nombre: 'Lola Ajena', nif: 'B99999999', direccion: 'Calle Ajena 9', telefono: null },
    ],
    obras: [
      // «el baño de Unai»: el nombre de la obra NO lleva a Unai; solo su cliente.
      { id: IDS.obraBanoUnai, business_id: NEGOCIO_A, nombre: 'Reforma baño completo', direccion: 'Calle Unai 4, Irún', estado: 'en_curso', cliente_id: IDS.clienteUnai, created_at: '2026-05-01T10:00:00Z' },
      { id: IDS.obraPaqui, business_id: NEGOCIO_A, nombre: 'Reforma Paqui', direccion: 'Calle Mayor 1, Irún', estado: 'en_curso', cliente_id: IDS.clientePaqui, created_at: '2026-04-01T10:00:00Z' },
      { id: IDS.obraOlabide9, business_id: NEGOCIO_A, nombre: 'Obra Olabide 9', direccion: 'Olabide 9, Ondarribia', estado: 'en_curso', cliente_id: null, created_at: '2026-04-02T10:00:00Z' },
      { id: IDS.obraOlabide12, business_id: NEGOCIO_A, nombre: 'Obra Olabide 12', direccion: 'Olabide 12, Ondarribia', estado: 'abierta', cliente_id: null, created_at: '2026-04-03T10:00:00Z' },
      // Dos obras con «baño» (la frase «la obra del baño» es ambigua a propósito).
      { id: IDS.obraBanoNorte, business_id: NEGOCIO_A, nombre: 'Reforma baño Norte', direccion: 'Calle Norte 2', estado: 'abierta', cliente_id: null, created_at: '2026-04-04T10:00:00Z' },
      { id: IDS.obraBanoSur, business_id: NEGOCIO_A, nombre: 'Reforma baño Sur', direccion: 'Calle Sur 3', estado: 'abierta', cliente_id: null, created_at: '2026-04-05T10:00:00Z' },
      { id: IDS.obraMikelEtxeberria, business_id: NEGOCIO_A, nombre: 'Reforma baño Mikel Etxeberria', direccion: 'Calle Mikel 3, Irún', estado: 'en_curso', cliente_id: IDS.clienteMikelEtxeberria, created_at: '2026-04-06T10:00:00Z' },
      // Leire: su obra lleva «cocina»; otra obra abierta SIN cliente también (palabra suelta que no debe ganar).
      { id: IDS.obraLeire, business_id: NEGOCIO_A, nombre: 'Reforma cocina Leire Ugarte', direccion: 'Calle Leire 7, Irún', estado: 'en_curso', cliente_id: IDS.clienteLeire, created_at: '2026-04-07T10:00:00Z' },
      { id: IDS.obraCocinaAjena, business_id: NEGOCIO_A, nombre: 'Cocina Zarautz', direccion: 'Zarautz 3', estado: 'abierta', cliente_id: null, created_at: '2026-04-08T10:00:00Z' },
      // Obra CERRADA: se puede consultar, no escribir.
      { id: IDS.obraTerrazaAmaia, business_id: NEGOCIO_A, nombre: 'Reforma terraza Amaia', direccion: 'Calle Amaia 5', estado: 'cerrada', cliente_id: IDS.clienteAmaiaEtxeberria, created_at: '2026-01-10T10:00:00Z' },
      { id: IDS.obraPaquiAjena, business_id: NEGOCIO_B, nombre: 'Reforma Paqui', direccion: 'Otra calle 5', estado: 'en_curso', cliente_id: null, created_at: '2026-04-01T10:00:00Z' },
    ],
    operarios: [
      { id: IDS.operarioJon, business_id: NEGOCIO_A, nombre: 'Jon Arrieta', activo: true },
      { id: IDS.operarioAitor, business_id: NEGOCIO_A, nombre: 'Aitor Gómez', activo: true },
      { id: IDS.operarioIker, business_id: NEGOCIO_A, nombre: 'Iker Etxeberria', activo: true },
      { id: IDS.operarioMikelGoni, business_id: NEGOCIO_A, nombre: 'Mikel Goñi', activo: true },
      { id: IDS.operarioMikelRuiz, business_id: NEGOCIO_A, nombre: 'Mikel Ruiz', activo: true },
    ],
    presupuestos: [
      { id: IDS.presupuesto7, business_id: NEGOCIO_A, numero_presupuesto: 7, cliente_nombre: 'Paqui', cliente_id: IDS.clientePaqui, obra_id: IDS.obraPaqui, estado: 'aceptado', importe_total: 8871, fecha: '2026-04-10', created_at: '2026-04-10T10:00:00Z', presupuesto_generado: TEXTO_PRESUPUESTO },
      { id: IDS.presupuestoGarciaNorte, business_id: NEGOCIO_A, numero_presupuesto: 8, cliente_nombre: 'García Norte', cliente_id: IDS.clienteGarciaNorte, obra_id: null, estado: 'aceptado', importe_total: 1200, fecha: '2026-04-12', created_at: '2026-04-12T10:00:00Z', presupuesto_generado: '' },
      { id: IDS.presupuestoGarciaSur, business_id: NEGOCIO_A, numero_presupuesto: 9, cliente_nombre: 'García Sur', cliente_id: IDS.clienteGarciaSur, obra_id: null, estado: 'aceptado', importe_total: 3400, fecha: '2026-04-14', created_at: '2026-04-14T10:00:00Z', presupuesto_generado: '' },
      // Nº 10: dictado y guardado como «borrador» (así lo deja el dictado); nº 11: de Ainhoa (SIN NIF), aceptado, con partidas trampa.
      { id: IDS.presupuestoMikelBorrador, business_id: NEGOCIO_A, numero_presupuesto: 10, cliente_nombre: 'Mikel Etxeberria', cliente_id: IDS.clienteMikelEtxeberria, obra_id: IDS.obraMikelEtxeberria, estado: 'borrador', importe_total: 907.5, fecha: '2026-10-05', created_at: '2026-10-05T10:00:00Z', presupuesto_generado: TEXTO_PRESUPUESTO_MIKEL },
      { id: IDS.presupuestoAinhoaPendiente, business_id: NEGOCIO_A, numero_presupuesto: 11, cliente_nombre: 'Ainhoa Etxeberria', cliente_id: IDS.clienteAinhoaEtxeberria, obra_id: null, estado: 'aceptado', importe_total: 2141.7, fecha: '2026-10-05', created_at: '2026-10-05T11:00:00Z', presupuesto_generado: TEXTO_PRESUPUESTO_TRAMPA },
      // Mismo número 7 en OTRO negocio: nunca debe resolverse desde el negocio A.
      { id: IDS.presupuesto7Ajeno, business_id: NEGOCIO_B, numero_presupuesto: 7, cliente_nombre: 'Lola Ajena', cliente_id: 'cli-b-lola', obra_id: null, estado: 'aceptado', importe_total: 500, fecha: '2026-04-10', created_at: '2026-04-10T10:00:00Z', presupuesto_generado: '' },
    ],
    facturas: [
      { id: IDS.factura3, business_id: NEGOCIO_A, numero_factura: 3, cliente_nombre: 'Paqui', total: 1000, estado: 'pendiente', presupuesto_id: null },
      { id: IDS.factura3Ajena, business_id: NEGOCIO_B, numero_factura: 3, cliente_nombre: 'Lola Ajena', total: 50, estado: 'pendiente', presupuesto_id: null },
    ],
    presupuesto_borrador: [
      { id: 'bor-1', business_id: NEGOCIO_A, user_id: USUARIO, estado: 'en_construccion', cliente_nombre: 'Paqui', cliente_id: IDS.clientePaqui, obra_id: null, iva_porcentaje: 21, created_at: '2026-10-06T09:00:00Z' },
    ],
    presupuesto_borrador_items: [],
    presupuesto_previews: [],
    agenda: [
      { id: 'ev-olabide', business_id: NEGOCIO_A, titulo: 'Visita obra Olabide', fecha: '2026-10-14', hora: '10:30' },
      { id: 'ev-ane-lasa', business_id: NEGOCIO_A, titulo: 'Visita con Ane Lasa', fecha: '2026-10-20', hora: '09:00' },
      { id: 'ev-mikel', business_id: NEGOCIO_A, titulo: 'Cita con Mikel Etxeberria', fecha: '2026-10-13', hora: '10:30' },
    ],
    memoria_negocio: [],
    diario_obra: [],
    registros_jornada: [],
    albaranes: [
      // El albarán nº 12 de Paqui (A) y OTRO nº 12 en el negocio B: nunca deben confundirse.
      { id: IDS.albaran12, business_id: NEGOCIO_A, numero_albaran: 12, cliente_nombre: 'Paqui', cliente_id: IDS.clientePaqui, obra_id: IDS.obraPaqui, total: 1210, estado: 'entregado', descripcion_trabajos: 'Cambio de plato de ducha', lineas: null, created_at: '2026-10-01T10:00:00Z' },
      { id: IDS.albaran12Ajeno, business_id: NEGOCIO_B, numero_albaran: 12, cliente_nombre: 'Lola Ajena', cliente_id: 'cli-b-lola', obra_id: null, total: 90, estado: 'entregado', descripcion_trabajos: 'Arreglo', lineas: null, created_at: '2026-10-01T10:00:00Z' },
      { id: IDS.albaran14Facturado, business_id: NEGOCIO_A, numero_albaran: 14, cliente_nombre: 'García Sur', cliente_id: IDS.clienteGarciaSur, obra_id: null, total: 300, estado: 'facturado', descripcion_trabajos: 'Pintura', lineas: null, created_at: '2026-09-20T10:00:00Z' },
    ],
    proveedores: [{ id: IDS.proveedorMaderas, business_id: NEGOCIO_A, nombre: 'Maderas Oria', nif: null, telefono: '943 222 333', email: null }, { id: IDS.proveedorSaltoki, business_id: NEGOCIO_A, nombre: 'Saltoki', nif: null, telefono: '943 111 222', email: null }],
    gastos: [],
    tarifas: [],
  };
}
