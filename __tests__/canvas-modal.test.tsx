/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { CanvasProvider, useCanvas } from '@/contexts/canvas-context';
import CanvasModal from '@/components/dashboard/canvas-modal';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function AbrirPresupuestosEjemplo() {
  const { abrirCanvas } = useCanvas();
  useEffect(() => {
    abrirCanvas(
      'presupuestos',
      [
        {
          id: 'uuid-1',
          cliente: 'Acme SL',
          importe_total: 99.5,
          estado: 'pendiente',
          fecha: '2026-03-01',
        },
      ],
      'Últimos presupuestos'
    );
  }, [abrirCanvas]);
  return <CanvasModal />;
}

describe('CanvasModal', () => {
  it('renderiza correctamente con tipo presupuestos', async () => {
    render(
      <CanvasProvider>
        <AbrirPresupuestosEjemplo />
      </CanvasProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Últimos presupuestos')).toBeInTheDocument();
    expect(screen.getByText('Acme SL')).toBeInTheDocument();
    expect(screen.getByText('99.50 €')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });
});
