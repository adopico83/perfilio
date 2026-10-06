/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUseDemo = jest.fn();
jest.mock('@/lib/use-demo-tenant', () => ({ useDemoTenant: () => mockUseDemo() }));
const mockRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/volver-dashboard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/dashboard-main-nav', () => ({ __esModule: true, default: () => null }));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } }),
}));

import AjustesMarcaPage from '@/app/ajustes/marca/page';
import { DEMO_MARCA } from '@/lib/demo-data';

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as never;
});

describe('Ajustes de marca en demo', () => {
  beforeEach(() => mockUseDemo.mockReturnValue(true));

  it('es de solo lectura: enseña la marca de ejemplo, sin Guardar ni subir logo ni red', async () => {
    render(<AjustesMarcaPage />);
    const primario = (await screen.findByLabelText(/Color primario/)) as HTMLInputElement;
    expect(primario.value.toLowerCase()).toBe(DEMO_MARCA.colorPrimario!.toLowerCase());
    expect(primario.disabled).toBe(true);
    expect((screen.getByLabelText('Razón social') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Guardar cambios/ })).toBeNull();
    expect(screen.queryByText(/Subir logo/)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('el PDF de muestra apunta al PDF demo (con la marca del estudio)', async () => {
    render(<AjustesMarcaPage />);
    const enlace = (await screen.findByRole('link', { name: /PDF de muestra/ })) as HTMLAnchorElement;
    expect(enlace.getAttribute('href')).toMatch(/^\/api\/demo\/pdf\/presupuesto\/.+/);
  });
});

describe('Ajustes de marca con negocio real', () => {
  beforeEach(() => {
    mockUseDemo.mockReturnValue(false);
    mockFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/negocio/marca' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            business_id: 'biz-1',
            ajustes: { razon_social: 'Pino S.L.', nif: 'B1', marca_color_primario: '#112233', marca_tipografia: 'Courier' },
            logo_url_firmada: null,
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
  });

  it('carga los datos guardados', async () => {
    render(<AjustesMarcaPage />);
    await waitFor(() => expect((screen.getByLabelText('Razón social') as HTMLInputElement).value).toBe('Pino S.L.'));
    expect((screen.getByLabelText('Tipografía') as HTMLSelectElement).value).toBe('Courier');
  });

  it('guarda con PATCH incluyendo el negocio y los campos editados', async () => {
    render(<AjustesMarcaPage />);
    await waitFor(() => expect((screen.getByLabelText('Razón social') as HTMLInputElement).value).toBe('Pino S.L.'));
    fireEvent.change(screen.getByLabelText('NIF'), { target: { value: 'B999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText(/Cambios guardados/);
    const llamada = mockFetch.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(llamada[0]).toBe('/api/negocio/marca');
    expect(JSON.parse(llamada[1].body)).toMatchObject({ business_id: 'biz-1', nif: 'B999', marca_tipografia: 'Courier' });
  });

  it('enseña el error del servidor si no se puede guardar', async () => {
    render(<AjustesMarcaPage />);
    await waitFor(() => expect((screen.getByLabelText('Razón social') as HTMLInputElement).value).toBe('Pino S.L.'));
    mockFetch.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'El color primario debe ser un color con formato #RRGGBB' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/#RRGGBB/);
  });

  it('el PDF de muestra usa el negocio y avisa de guardar antes', async () => {
    render(<AjustesMarcaPage />);
    await waitFor(() => expect((screen.getByLabelText('Razón social') as HTMLInputElement).value).toBe('Pino S.L.'));
    expect((screen.getByRole('link', { name: /PDF de muestra/ }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/api/pdf/muestra?business_id=biz-1'
    );
    expect(screen.getByText(/guarda antes/)).toBeTruthy();
  });
});
