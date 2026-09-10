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
  it('renderiza nav izquierda del mock (Dashboard, Clientes, Obras, Presupuestos, Agente IA)', async () => {
    render(
      <AgentSidebarProvider>
        <DemoAppShell businessName="Reformas Demo Errenteria">
          <p>contenido hoy</p>
        </DemoAppShell>
      </AgentSidebarProvider>
    );

    const nav = screen.getByRole('navigation', { name: 'Demo' });
    expect(nav).toHaveTextContent('Dashboard');
    expect(nav).toHaveTextContent('Clientes');
    expect(nav).toHaveTextContent('Obras');
    expect(nav).toHaveTextContent('Presupuestos');
    expect(nav).toHaveTextContent('Agente IA');
    expect(screen.getByText('contenido hoy')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('agent-panel')).not.toBeInTheDocument();
    });
  });
});
