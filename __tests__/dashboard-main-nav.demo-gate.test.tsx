/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';

const demoState = { value: false };

jest.mock('@/lib/use-demo-tenant', () => ({
  useDemoTenant: () => demoState.value,
}));

function renderNav() {
  return render(
    <AgentSidebarProvider>
      <DashboardMainNav
        brand={<span>Marca</span>}
        menuMovilAbierto={false}
        setMenuMovilAbierto={() => {}}
        active={null}
        desktopTrailing={<span>trail</span>}
        mobileDrawerFooter={null}
      />
    </AgentSidebarProvider>
  );
}

describe('DashboardMainNav y el tenant demo', () => {
  afterEach(() => {
    demoState.value = false;
  });

  it('mantiene el nav superior de Pino cuando no es el tenant demo', () => {
    demoState.value = false;
    renderNav();
    const navs = screen.getAllByRole('navigation', { name: 'Secciones' });
    expect(navs[0]).toHaveTextContent('Obras');
    expect(navs[0]).toHaveTextContent('Operarios');
    expect(navs[0]).toHaveTextContent('Diario');
    expect(screen.getByRole('button', { name: 'Más' })).toBeInTheDocument();
  });

  it('oculta el nav superior en el tenant demo', () => {
    demoState.value = true;
    renderNav();
    expect(screen.queryByRole('navigation', { name: 'Secciones' })).not.toBeInTheDocument();
    expect(screen.queryByText('Marca')).not.toBeInTheDocument();
  });
});
