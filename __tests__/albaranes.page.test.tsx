/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AlbaranesPage from '@/app/albaranes/page';

const mockFetch = jest.fn();
const mockInsert = jest.fn();
const ALBARAN = {
  id: 'alb-1', business_id: 'biz-1', numero_albaran: '13', cliente_nombre: 'Ana', cliente_id: null,
  cliente_direccion: null, descripcion_trabajos: null, lineas: null, total: 4.82, fecha: '2026-10-01',
  estado: 'entregado', observaciones: null, created_at: '2026-10-01T10:00:00Z', obra_id: null,
};

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'biz-1', businessName: 'Reformas Pino', user: null }),
}));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (t: string) => ({
      select: () => ({ order: async () => ({ data: t === 'albaranes' ? [ALBARAN] : [], error: null }) }),
      insert: mockInsert,
      update: mockInsert,
    }),
  }),
}));
jest.mock('@/contexts/obra-modal-context', () => ({ useObraModal: () => ({ abrirObra: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

async function abrirDialogo() {
  render(<AlbaranesPage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar facturado' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Marcar facturado' }));
}

describe('Albaranes: facturar por la API', () => {
  it('tiene botón para volver al dashboard (con demo y sin demo)', async () => {
    render(<AlbaranesPage />);
    await waitFor(() => expect(screen.getByText('Historial de albaranes')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Volver al Dashboard/i })).toBeInTheDocument();
  });

  it('abre el diálogo con IVA 21 por defecto y llama a POST /facturar sin escribir con Supabase', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, numero_factura: 1 }) });
    await abrirDialogo();
    expect(screen.getByLabelText('IVA de la factura')).toHaveValue('21');
    expect(screen.getByText(/4.82 € IVA incluido/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('IVA de la factura'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear factura' }));
    await waitFor(() => expect(screen.getByText(/Factura nº 1 creada/)).toBeInTheDocument());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/albaranes/alb-1/facturar');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ iva_porcentaje: 10 });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Ver en Facturas' })).toHaveAttribute('href', '/facturas');
  });

  it('enseña el error de la API dentro del diálogo', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'El IVA debe ser uno de: 0, 4, 10, 21' }) });
    await abrirDialogo();
    fireEvent.click(screen.getByRole('button', { name: 'Crear factura' }));
    await waitFor(() => expect(screen.getAllByText(/El IVA debe ser uno de/).length).toBeGreaterThan(0));
  });
});
