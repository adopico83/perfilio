/** Presupuestos, facturas y albaranes del mock demo. Importes cuadrados al céntimo. */
import { DEMO_BUSINESS_ID, DEMO_CLIENTES, DEMO_OBRAS_BASE } from './orbegozo-base';
import { demoFecha, demoTimestamp } from './fechas';
import {
  baseCent,
  generarTextoPresupuesto,
  importePartidaCent,
  ivaCent,
  totalCapituloCent,
  type DemoCapitulo,
} from './presupuesto-texto';
import type { DemoAlbaran, DemoFactura, DemoLineaDocumento, DemoPresupuesto } from './types';

const cliente = (id: string) => DEMO_CLIENTES.find((c) => c.id === id)!;
const obra = (id: string) => DEMO_OBRAS_BASE.find((o) => o.id === id)!;
const eur = (centimos: number) => centimos / 100;

type PresupuestoDef = {
  id: string;
  numero: number;
  obraId: string | null;
  clienteId: string;
  estado: string;
  offset: number;
  capitulos: DemoCapitulo[];
};

const P1: DemoCapitulo[] = [
  {
    nombre: 'DEMOLICIÓN',
    partidas: [
      { concepto: 'Demolición de tabiquería y alicatados (m²)', cantidad: 62, precio: 30 },
      { concepto: 'Retirada de escombros y transporte a vertedero', cantidad: 1, precio: 1150 },
    ],
  },
  {
    nombre: 'FONTANERÍA',
    partidas: [
      { concepto: 'Renovación de red de fontanería y desagües de baño y cocina', cantidad: 1, precio: 2850 },
      { concepto: 'Sanitarios y grifería de baño', cantidad: 1, precio: 1420 },
    ],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [{ concepto: 'Instalación eléctrica completa con cuadro y mecanismos', cantidad: 1, precio: 3680 }],
  },
  {
    nombre: 'TABIQUERÍA PLADUR',
    partidas: [
      { concepto: 'Tabiques y trasdosados de pladur (m²)', cantidad: 48, precio: 42 },
      { concepto: 'Falso techo de pladur (m²)', cantidad: 30, precio: 34 },
    ],
  },
  {
    nombre: 'ALICATADO',
    partidas: [
      { concepto: 'Alicatado de paredes de baño y cocina (m²)', cantidad: 54, precio: 58 },
      { concepto: 'Solado cerámico en toda la vivienda (m²)', cantidad: 62, precio: 46 },
    ],
  },
  {
    nombre: 'CARPINTERÍA INTERIOR',
    partidas: [
      { concepto: 'Puerta de entrada blindada', cantidad: 1, precio: 1290 },
      { concepto: 'Armario empotrado a medida', cantidad: 1, precio: 1180 },
    ],
  },
  {
    nombre: 'PINTURA',
    partidas: [{ concepto: 'Pintura plástica lisa en paredes y techos (m²)', cantidad: 172, precio: 12.5 }],
  },
  {
    nombre: 'LIMPIEZA',
    partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 250 }],
  },
];

const P2: DemoCapitulo[] = [
  {
    nombre: 'CARPINTERÍA INTERIOR',
    partidas: [
      { concepto: 'Puerta interior lacada en blanco, suministro y colocación', cantidad: 4, precio: 385 },
      { concepto: 'Cerco y rebaje en huecos existentes', cantidad: 4, precio: 90 },
      { concepto: 'Tapajuntas y herrajes de colgar', cantidad: 4, precio: 60 },
    ],
  },
];

const P3: DemoCapitulo[] = [
  {
    nombre: 'DEMOLICIÓN',
    partidas: [{ concepto: 'Demolición de alicatado y sanitarios con retirada de escombros', cantidad: 1, precio: 640 }],
  },
  {
    nombre: 'FONTANERÍA',
    partidas: [
      { concepto: 'Renovación de fontanería y desagües del baño', cantidad: 1, precio: 1380 },
      { concepto: 'Plato de ducha, mampara y grifería termostática', cantidad: 1, precio: 1450 },
    ],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [{ concepto: 'Puntos de luz y mecanismos del baño', cantidad: 1, precio: 540 }],
  },
  {
    nombre: 'ALICATADO',
    partidas: [
      { concepto: 'Alicatado de paredes (m²)', cantidad: 25, precio: 58 },
      { concepto: 'Solado antideslizante (m²)', cantidad: 5, precio: 76 },
    ],
  },
  {
    nombre: 'CARPINTERÍA',
    partidas: [{ concepto: 'Mueble de lavabo con espejo', cantidad: 1, precio: 620 }],
  },
  { nombre: 'PINTURA', partidas: [{ concepto: 'Pintura de techo y paramentos', cantidad: 1, precio: 340 }] },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 180 }] },
];

