/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import DemoHoyPage from '@/components/dashboard/demo-hoy-page';

const mockSession = { businessName: 'Reformas Demo Errenteria' };
const mockCreateClient = jest.fn();
const mockFetch = jest.fn();

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'b1', businessName: mockSession.businessName, user: null }),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.businessName = 'Reformas Demo Errenteria';
  global.fetch = mockFetch as unknown as typeof fetch;
  mockCreateClient.mockImplementation(() => {
    throw new Error('createClient no debe llamarse en demo');
  });
  mockFetch.mockImplementation(() => {
    throw new Error('fetch no debe llamarse en demo');
  });
});

describe('DemoHoyPage con el mock demo', () => {
  it('pinta la obra destacada, su presupuesto accionable, los clientes y la agenda', async () => {
    render(<DemoHoyPage />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Reforma integral piso Algorta' })).toBeInTheDocument()
    );
    expect(screen.getByRole('link', { name: /Presupuesto de esta obra/i })).toHaveAttribute(
      'href',
      '/presupuestos?id=demo-presupuesto-2'
    );
    expect(screen.getByText('Nerea Urrutia', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText('Jon Arrieta', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/Visita de obra · Reforma integral piso Algorta/)).toBeInTheDocument();
    // Card de importe total: suma de las bases de los 8 presupuestos.
    expect(screen.getByText(/109\.?440,00/)).toBeInTheDocument();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un tenant que no es la demo sigue consultando Supabase', async () => {
    mockSession.businessName = 'Otro negocio S.L.';
    mockCreateClient.mockReset();
    // Query builder encadenable que siempre resuelve sin filas.
    const builder: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
          : () => builder,
      apply: () => builder,
    });
    mockCreateClient.mockImplementation(() => ({ from: () => builder }));

    render(<DemoHoyPage />);

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Reforma integral piso Algorta' })).not.toBeInTheDocument();
  });
});
