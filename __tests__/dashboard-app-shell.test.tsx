/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { DASHBOARD_NAV_ITEMS, activeDashboardNavKey } from '@/components/dashboard/dashboard-nav';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';

let mockPathname = '/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({
    user: { id: 'u1' },
    businessId: 'b1',
    businessName: 'Pino Albañilería',
    loading: false,
    isAuthenticated: true,
    isInitialized: true,
    hasTimeoutError: false,
  }),
}));

jest.mock('@/components/dashboard/agent-sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-panel">panel agente</div>,
}));

jest.mock('@/app/dashboard/logout-button', () => ({
  __esModule: true,
  default: () => <button type="button">Cerrar Sesión</button>,
}));

function renderShell() {
  return render(
    <AgentSidebarProvider>
      <DashboardShell>
        <p>contenido dashboard</p>
      </DashboardShell>
    </AgentSidebarProvider>
  );
}

describe('DashboardShell', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
  });

  it('muestra el sidebar con los mismos destinos que el top nav y el logo de Pino', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    for (const item of DASHBOARD_NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.href);
      expect(nav).toContainElement(link);
    }
    expect(nav).toHaveTextContent('Agente IA');
    expect(screen.getByText('PINO')).toBeInTheDocument();
    expect(screen.getByText('ALBAÑILERÍA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar Sesión' })).toBeInTheDocument();
    expect(screen.getByText('contenido dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más' })).not.toBeInTheDocument();
  });

  it('marca la sección activa según la ruta', () => {
    mockPathname = '/presupuestos';
    renderShell();
    expect(screen.getByRole('link', { name: 'Presupuestos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Albaranes' })).not.toHaveAttribute('aria-current');
  });
});

describe('activeDashboardNavKey', () => {
  it('resuelve la sección y no inventa rutas', () => {
    expect(activeDashboardNavKey('/dashboard')).toBeNull();
    expect(activeDashboardNavKey('/clientes/abc')).toBe('clientes');
    expect(activeDashboardNavKey('/gastos')).toBe('gastos');
    expect(DASHBOARD_NAV_ITEMS.map((i) => i.href)).toEqual([
      '/mensajes',
      '/presupuestos',
      '/albaranes',
      '/facturas',
      '/gastos',
      '/diario',
      '/obras',
      '/clientes',
      '/operarios',
    ]);
  });
});
