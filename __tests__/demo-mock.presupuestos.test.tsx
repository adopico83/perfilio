/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PresupuestosPage from '@/app/presupuestos/page';

const mockSession = { businessName: 'Reformas Demo Errenteria', user: null as { email: string } | null };
const mockFrom = jest.fn();
const mockCreateClient = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({
    businessId: 'b1',
    businessName: mockSession.businessName,
    user: mockSession.user,
  }),
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
jest.mock('@/contexts/obra-modal-context', () => ({
  useObraModal: () => ({ abrirObra: jest.fn() }),
}));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}));
jest.mock('@/components/dashboard/agente-context-chips', () => ({
  __esModule: true,
  default: () => null,
  chipsPresupuesto: () => [],
}));

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('PresupuestosPage con el mock demo', () => {
  it('pinta los presupuestos del mock sin llamar a Supabase ni a fetch', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Supabase no debe consultarse en demo');
    });
    mockCreateClient.mockImplementation(() => {
      throw new Error('createClient no debe llamarse en demo');
    });
    mockFetch.mockImplementation(() => {
      throw new Error('fetch no debe llamarse en demo');
    });

    render(<PresupuestosPage />);

    await waitFor(() => expect(screen.getAllByText('Ver presupuesto completo')).toHaveLength(8));
    expect(screen.getAllByText('Reforma integral piso Algorta').length).toBeGreaterThan(0);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('las acciones solo cambian el estado local y Descargar PDF usa la ruta demo', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Supabase no debe consultarse en demo');
    });
    mockFetch.mockImplementation(() => {
      throw new Error('fetch no debe llamarse en demo');
    });

    render(<PresupuestosPage />);
    await waitFor(() => expect(screen.getAllByText('Ver presupuesto completo')).toHaveLength(8));

    URL.createObjectURL = jest.fn(() => 'blob:demo');
    URL.revokeObjectURL = jest.fn();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) });
    const descargar = screen.getAllByRole('button', { name: 'Descargar PDF' });
    for (const boton of descargar) expect(boton).toBeEnabled();
    fireEvent.click(descargar[0]);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(String(mockFetch.mock.calls[0][0]).startsWith('/api/demo/pdf/presupuesto/demo-presupuesto-')).toBe(true);
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => {
      throw new Error('fetch no debe llamarse en demo');
    });
    mockFetch.mockClear();
    const antes = screen.getAllByRole('button', { name: 'Generar factura' }).length;
    expect(antes).toBe(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Generar factura' })[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Generar factura' })).toHaveLength(antes - 1));
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un tenant que no es la demo sigue consultando Supabase', async () => {
    mockSession.businessName = 'Otro negocio S.L.';
    const order = jest.fn().mockResolvedValue({ data: [] });
    const select = jest.fn(() => ({ order }));
    mockFrom.mockImplementation(() => ({ select }));

    render(<PresupuestosPage />);

    await waitFor(() => expect(screen.getByText('No hay presupuestos.')).toBeInTheDocument());
    expect(mockFrom).toHaveBeenCalledWith('presupuestos');
    expect(screen.queryByText('Ver presupuesto completo')).not.toBeInTheDocument();
    mockSession.businessName = 'Reformas Demo Errenteria';
  });
});