const P4: DemoCapitulo[] = [
  {
    nombre: 'DEMOLICIÓN',
    partidas: [{ concepto: 'Desmontaje de cocina antigua y picado de alicatado', cantidad: 1, precio: 780 }],
  },
  {
    nombre: 'FONTANERÍA',
    partidas: [{ concepto: 'Nuevas tomas de agua y desagües de cocina', cantidad: 1, precio: 890 }],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [{ concepto: 'Circuitos independientes para campana, horno y encimera', cantidad: 1, precio: 1150 }],
  },
  {
    nombre: 'ALICATADO',
    partidas: [
      { concepto: 'Alicatado de frente de cocina (m²)', cantidad: 16, precio: 55 },
      { concepto: 'Solado porcelánico de gran formato (m²)', cantidad: 10, precio: 85 },
    ],
  },
  {
    nombre: 'MOBILIARIO DE COCINA',
    partidas: [
      { concepto: 'Muebles altos y bajos a medida con montaje', cantidad: 1, precio: 4200 },
      { concepto: 'Encimera de cuarzo con fregadero integrado', cantidad: 1, precio: 1850 },
    ],
  },
  { nombre: 'PINTURA', partidas: [{ concepto: 'Pintura de paredes y techo de cocina', cantidad: 1, precio: 640 }] },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 180 }] },
];

const P5: DemoCapitulo[] = [
  {
    nombre: 'DEMOLICIÓN',
    partidas: [
      { concepto: 'Demolición de tabiquería y retirada de mobiliario del local', cantidad: 1, precio: 2400 },
      { concepto: 'Picado de solado y gestión de residuos (m²)', cantidad: 90, precio: 18 },
    ],
  },
  {
    nombre: 'ALBAÑILERÍA Y TABIQUERÍA',
    partidas: [
      { concepto: 'Nuevos tabiques y trasdosados de pladur (m²)', cantidad: 70, precio: 44 },
      { concepto: 'Falso techo registrable (m²)', cantidad: 85, precio: 32 },
    ],
  },
  {
    nombre: 'FONTANERÍA',
    partidas: [
      { concepto: 'Red de agua y desagües de aseos y office', cantidad: 1, precio: 4900 },
      { concepto: 'Sanitarios y grifería accesibles', cantidad: 1, precio: 2300 },
    ],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [
      { concepto: 'Instalación eléctrica y cuadro general del local', cantidad: 1, precio: 6400 },
      { concepto: 'Iluminación LED y alumbrado de emergencia', cantidad: 1, precio: 3150 },
    ],
  },
  {
    nombre: 'VENTILACIÓN',
    partidas: [{ concepto: 'Ventilación y extracción de barra y office', cantidad: 1, precio: 4800 }],
  },
  {
    nombre: 'SOLADOS',
    partidas: [{ concepto: 'Pavimento porcelánico antideslizante (m²)', cantidad: 90, precio: 52 }],
  },
  {
    nombre: 'PINTURA',
    partidas: [{ concepto: 'Pintura de paramentos del local (m²)', cantidad: 230, precio: 10 }],
  },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 250 }] },
];

const P6: DemoCapitulo[] = [
  { nombre: 'DEMOLICIÓN', partidas: [{ concepto: 'Demolición de baño y cocina', cantidad: 1, precio: 1350 }] },
  {
    nombre: 'FONTANERÍA',
    partidas: [{ concepto: 'Renovación de fontanería de baño y cocina', cantidad: 1, precio: 1980 }],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [{ concepto: 'Instalación eléctrica de baño y cocina', cantidad: 1, precio: 1720 }],
  },
  {
    nombre: 'ALICATADO',
    partidas: [
      { concepto: 'Alicatado de paredes de baño y cocina (m²)', cantidad: 40, precio: 55 },
      { concepto: 'Solado cerámico (m²)', cantidad: 14, precio: 60 },
    ],
  },
  {
    nombre: 'MOBILIARIO DE COCINA',
    partidas: [
      { concepto: 'Muebles de cocina a medida', cantidad: 1, precio: 3600 },
      { concepto: 'Encimera de cuarzo (pendiente de suministro)', cantidad: 1, precio: 1950 },
    ],
  },
  { nombre: 'PINTURA', partidas: [{ concepto: 'Pintura de paredes y techos', cantidad: 1, precio: 1460 }] },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 200 }] },
];

