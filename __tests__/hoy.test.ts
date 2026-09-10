import { ctaHoy, lineaCalleBarrio, partidasVisiblesHoy, pickHoy, pickObraHoy, pickPresupuestoHoy } from '@/lib/hoy';

const obraReforma = {
  id: 'obra-1',
  nombre: 'Reforma piso',
  cliente_nombre: 'Ainhoa Etxeberria',
  estado: 'abierta',
  direccion: 'Calle Beraun, Errenteria',
};

const obraOtra = {
  id: 'obra-2',
  nombre: 'Local comercial',
  cliente_nombre: 'Iker Agirre',
  estado: 'abierta',
};

const presPendiente = {
  id: 'pre-1',
  estado: 'pendiente',
  obra_id: 'obra-1',
  importe_total: 11803.55,
};

const SEED_PRESUPUESTO = [
  'PRESUPUESTO PARA Ainhoa Etxeberria',
  '',
  'CAPÍTULO DEMOLICIÓN',
  '1. Demolición de tabiquería y alicatados de baño y cocina | Cantidad: 25 | Precio: 35,00 € | Importe: 875,00 €',
  'TOTAL DEMOLICIÓN: 875,00 €',
  'CAPÍTULO FONTANERÍA',
  '2. Renovación de fontanería de baño (sanitarios, desagües y tomas) | Cantidad: 1 | Precio: 1.850,00 € | Importe: 1.850,00 €',
  'TOTAL FONTANERÍA: 1.850,00 €',
  'CAPÍTULO ELECTRICIDAD',
  '3. Cuadro eléctrico, puntos de luz y tomas en vivienda | Cantidad: 1 | Precio: 1.420,00 € | Importe: 1.420,00 €',
  'TOTAL ELECTRICIDAD: 1.420,00 €',
  'CAPÍTULO PINTURA',
  '4. Pintura lisa de paredes y techos | Cantidad: 85 | Precio: 18,00 € | Importe: 1.530,00 €',
  'TOTAL PINTURA: 1.530,00 €',
  'CAPÍTULO COCINA Y ACABADOS',
  '5. Mobiliario de cocina, encimera y zócalos | Cantidad: 1 | Precio: 3.800,00 € | Importe: 3.800,00 €',
  'TOTAL COCINA Y ACABADOS: 3.800,00 €',
  'CAPÍTULO LIMPIEZA',
  '6. Limpieza final de obra | Cantidad: 1 | Precio: 280,00 € | Importe: 280,00 €',
  'TOTAL LIMPIEZA: 280,00 €',
  'BASE IMPONIBLE: 9.755,00 € | IVA (21%): 2.048,55 € | TOTAL: 11.803,55 €',
].join('\n');

describe('pickHoy', () => {
  it('prefiere la obra Reforma piso y el presupuesto pendiente', () => {
    const hoy = pickHoy([obraOtra, obraReforma], [
      { id: 'pre-x', estado: 'aceptado', obra_id: 'obra-2' },
      presPendiente,
    ]);
    expect(hoy.obra?.id).toBe('obra-1');
    expect(hoy.presupuesto?.id).toBe('pre-1');
    expect(hoy.cta).toEqual({
      href: '/presupuestos?id=pre-1',
      label: 'Presupuesto de esta obra',
    });
  });

  it('ignora obras cerradas', () => {
    expect(pickObraHoy([{ ...obraReforma, estado: 'cerrada' }])).toBeNull();
  });

  it('si no hay presupuesto, el CTA abre la ficha de obra', () => {
    expect(ctaHoy(obraReforma, null)).toEqual({
      href: `/obras?id=${obraReforma.id}`,
      label: 'Ver ficha de la obra',
    });
    expect(pickPresupuestoHoy(obraReforma, [])).toBeNull();
  });

  it('en borrador el CTA es seguir el presupuesto', () => {
    expect(
      ctaHoy(obraReforma, { id: 'pre-b', estado: 'borrador', obra_id: 'obra-1' })?.label
    ).toBe('Seguir el presupuesto');
  });
});

describe('lineaCalleBarrio', () => {
  it('extrae calle y pueblo del seed de la obra', () => {
    expect(lineaCalleBarrio('Calle Beraun 14, 3º B, 20100 Errenteria')).toBe(
      'Calle Beraun · Errenteria'
    );
  });

  it('acepta una dirección ya corta', () => {
    expect(lineaCalleBarrio('Calle Beraun, Errenteria')).toBe('Calle Beraun · Errenteria');
  });

  it('devuelve null si no hay dirección', () => {
    expect(lineaCalleBarrio(null)).toBeNull();
    expect(lineaCalleBarrio('  ')).toBeNull();
  });
});

describe('partidasVisiblesHoy', () => {
  it('saca las 6 partidas del seed con etiqueta corta', () => {
    const partidas = partidasVisiblesHoy(SEED_PRESUPUESTO, 6);
    expect(partidas.map((p) => p.concepto)).toEqual([
      'Demolición',
      'Fontanería',
      'Electricidad',
      'Pintura',
      'Cocina y acabados',
      'Limpieza',
    ]);
    expect(partidas[0]?.importe).toBe(875);
    expect(partidas[5]?.importe).toBe(280);
  });

  it('respeta el máximo y el vacío', () => {
    expect(partidasVisiblesHoy(SEED_PRESUPUESTO, 4)).toHaveLength(4);
    expect(partidasVisiblesHoy('', 6)).toEqual([]);
  });
});
