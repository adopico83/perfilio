/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HoyHome from '@/components/dashboard/hoy-home';

describe('HoyHome', () => {
  it('muestra obra, presupuesto pendiente y el CTA principal', () => {
    render(
      <HoyHome
        loading={false}
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

    expect(screen.getByRole('heading', { name: 'Reforma piso' })).toBeInTheDocument();
    expect(screen.getByText(/Ainhoa Etxeberria/)).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de OK/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Presupuesto de esta obra/i });
    expect(cta).toHaveAttribute('href', '/presupuestos?id=pre-1');
  });

  it('no grita si no hay obra abierta', () => {
    render(<HoyHome loading={false} obra={null} presupuesto={null} cta={null} />);
    expect(screen.getByText(/Sin obra abierta ahora mismo/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 clientes/i)).not.toBeInTheDocument();
  });
});
