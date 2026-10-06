/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FacturasPage from '@/app/facturas/page';

const mockFetch = jest.fn();
const FACTURA = {
  id: 'fac-1',
  business_id: 'biz-1',
  numero_factura: '7',
  cliente_nombre: 'Ana',
  cliente_direccion: null,
  cliente_nif: null,
  descripcion_trabajos: null,
  lineas: [],
  base_imponible: 100,
  iva: 21,
  total: 121,
  fecha: '2026-10-01',
  fecha_vencimiento: null,
  estado: 'pendiente',
  observaciones: null,
  created_at: '2026-10-01T10:00:00Z',
  obra_id: null,
};
const PAYLOAD = {
  cliente_nombre: 'Ana López',
  iva_porcentaje: 21,
  lineas: [{ descripcion: 'Obra', cantidad: 2, precio_unitario: 50 }],
};

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'biz-1', businessName: 'Reformas Pino', user: null }),
}));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({
      select: () => ({ order: async () => ({ data: [FACTURA], error: null }) }),
    }),
  }),
}));
jest.mock('@/contexts/obra-modal-context', () => ({ useObraModal: () => ({ abrirObra: jest.fn() }) }));
jest.mock('@/lib/pdf/empresa', () => ({
  empresaVacia: () => ({ cuentasBancarias: [] }),
  loadEmpresaEmisor: async () => ({ ok: true, empresa: { cuentasBancarias: [] }, logoUrl: null }),
}));
jest.mock('@/components/facturas/invoice-editor', () => ({
  InvoiceEditor: (p: { onSave: (x: unknown) => Promise<void>; error?: string; saved?: boolean }) => (
    <div>
      <button onClick={() => void p.onSave(PAYLOAD)}>guardar-stub</button>
      {p.error ? <p>{`ERROR: ${p.error}`}</p> : null}
      {p.saved ? <p>guardado-ok</p> : null}
    </div>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

async function abrirEditor() {
  render(<FacturasPage />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
  await waitFor(() => expect(screen.getByText('guardar-stub')).toBeInTheDocument());
}

describe('Facturas: guardar desde el editor', () => {
  it('manda las líneas y el IVA a PATCH /api/facturas/[id], no al agente', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, factura: FACTURA }) });
    await abrirEditor();
    fireEvent.click(screen.getByText('guardar-stub'));
    await waitFor(() => expect(screen.getByText('guardado-ok')).toBeInTheDocument());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/facturas/fac-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/api/agente'))).toBe(false);
  });

  it('enseña el error que devuelve la API', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Solo se pueden editar facturas pendientes; esta está «pagada».' }),
    });
    await abrirEditor();
    fireEvent.click(screen.getByText('guardar-stub'));
    await waitFor(() => expect(screen.getByText(/ERROR: Solo se pueden editar facturas pendientes/)).toBeInTheDocument());
  });
});
