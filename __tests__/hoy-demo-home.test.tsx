/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HoyDemoHome from '@/components/dashboard/hoy-demo-home';

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
          direccion: 'Calle Beraun, Errenteria',
        }}
        presupuesto={{
          id: 'pre-1',
          estado: 'pendiente',
          obra_id: 'obra-1',
          importe_total: 11803.55,
        }}
        cta={{ href: '/presupuestos?id=pre-1', label: 'Presupuesto de esta obra' }}
      />
    );

    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Obra en curso')).toBeInTheDocument();
    expect(screen.getByText('Presupuesto pendiente')).toBeInTheDocument();
    expect(screen.getByText('Ainhoa Etxeberria', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reforma piso' })).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de OK/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Presupuesto de esta obra/i })).toHaveAttribute(
      'href',
      '/presupuestos?id=pre-1'
    );
    expect(screen.queryByText(/0 clientes/i)).not.toBeInTheDocument();
  });
});
