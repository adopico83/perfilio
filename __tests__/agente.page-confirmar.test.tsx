/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// La tarjeta sale del panel lateral, que arrastra contextos, Supabase y @react-pdf: se simplifican.
jest.mock('@/components/presupuesto-borrador-canvas', () => ({ PresupuestoBorradorCanvas: () => null }));
jest.mock('@/contexts/canvas-context', () => ({ useCanvas: () => ({}) }));
jest.mock('@/contexts/agent-sidebar-context', () => ({ useAgentSidebar: () => ({}) }));
jest.mock('@/contexts/obra-modal-context', () => ({ useObraModal: () => ({}) }));
jest.mock('@/components/providers/session-provider', () => ({ useSession: () => ({}) }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children?: unknown }) => children }));
jest.mock('@/lib/diario-pdf-link', () => ({ isDiarioPdfDownloadLink: () => false }));
jest.mock('next/navigation', () => ({
  usePathname: () => '/agente',
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (t: string) => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.order = async () => ({ data: t === 'business_profiles' ? [{ id: 'biz-1', nombre: 'Pino', sector: 'Obras' }] : [], error: null });
        q.eq = () => q;
        return q;
      },
    }),
  }),
}));

import AgentePage from '@/app/agente/page';

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as never;
});

const ACCION = { tool: 'cambiar_estado_factura', args: { id: 'f1', estado: 'pagada' }, resumen: 'Voy a cambiar la factura nº 3 de García.' };
const ok = (json: unknown) => ({ ok: true, json: async () => json });

async function enviar(texto: string) {
  const caja = await screen.findByPlaceholderText('Escribe tu mensaje...');
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('biz-1'));
  fireEvent.change(caja, { target: { value: texto } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
}

describe('/agente: confirmar acciones', () => {
  it('enseña la tarjeta «Sí, hazlo / No» y con «Sí» reenvía confirmar_accion sin mensaje', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ respuesta: 'Voy a cambiar la factura nº 3 de García. ¿Lo hago?', accion_pendiente: ACCION }))
      .mockResolvedValueOnce(ok({ respuesta: 'Factura nº 3 marcada como «pagada».' }));
    render(<AgentePage />);
    await enviar('marca la factura 3 como pagada');
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, hazlo' }));
    await waitFor(() => expect(screen.getByText(/marcada como «pagada»/)).toBeInTheDocument());
    const cuerpo = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(cuerpo).toEqual({ business_id: 'biz-1', confirmar_accion: { tool: 'cambiar_estado_factura', args: ACCION.args } });
    expect(await screen.findByText('Hecho ✓')).toBeInTheDocument();
  });

  it('«No» no llama al servidor', async () => {
    mockFetch.mockResolvedValueOnce(ok({ respuesta: '¿Lo hago?', accion_pendiente: ACCION }));
    render(<AgentePage />);
    await enviar('marca la factura 3 como pagada');
    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    expect(await screen.findByText('Vale, no hago nada.')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('un «sí» escrito funciona igual que el botón', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ respuesta: '¿Lo hago?', accion_pendiente: ACCION }))
      .mockResolvedValueOnce(ok({ respuesta: 'Hecho.' }));
    render(<AgentePage />);
    await enviar('marca la factura 3 como pagada');
    await screen.findByRole('button', { name: 'Sí, hazlo' });
    fireEvent.change(screen.getByPlaceholderText('Escribe tu mensaje...'), { target: { value: 'sí' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).confirmar_accion.tool).toBe('cambiar_estado_factura');
  });

  it('enseña el aviso del límite de uso (429) dentro de la página', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'Has hecho demasiadas consultas a la IA. Prueba de nuevo en 12 s.' }) });
    render(<AgentePage />);
    await enviar('hola');
    expect(await screen.findByText(/demasiadas consultas a la IA.*12 s/)).toBeInTheDocument();
  });

  it('tiene salida «← Volver al Dashboard»', async () => {
    render(<AgentePage />);
    expect(await screen.findByRole('link', { name: '← Volver al Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
