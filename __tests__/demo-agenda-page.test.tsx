/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import AgendaPage from '@/app/agenda/page';
import { DEMO_NAV_ITEMS } from '@/components/dashboard/demo-nav';

const mockReplace = jest.fn();
const mockSession = { businessName: 'Reformas Demo Errenteria' };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'b1', businessName: mockSession.businessName, user: null }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.businessName = 'Reformas Demo Errenteria';
});

describe('Agenda de la demo', () => {
  it('el menú tiene «Agenda» justo debajo del Dashboard', () => {
    const labels = DEMO_NAV_ITEMS.map((i) => i.label);
    expect(labels.slice(0, 2)).toEqual(['Dashboard', 'Agenda']);
    const agenda = DEMO_NAV_ITEMS[1];
    expect(agenda.href).toBe('/agenda');
    expect(agenda.match('/agenda')).toBe(true);
    expect(agenda.match('/dashboard')).toBe(false);
  });

  it('pinta el calendario con las citas del mock', () => {
    render(<AgendaPage />);

    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeInTheDocument();
    expect(screen.getAllByText(/Visita de obra/).length).toBeGreaterThan(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('un tenant que no es la demo vuelve al dashboard', () => {
    mockSession.businessName = 'Otro negocio S.L.';
    const { container } = render(<AgendaPage />);
    expect(container).toBeEmptyDOMElement();
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });
});
