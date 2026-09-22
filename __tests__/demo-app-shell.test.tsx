/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import DemoAppShell from '@/components/dashboard/demo-app-shell';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

jest.mock('@/components/dashboard/agent-sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-panel">panel agente</div>,
}));

jest.mock('@/app/dashboard/logout-button', () => ({
  __esModule: true,
  default: () => <button type="button">Cerrar Sesión</button>,
}));

describe('DemoAppShell', () => {
  it('renderiza nav izquierda con los destinos de Pino y Agente IA', async () => {
    render(
      <AgentSidebarProvider>
        <DemoAppShell businessName="Reformas Demo Errenteria">
          <p>contenido hoy</p>
        </DemoAppShell>
      </AgentSidebarProvider>
    );

    const nav = screen.getByRole('navigation', { name: 'Demo' });
    expect(nav).toHaveTextContent('Dashboard');
    expect(nav).toHaveTextContent('Mensajes');
    expect(nav).toHaveTextContent('Presupuestos');
    expect(nav).toHaveTextContent('Albaranes');
    expect(nav).toHaveTextContent('Facturas');
    expect(nav).toHaveTextContent('Gastos');
    expect(nav).toHaveTextContent('Diario');
    expect(nav).toHaveTextContent('Obras');
    expect(nav).toHaveTextContent('Clientes');
    expect(nav).toHaveTextContent('Operarios');
    expect(nav).toHaveTextContent('Agente IA');
    expect(screen.getByRole('link', { name: 'Mensajes' })).toHaveAttribute('href', '/mensajes');
    expect(screen.getByRole('link', { name: 'Albaranes' })).toHaveAttribute('href', '/albaranes');
    expect(screen.getByRole('link', { name: 'Operarios' })).toHaveAttribute('href', '/operarios');
    expect(screen.getByText('contenido hoy')).toBeInTheDocument();
    const skyline = screen.getAllByTestId('demo-skyline')[0];
    expect(skyline).toBeInTheDocument();
    expect(skyline.querySelector('img')).toHaveAttribute('src', '/demo/skyline-errenteria.png?v=mock');
    expect(skyline.querySelector('svg[viewBox="0 0 240 152"]')).toBeNull();
    expect(screen.getAllByText('Datos seguros y privados').length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(screen.queryByTestId('agent-panel')).not.toBeInTheDocument();
    });
  });
});
