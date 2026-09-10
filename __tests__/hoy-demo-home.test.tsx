/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HoyDemoHome from '@/components/dashboard/hoy-demo-home';

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

describe('HoyDemoHome', () => {
  it('muestra tres cards y el CTA del presupuesto', () => {
    render(
      <HoyDemoHome
        loading={false}
        clientes={[
          { id: 'c1', nombre: 'Ainhoa Etxeberria' },
          { id: 'c2', nombre: 'Iker Agirre' },
        ]}
        obra={{
          id: 'obra-1',
          nombre: 'Reforma piso',
          cliente_nombre: 'Ainhoa Etxeberria',
          estado: 'abierta',
          direccion: 'Calle Beraun 14, 3º B, 20100 Errenteria',
        }}
        presupuesto={{
          id: 'pre-1',
          estado: 'pendiente',
          obra_id: 'obra-1',
          importe_total: 11803.55,
          cliente_nombre: 'Ainhoa Etxeberria',
          presupuesto_generado: SEED_PRESUPUESTO,
        }}
        cta={{ href: '/presupuestos?id=pre-1', label: 'Presupuesto de esta obra' }}
      />
    );

    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Obra en curso')).toBeInTheDocument();
    expect(screen.getByText('Presupuesto pendiente')).toBeInTheDocument();
    expect(screen.getByText('Ainhoa Etxeberria', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reforma piso' })).toBeInTheDocument();
    expect(screen.getByText('Calle Beraun 14, 3º B, 20100 Errenteria')).toBeInTheDocument();
    expect(screen.getByText('Abierta')).toBeInTheDocument();
    expect(screen.getByText('Calle Beraun · Errenteria')).toBeInTheDocument();
    expect(screen.getByText('Demolición')).toBeInTheDocument();
    expect(screen.getByText('Fontanería')).toBeInTheDocument();
    expect(screen.getByText('Electricidad')).toBeInTheDocument();
    expect(screen.getByText('Pintura')).toBeInTheDocument();
    expect(screen.getByText('Cocina y acabados')).toBeInTheDocument();
    expect(screen.getByText('Limpieza')).toBeInTheDocument();
    expect(screen.getByText(/Total/)).toBeInTheDocument();
    expect(screen.getByText(/11[.\s]?803,55/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Presupuesto de esta obra/i })).toHaveAttribute(
      'href',
      '/presupuestos?id=pre-1'
    );
    expect(screen.queryByText(/0 clientes/i)).not.toBeInTheDocument();
  });
});