const P7: DemoCapitulo[] = [
  { nombre: 'DEMOLICIÓN', partidas: [{ concepto: 'Demolición de baño y retirada de escombros', cantidad: 1, precio: 580 }] },
  {
    nombre: 'FONTANERÍA',
    partidas: [
      { concepto: 'Renovación de fontanería del baño', cantidad: 1, precio: 1250 },
      { concepto: 'Plato de ducha y mampara', cantidad: 1, precio: 1120 },
    ],
  },
  {
    nombre: 'ALICATADO',
    partidas: [
      { concepto: 'Alicatado de paredes (m²)', cantidad: 24, precio: 55 },
      { concepto: 'Solado del baño', cantidad: 1, precio: 300 },
    ],
  },
  { nombre: 'ELECTRICIDAD', partidas: [{ concepto: 'Puntos de luz y mecanismos', cantidad: 1, precio: 520 }] },
  { nombre: 'PINTURA', partidas: [{ concepto: 'Pintura de baño', cantidad: 1, precio: 330 }] },
  { nombre: 'CARPINTERÍA', partidas: [{ concepto: 'Mueble de lavabo básico', cantidad: 1, precio: 300 }] },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 180 }] },
];

const P8: DemoCapitulo[] = [
  { nombre: 'DEMOLICIÓN', partidas: [{ concepto: 'Retirada de bañera y escombros', cantidad: 1, precio: 250 }] },
  {
    nombre: 'FONTANERÍA',
    partidas: [{ concepto: 'Cambio de bañera por plato de ducha con mampara', cantidad: 1, precio: 1680 }],
  },
  {
    nombre: 'ALICATADO',
    partidas: [{ concepto: 'Alicatado de paredes de ducha y remates (m²)', cantidad: 14, precio: 60 }],
  },
  {
    nombre: 'ELECTRICIDAD',
    partidas: [{ concepto: 'Sustitución de mecanismos y puntos de luz', cantidad: 1, precio: 640 }],
  },
  { nombre: 'PINTURA', partidas: [{ concepto: 'Pintura de baño y pasillo', cantidad: 1, precio: 640 }] },
  { nombre: 'LIMPIEZA', partidas: [{ concepto: 'Limpieza final de obra', cantidad: 1, precio: 200 }] },
];

/** Numeración correlativa por fecha (el más antiguo es el nº 1). */
export const PRESUPUESTOS_DEF: PresupuestoDef[] = [
  { id: 'demo-presupuesto-1', numero: 2, obraId: 'demo-obra-1', clienteId: 'demo-cliente-1', estado: 'aceptado', offset: -44, capitulos: P1 },
  { id: 'demo-presupuesto-2', numero: 6, obraId: 'demo-obra-1', clienteId: 'demo-cliente-1', estado: 'pendiente', offset: -6, capitulos: P2 },
  { id: 'demo-presupuesto-3', numero: 5, obraId: 'demo-obra-2', clienteId: 'demo-cliente-2', estado: 'facturado', offset: -22, capitulos: P3 },
  { id: 'demo-presupuesto-4', numero: 4, obraId: 'demo-obra-3', clienteId: 'demo-cliente-3', estado: 'aceptado', offset: -32, capitulos: P4 },
  { id: 'demo-presupuesto-5', numero: 7, obraId: 'demo-obra-4', clienteId: 'demo-cliente-4', estado: 'pendiente', offset: -4, capitulos: P5 },
  { id: 'demo-presupuesto-6', numero: 3, obraId: 'demo-obra-5', clienteId: 'demo-cliente-5', estado: 'aceptado', offset: -42, capitulos: P6 },
  { id: 'demo-presupuesto-7', numero: 1, obraId: 'demo-obra-6', clienteId: 'demo-cliente-6', estado: 'facturado', offset: -45, capitulos: P7 },
  { id: 'demo-presupuesto-8', numero: 8, obraId: null, clienteId: 'demo-cliente-7', estado: 'borrador', offset: -2, capitulos: P8 },
];

