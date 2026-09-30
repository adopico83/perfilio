/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FacturasPage from '@/app/facturas/page';

const mockSession = { businessName: 'Reformas Demo Errenteria' };
const mockFrom = jest.fn();
const mockCreateClient = jest.fn();
const mockFetch = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
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
jest.mock('@/contexts/obra-modal-context', () => ({
  useObraModal: () => ({ abrirObra: jest.fn() }),
}));
jest.mock('@/components/facturas/invoice-editor', () => ({
  InvoiceEditor: () => null,
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
  mockFetch.mockImplementation(() => {
    throw new Error('fetch no debe llamarse en demo');
  });
});

describe('FacturasPage con el mock demo', () => {
  it('pinta las 6 facturas del mock sin llamar a Supabase ni a fetch', async () => {
    render(<FacturasPage />);

    await waitFor(() => expect(screen.getAllByText('Ver detalle completo')).toHaveLength(6));
    expect(screen.getByText(/F-2026-044/)).toBeInTheDocument();
    expect(screen.getByText('Vencida')).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('marcar pagada solo cambia el estado local; Descargar PDF usa la ruta demo', async () => {
    render(<FacturasPage />);
    await waitFor(() => expect(screen.getAllByText('Ver detalle completo')).toHaveLength(6));

    URL.createObjectURL = jest.fn(() => 'blob:demo');
    URL.revokeObjectURL = jest.fn();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) });
    const descargar = screen.getAllByRole('button', { name: 'Descargar PDF' });
    for (const boton of descargar) expect(boton).toBeEnabled();
    fireEvent.click(descargar[0]);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(String(mockFetch.mock.calls[0][0]).startsWith('/api/demo/pdf/factura/demo-factura-')).toBe(true);
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => {
      throw new Error('fetch no debe llamarse en demo');
    });
    expect(screen.getAllByRole('button', { name: 'Marcar pagada' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Marcar pagada' })[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Marcar pagada' })).toHaveLength(2));
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un tenant que no es la demo sigue consultando Supabase', async () => {
    mockSession.businessName = 'Otro negocio S.L.';
    const order = jest.fn().mockResolvedValue({ data: [] });
    const select = jest.fn(() => ({ order }));
    mockFrom.mockImplementation(() => ({ select }));

    render(<FacturasPage />);

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('facturas'));
    expect(screen.queryByText('Ver detalle completo')).not.toBeInTheDocument();
  });
});
