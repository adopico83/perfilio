/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AvisosMovil from '@/components/ajustes/avisos-movil';

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as never;
});
const estado = { resumen_push: false, pushover_configurado: true, pushover_clave_final: '…1234', usa_clave_global: false };
const ok = (json: unknown) => ({ ok: true, json: async () => json });

describe('Avisos al móvil', () => {
  it('en demo se ve deshabilitado y no llama a la API', async () => {
    render(<AvisosMovil demo businessId={null} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByLabelText('Clave de usuario de Pushover')).toBeDisabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('carga el estado, enseña las 4 últimas cifras y guarda la clave nueva', async () => {
    mockFetch.mockResolvedValueOnce(ok(estado)).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(estado));
    render(<AvisosMovil demo={false} businessId="biz-1" />);
    const campo = await screen.findByLabelText('Clave de usuario de Pushover');
    await waitFor(() => expect(campo).toHaveAttribute('placeholder', '…1234'));
    expect(campo).toHaveAttribute('type', 'password');
    fireEvent.change(campo, { target: { value: 'A'.repeat(30) } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar clave' }));
    await waitFor(() => expect(screen.getByText('Clave guardada.')).toBeInTheDocument());
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe('/api/negocio/avisos');
    expect(JSON.parse(init.body)).toEqual({ business_id: 'biz-1', pushover_user_key: 'A'.repeat(30) });
  });

  it('el interruptor guarda resumen_push y «Quitar clave» manda null', async () => {
    mockFetch.mockResolvedValue(ok(estado));
    render(<AvisosMovil demo={false} businessId="biz-1" />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByText('Aviso activado.')).toBeInTheDocument());
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ business_id: 'biz-1', resumen_push: true });
    fireEvent.click(screen.getByRole('button', { name: 'Quitar clave' }));
    await waitFor(() => expect(screen.getByText('Clave quitada.')).toBeInTheDocument());
    expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ business_id: 'biz-1', pushover_user_key: null });
  });

  it('enseña el error de la API inline', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(estado))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Pushover no reconoce esa clave. Revísala en la app de Pushover.' }) });
    render(<AvisosMovil demo={false} businessId="biz-1" />);
    const campo = await screen.findByLabelText('Clave de usuario de Pushover');
    await waitFor(() => expect(campo).toBeEnabled());
    fireEvent.change(campo, { target: { value: 'B'.repeat(30) } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar clave' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no reconoce esa clave/);
  });
});
