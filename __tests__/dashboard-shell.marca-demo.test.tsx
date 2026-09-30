/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';
import { DEMO_REFORMAS_EMAIL } from '@/lib/demo-tenant';

const sessionState: { email: string; businessName: string } = { email: '', businessName: '' };

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ user: { email: sessionState.email }, businessName: sessionState.businessName }),
}));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
jest.mock('@/components/dashboard/agent-sidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => <button>Salir</button> }));

function renderShell() {
  return render(
    <AgentSidebarProvider>
      <DashboardShell>
        <p>contenido</p>
      </DashboardShell>
    </AgentSidebarProvider>
  );
}

describe('marca Orbegozo solo en la demo', () => {
  it('en la demo la cabecera lleva el logo y «Orbegozo Dekorazio»', () => {
    sessionState.email = DEMO_REFORMAS_EMAIL;
    sessionState.businessName = 'Cualquiera';
    renderShell();
    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Orbegozo Dekorazio');
    expect(header.querySelector('img')?.getAttribute('src')).toContain('orbegozo-logo.png');
  });

  it('fuera de la demo no aparece ni el logo ni el nombre', () => {
    sessionState.email = 'otro@cliente.com';
    sessionState.businessName = 'Fontanería Real';
    const { container } = renderShell();
    expect(container.querySelector('img[src*="orbegozo-logo"]')).toBeNull();
    expect(screen.queryByText('Orbegozo Dekorazio')).toBeNull();
  });
});
