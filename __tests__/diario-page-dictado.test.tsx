/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockUseDemo = jest.fn();
jest.mock('@/lib/use-demo-tenant', () => ({ useDemoTenant: () => mockUseDemo() }));
jest.mock('@/contexts/obra-modal-context', () => ({ useObraModal: () => ({ abrirObra: jest.fn() }) }));
// Objetos estables: la página tiene efectos que dependen de ellos y se reejecutarían en cada render.
const mockRouter = { replace: jest.fn(), push: jest.fn() };
const mockParams = new URLSearchParams('');
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockParams,
}));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/volver-dashboard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/dashboard-main-nav', () => ({ __esModule: true, default: () => null }));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) },
  }),
}));
let alTexto: ((t: string) => void) | undefined;
jest.mock('@/hooks/use-grabadora-audio', () => ({
  useGrabadoraAudio: (o: { onTexto?: (t: string) => void }) => {
    alTexto = o.onTexto;
    return { grabando: false, transcribiendo: false, error: '', empezar: jest.fn(), parar: jest.fn(), texto: '' };
  },
}));

import DiarioPage from '@/app/diario/page';

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockUseDemo.mockReturnValue(true); // modo demo: datos mock, sin red
  global.fetch = mockFetch as never;
  Element.prototype.scrollIntoView = jest.fn(); // jsdom no lo implementa
});

describe('/diario en demo: dictar entrada', () => {
  it('abre el modal desde el botón de arriba, guarda en local y abre la carpeta de esa obra', async () => {
    render(<DiarioPage />);
    const boton = await screen.findByRole('button', { name: /Dictar entrada/ });
    fireEvent.click(boton);

    const dialogo = await screen.findByRole('dialog', { name: 'Dictar entrada del diario' });
    const select = within(dialogo).getByLabelText(/Obra/) as HTMLSelectElement;
    const primeraObra = within(select).getAllByRole('option')[1] as HTMLOptionElement;
    fireEvent.change(select, { target: { value: primeraObra.value } });
    fireEvent.change(within(dialogo).getByLabelText(/Texto de la entrada/), {
      target: { value: 'Entrada dictada de prueba' },
    });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dictar entrada del diario' })).toBeNull());
    expect(await screen.findByText('Entrada dictada de prueba')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled(); // demo: nada de red
  });

  it('«Dictar aquí» abre el modal con esa obra preseleccionada', async () => {
    render(<DiarioPage />);
    const botones = await screen.findAllByRole('button', { name: 'Dictar aquí' });
    expect(botones.length).toBeGreaterThan(0);
    fireEvent.click(botones[0]);
    const dialogo = await screen.findByRole('dialog', { name: 'Dictar entrada del diario' });
    const select = within(dialogo).getByLabelText(/Obra/) as HTMLSelectElement;
    expect(select.value).not.toBe('');
    expect(alTexto).toBeDefined();
  });

  it('el texto de la lista vacía menciona el botón', async () => {
    render(<DiarioPage />);
    await screen.findByRole('button', { name: /Dictar entrada/ });
    expect(screen.getByText(/Dicta una entrada con el micrófono/)).toBeTruthy();
  });
});
