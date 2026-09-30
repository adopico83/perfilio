/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import DiarioPage from '@/app/diario/page';

const mockSession = { businessName: 'Reformas Demo Errenteria' };
const mockFrom = jest.fn();
const mockCreateClient = jest.fn();
const mockFetch = jest.fn();
const mockGetBusinessId = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'b1', businessName: mockSession.businessName, user: null }),
}));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('@/lib/supabase/get-business-id', () => ({
  getBusinessIdClient: (...args: unknown[]) => mockGetBusinessId(...args),
}));
jest.mock('@/contexts/obra-modal-context', () => ({
  useObraModal: () => ({ abrirObra: jest.fn() }),
}));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/dashboard-main-nav', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/diario-entrada-modal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/diario-entrada-delete-dialog', () => ({
  __esModule: true,
  default: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.businessName = 'Reformas Demo Errenteria';
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFrom.mockImplementation(() => {
    throw new Error('Supabase no debe consultarse en demo');
  });
  mockCreateClient.mockImplementation(() => {
    throw new Error('createClient no debe llamarse en demo');
  });
  mockGetBusinessId.mockImplementation(() => {
    throw new Error('getBusinessIdClient no debe llamarse en demo');
  });
  mockFetch.mockImplementation(() => {
    throw new Error('fetch no debe llamarse en demo');
  });
});

describe('DiarioPage con el mock demo', () => {
  it('pinta las obras del diario del mock sin llamar a Supabase ni a fetch', async () => {
    render(<DiarioPage />);

    await waitFor(() => expect(screen.getAllByText('Reforma integral piso Algorta').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Reforma baño Deusto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cocina Barakaldo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Adecuación local cafetería Durango').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Aún no hay entradas/)).not.toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockGetBusinessId).not.toHaveBeenCalled();
  });

  it('un tenant que no es la demo sigue cargando el diario desde la API', async () => {
    mockSession.businessName = 'Otro negocio S.L.';
    mockGetBusinessId.mockReset();
    mockGetBusinessId.mockResolvedValue('b-real');
    const maybeSingle = jest.fn().mockResolvedValue({ data: { nombre: 'Otro negocio S.L.' } });
    mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ agrupado_por_obra: {} }) });

    render(<DiarioPage />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/diario?business_id=b-real', { credentials: 'include' })
    );
    expect(mockGetBusinessId).toHaveBeenCalled();
  });
});