export function construirPresupuestos(now: Date = new Date()): DemoPresupuesto[] {
  return PRESUPUESTOS_DEF.map((d) => {
    const cli = cliente(d.clienteId);
    const base = baseCent(d.capitulos);
    return {
      id: d.id,
      business_id: DEMO_BUSINESS_ID,
      presupuesto_generado: generarTextoPresupuesto(cli.nombre, d.capitulos),
      fecha: demoFecha(d.offset, now),
      estado: d.estado,
      created_at: demoTimestamp(d.offset, '10:00', now),
      obra_id: d.obraId,
      cliente_id: cli.id,
      cliente_nombre: cli.nombre,
      numero_presupuesto: d.numero,
      importe_total: eur(base + ivaCent(base)),
      obras: d.obraId ? { nombre: obra(d.obraId).nombre } : null,
    };
  });
}

function lineasPorCapitulo(capitulos: DemoCapitulo[]): DemoLineaDocumento[] {
  return capitulos.map((c) => ({
    concepto: c.nombre.charAt(0) + c.nombre.slice(1).toLowerCase(),
    cantidad: 1,
    precio: eur(totalCapituloCent(c)),
    importe: eur(totalCapituloCent(c)),
  }));
}

type FacturaDef = {
  id: string;
  numero: string;
  obraId: string;
  presupuestoId: string;
  /** Porcentaje del presupuesto (base) que se factura. */
  porcentaje: number;
  concepto: string;
  estado: 'pagada' | 'pendiente' | 'vencida';
  offset: number;
  vencimiento: number;
};

export const FACTURAS_DEF: FacturaDef[] = [
  { id: 'demo-factura-1', numero: 'F-2026-041', obraId: 'demo-obra-6', presupuestoId: 'demo-presupuesto-7', porcentaje: 100, concepto: 'Reforma completa de baño', estado: 'pagada', offset: -18, vencimiento: -3 },
  { id: 'demo-factura-2', numero: 'F-2026-042', obraId: 'demo-obra-2', presupuestoId: 'demo-presupuesto-3', porcentaje: 100, concepto: 'Reforma completa de baño', estado: 'pendiente', offset: -5, vencimiento: 10 },
  { id: 'demo-factura-3', numero: 'F-2026-043', obraId: 'demo-obra-1', presupuestoId: 'demo-presupuesto-1', porcentaje: 40, concepto: 'Certificación 1 (40 %) de la reforma integral', estado: 'pagada', offset: -25, vencimiento: -10 },
  { id: 'demo-factura-4', numero: 'F-2026-044', obraId: 'demo-obra-1', presupuestoId: 'demo-presupuesto-1', porcentaje: 20, concepto: 'Certificación 2 (20 %) de la reforma integral', estado: 'pendiente', offset: -10, vencimiento: 5 },
  { id: 'demo-factura-5', numero: 'F-2026-045', obraId: 'demo-obra-3', presupuestoId: 'demo-presupuesto-4', porcentaje: 30, concepto: 'Anticipo del 30 % de la cocina', estado: 'vencida', offset: -19, vencimiento: -4 },
  { id: 'demo-factura-6', numero: 'F-2026-046', obraId: 'demo-obra-5', presupuestoId: 'demo-presupuesto-6', porcentaje: 30, concepto: 'Anticipo del 30 % de baño y cocina', estado: 'pendiente', offset: 0, vencimiento: 15 },
];

export function construirFacturas(now: Date = new Date()): DemoFactura[] {
  return FACTURAS_DEF.map((d) => {
    const pres = PRESUPUESTOS_DEF.find((p) => p.id === d.presupuestoId)!;
    const cli = cliente(pres.clienteId);
    const baseTotal = baseCent(pres.capitulos);
    const base = Math.round((baseTotal * d.porcentaje) / 100);
    const iva = ivaCent(base);
    const nombreObra = obra(d.obraId).nombre;
    const lineas: DemoLineaDocumento[] =
      d.porcentaje === 100
        ? lineasPorCapitulo(pres.capitulos)
        : [{ concepto: `${d.concepto} · ${nombreObra}`, cantidad: 1, precio: eur(base), importe: eur(base) }];
    return {
      id: d.id,
      business_id: DEMO_BUSINESS_ID,
      numero_factura: d.numero,
      cliente_nombre: cli.nombre,
      cliente_id: cli.id,
      cliente_direccion: cli.direccion,
      cliente_nif: cli.nif,
      descripcion_trabajos: `${d.concepto} · ${nombreObra}`,
      lineas,
      base_imponible: eur(base),
      iva: eur(iva),
      total: eur(base + iva),
      fecha: demoFecha(d.offset, now),
      fecha_vencimiento: demoFecha(d.vencimiento, now),
      estado: d.estado,
      observaciones: null,
      created_at: demoTimestamp(d.offset, '12:00', now),
      obra_id: d.obraId,
      obras: { nombre: nombreObra },
    };
  });
}

