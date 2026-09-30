/** Empresa, clientes y obras del mock demo (Orbegozo Dekorazio, Bizkaia). Todo ficticio. */
import type { DemoCliente, DemoEmpresa } from './types';

/**
 * Todos los teléfonos del mock son FICTICIOS (944 00 00 0x): no son móviles ni números reales.
 */
export const DEMO_BUSINESS_ID = 'demo-business';

export const DEMO_EMPRESA: DemoEmpresa = {
  nombre: 'Orbegozo Dekorazio',
  ciudad: 'Getxo (Bizkaia)',
  direccion: 'Avenida Algorta 12, 48990 Getxo',
  telefono: '944 00 00 00',
  email: 'hola@orbegozo-dekorazio.example.com',
};

export const DEMO_CLIENTES: DemoCliente[] = [
  {
    id: 'demo-cliente-1',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Nerea Urrutia',
    telefono: '944 00 00 01',
    email: 'nerea.urrutia@example.com',
    direccion: 'Calle Euskal Herria 12, 4º izda, 48992 Getxo',
    nif: null,
    notas: 'Reforma integral del piso de Algorta. Prefiere que la llamemos por las tardes.',
  },
  {
    id: 'demo-cliente-2',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Jon Arrieta',
    telefono: '944 00 00 02',
    email: 'jon.arrieta@example.com',
    direccion: 'Calle Lehendakari Aguirre 45, 2º B, 48014 Bilbao',
    nif: null,
    notas: 'Baño de Deusto. Entrega de llaves acordada con él.',
  },
  {
    id: 'demo-cliente-3',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Maite Zubizarreta',
    telefono: '944 00 00 03',
    email: 'maite.zubizarreta@example.com',
    direccion: 'Calle Portu 18, 3º A, 48901 Barakaldo',
    nif: null,
    notas: 'Cocina de Barakaldo. Anticipo del 30 % pendiente de cobro.',
  },
  {
    id: 'demo-cliente-4',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Kafetegi Berria S.L.',
    telefono: '944 00 00 04',
    email: 'administracion@example.com',
    direccion: 'Artekale 7, bajo, 48200 Durango',
    nif: null,
    notas: 'Adecuación de local como cafetería. Contacto: administración.',
  },
  {
    id: 'demo-cliente-5',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Leire Olabarria',
    telefono: '944 00 00 05',
    email: 'leire.olabarria@example.com',
    direccion: 'Avenida Iparraguirre 60, 1º C, 48940 Leioa',
    nif: null,
    notas: 'Obra pausada a la espera de la encimera de cuarzo.',
  },
  {
    id: 'demo-cliente-6',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Garazi Etxebarria',
    telefono: '944 00 00 06',
    email: 'garazi.etxebarria@example.com',
    direccion: 'Calle Nagusia 21, 2º D, 48970 Basauri',
    nif: null,
    notas: 'Baño terminado y facturado. Muy satisfecha con el resultado.',
  },
  {
    id: 'demo-cliente-7',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Iñigo Larrea',
    telefono: '944 00 00 07',
    email: 'inigo.larrea@example.com',
    direccion: 'Calle Mendialde 9, 2º A, 48640 Sopela',
    nif: null,
    notas: 'Presupuesto en borrador para cambiar la bañera por un plato de ducha.',
  },
  {
    id: 'demo-cliente-8',
    business_id: DEMO_BUSINESS_ID,
    nombre: 'Aitor Elorriaga',
    telefono: '944 00 00 08',
    email: 'aitor.elorriaga@example.com',
    direccion: 'Calle Kalezar 14, 1º, 48960 Galdakao',
    nif: null,
    notas: 'Pendiente de visita técnica para valorar una reforma de cocina.',
  },
];

export type DemoObraBase = {
  id: string;
  nombre: string;
  clienteId: string;
  direccion: string;
  estado: 'abierta' | 'en_curso' | 'pausada' | 'cerrada';
  avance: number;
  responsable: string;
  /** Offsets en días respecto a hoy. */
  inicio: number;
  fin: number;
  detalle: string;
};

/** La primera es la obra destacada (la que elige pickHoy en la home). */
export const DEMO_OBRAS_BASE: DemoObraBase[] = [
  {
    id: 'demo-obra-1',
    nombre: 'Reforma integral piso Algorta',
    clienteId: 'demo-cliente-1',
    direccion: 'Calle Euskal Herria 12, 4º izda, 48992 Getxo',
    estado: 'en_curso',
    avance: 60,
    responsable: 'Unai G. (jefe de obra)',
    inicio: -38,
    fin: 24,
    detalle:
      'Reforma completa de vivienda de 90 m²: demolición, instalaciones nuevas, pladur, alicatado de cocina y baño, carpintería interior y pintura.',
  },
  {
    id: 'demo-obra-2',
    nombre: 'Reforma baño Deusto',
    clienteId: 'demo-cliente-2',
    direccion: 'Calle Lehendakari Aguirre 45, 2º B, 48014 Bilbao',
    estado: 'en_curso',
    avance: 80,
    responsable: 'Ane M. (jefa de obra)',
    inicio: -12,
    fin: 5,
    detalle: 'Cambio de bañera por ducha, alicatado nuevo y mueble de lavabo. Pendiente de remates y entrega de llaves.',
  },
  {
    id: 'demo-obra-3',
    nombre: 'Cocina Barakaldo',
    clienteId: 'demo-cliente-3',
    direccion: 'Calle Portu 18, 3º A, 48901 Barakaldo',
    estado: 'en_curso',
    avance: 35,
    responsable: 'Unai G. (jefe de obra)',
    inicio: -9,
    fin: 16,
    detalle: 'Cocina nueva con muebles a medida y encimera de cuarzo. Desmontaje terminado y ayudas de fontanería en marcha.',
  },
  {
    id: 'demo-obra-4',
    nombre: 'Adecuación local cafetería Durango',
    clienteId: 'demo-cliente-4',
    direccion: 'Artekale 7, bajo, 48200 Durango',
    estado: 'abierta',
    avance: 10,
    responsable: 'Ane M. (jefa de obra)',
    inicio: -3,
    fin: 40,
    detalle: 'Adecuación de local comercial como cafetería: demolición de tabiquería, aseos accesibles, instalaciones y acabados.',
  },
  {
    id: 'demo-obra-5',
    nombre: 'Baño y cocina Leioa',
    clienteId: 'demo-cliente-5',
    direccion: 'Avenida Iparraguirre 60, 1º C, 48940 Leioa',
    estado: 'pausada',
    avance: 45,
    responsable: 'Unai G. (jefe de obra)',
    inicio: -30,
    fin: 20,
    detalle: 'Obra pausada a la espera de la encimera de cuarzo. Baño avanzado; cocina pendiente de encimera y remates.',
  },
  {
    id: 'demo-obra-6',
    nombre: 'Reforma baño Basauri',
    clienteId: 'demo-cliente-6',
    direccion: 'Calle Nagusia 21, 2º D, 48970 Basauri',
    estado: 'cerrada',
    avance: 100,
    responsable: 'Ane M. (jefa de obra)',
    inicio: -60,
    fin: -20,
    detalle: 'Reforma completa de baño terminada, entregada y facturada.',
  },
];

export function descripcionObra(o: DemoObraBase): string {
  return `Avance ${o.avance} % · Responsable: ${o.responsable} · ${o.detalle}`;
}