type AlbaranDef = {
  id: string;
  numero: string;
  obraId: string;
  estado: 'pendiente' | 'entregado' | 'facturado';
  offset: number;
  descripcion: string;
  lineas: Array<{ concepto: string; cantidad: number; precio: number }>;
};

export const ALBARANES_DEF: AlbaranDef[] = [
  {
    id: 'demo-albaran-1',
    numero: 'ALB-2026-011',
    obraId: 'demo-obra-1',
    estado: 'entregado',
    offset: -20,
    descripcion: 'Entrega de material de alicatado y solado en obra.',
    lineas: [
      { concepto: 'Azulejo porcelánico 60x60 (m²)', cantidad: 58, precio: 24 },
      { concepto: 'Adhesivo cementoso (saco)', cantidad: 30, precio: 8.5 },
      { concepto: 'Junta y crucetas (lote)', cantidad: 1, precio: 85 },
    ],
  },
  {
    id: 'demo-albaran-2',
    numero: 'ALB-2026-014',
    obraId: 'demo-obra-1',
    estado: 'pendiente',
    offset: -3,
    descripcion: 'Suministro de placas de pladur y perfilería para tabiquería.',
    lineas: [
      { concepto: 'Placa de pladur 13 mm (ud)', cantidad: 90, precio: 6.2 },
      { concepto: 'Perfilería montante y canal (ud)', cantidad: 120, precio: 3.1 },
      { concepto: 'Aislante de lana mineral (m²)', cantidad: 60, precio: 5 },
    ],
  },
  {
    id: 'demo-albaran-3',
    numero: 'ALB-2026-012',
    obraId: 'demo-obra-2',
    estado: 'facturado',
    offset: -8,
    descripcion: 'Sanitarios y grifería del baño entregados en obra.',
    lineas: [
      { concepto: 'Plato de ducha', cantidad: 1, precio: 320 },
      { concepto: 'Mampara de ducha', cantidad: 1, precio: 410 },
      { concepto: 'Grifería termostática', cantidad: 1, precio: 190 },
      { concepto: 'Inodoro y lavabo', cantidad: 1, precio: 280 },
    ],
  },
  {
    id: 'demo-albaran-4',
    numero: 'ALB-2026-013',
    obraId: 'demo-obra-3',
    estado: 'entregado',
    offset: -6,
    descripcion: 'Entrega de muebles de cocina a medida.',
    lineas: [
      { concepto: 'Módulo bajo de cocina (ud)', cantidad: 8, precio: 210 },
      { concepto: 'Módulo alto de cocina (ud)', cantidad: 6, precio: 165 },
      { concepto: 'Tiradores y herrajes (lote)', cantidad: 1, precio: 240 },
    ],
  },
];

export function construirAlbaranes(now: Date = new Date()): DemoAlbaran[] {
  return ALBARANES_DEF.map((d) => {
    const nombreObra = obra(d.obraId).nombre;
    const cli = cliente(obra(d.obraId).clienteId);
    const lineas: DemoLineaDocumento[] = d.lineas.map((l) => ({
      ...l,
      importe: eur(importePartidaCent(l)),
    }));
    const total = d.lineas.reduce((s, l) => s + importePartidaCent(l), 0);
    return {
      id: d.id,
      business_id: DEMO_BUSINESS_ID,
      numero_albaran: d.numero,
      cliente_nombre: cli.nombre,
      cliente_id: cli.id,
      cliente_direccion: cli.direccion,
      descripcion_trabajos: d.descripcion,
      lineas,
      total: eur(total),
      fecha: demoFecha(d.offset, now),
      estado: d.estado,
      observaciones: null,
      created_at: demoTimestamp(d.offset, '11:00', now),
      obra_id: d.obraId,
      obras: { nombre: nombreObra },
    };
  });
}
