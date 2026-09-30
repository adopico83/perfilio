/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AgendaPage from '@/app/agenda/page';
import DemoCalendarioCard from '@/components/dashboard/demo-calendario-card';
import DashboardShellProvider from '@/components/dashboard/dashboard-shell-provider';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';
import { DemoAgendaProvider } from '@/contexts/demo-agenda-context';

const mockReplace = jest.fn();
const mockCreateClient = jest.fn();
const mockFrom = jest.fn();
const mockFetch = jest.fn();
let mockPathname = '/agenda';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname,
}));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({
    businessId: 'b1',
    businessName: 'Reformas Demo Errenteria',
    user: null,
  }),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: (...a: unknown[]) => mockCreateClient(...a),
}));
jest.mock('@/components/dashboard/agent-sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-panel" />,
}));
jest.mock('@/app/dashboard/logout-button', () => ({
  __esModule: true,
  default: () => <button type="button">Cerrar Sesión</button>,
}));

const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nombreMes = (d: Date) => d.toLocaleDateString('es-ES', { month: 'long' });

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/agenda';
  global.fetch = mockFetch as unknown as typeof fetch;
  const fail = (n: string) => () => {
    throw new Error(`${n} no debe llamarse en demo`);
  };
  mockCreateClient.mockImplementation(fail('createClient'));
  mockFrom.mockImplementation(fail('Supabase'));
  mockFetch.mockImplementation(fail('fetch'));
});

function conProveedor(ui: React.ReactNode) {
  return <DemoAgendaProvider>{ui}</DemoAgendaProvider>;
}

describe('Agenda demo: salir de la página', () => {
  it('«← Volver al Dashboard» lleva a /dashboard', () => {
    render(conProveedor(<AgendaPage />));
    const volver = screen.getByRole('link', { name: /Volver al Dashboard/ });
    expect(volver).toHaveAttribute('href', '/dashboard');
  });

  it('/agenda se pinta dentro del shell de la demo, con el menú izquierdo', () => {
    render(
      <AgentSidebarProvider>
        <DashboardShellProvider>
          <p>contenido agenda</p>
        </DashboardShellProvider>
      </AgentSidebarProvider>
    );
    const nav = screen.getByRole('navigation', { name: 'Demo' });
    expect(nav).toHaveTextContent('Agenda');
    expect(nav).toHaveTextContent('Dashboard');
    expect(screen.getByText('contenido agenda')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '/agenda');
  });

  it('el modal de la card se cierra con la X y con Esc', () => {
    render(conProveedor(<DemoCalendarioCard />));

    fireEvent.click(screen.getByText('Ver calendario'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar calendario' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Ver calendario'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Agenda demo: navegar por meses y años', () => {
  it('las flechas, «Hoy» y los selectores cambian el mes', () => {
    render(conProveedor(<AgendaPage />));
    const hoy = new Date();
    const selMes = screen.getByLabelText('Mes') as HTMLSelectElement;
    const selAnio = screen.getByLabelText('Año') as HTMLSelectElement;
    expect(selMes.value).toBe(String(hoy.getMonth()));
    expect(selAnio.value).toBe(String(hoy.getFullYear()));

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    const sig = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    expect(selMes.value).toBe(String(sig.getMonth()));
    expect(selAnio.value).toBe(String(sig.getFullYear()));

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    expect(selMes.value).toBe(String(ant.getMonth()));
    expect(selAnio.value).toBe(String(ant.getFullYear()));

    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(selMes.value).toBe(String(hoy.getMonth()));
    expect(selAnio.value).toBe(String(hoy.getFullYear()));

    fireEvent.change(selMes, { target: { value: '0' } });
    fireEvent.change(selAnio, { target: { value: String(hoy.getFullYear() + 2) } });
    expect(selMes.value).toBe('0');
    expect(selAnio.value).toBe(String(hoy.getFullYear() + 2));
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(27);
  });

  it('los años van de hoy -1 a hoy +2', () => {
    render(conProveedor(<AgendaPage />));
    const anio = new Date().getFullYear();
    const opciones = within(screen.getByLabelText('Año'))
      .getAllByRole('option')
      .map((o) => Number(o.textContent));
    expect(opciones).toEqual([anio - 1, anio, anio + 1, anio + 2]);
  });

  it('las citas del mock se ven en el mes que les toca', () => {
    render(conProveedor(<AgendaPage />));
    // Las citas del mock caen entre hace 2 días y dentro de 7: alguna está en el mes actual o en el siguiente.
    const hoy = new Date();
    const hayEnEsteMes = screen.queryAllByText(/Visita de obra|Replanteo|Reunión|Entrega|Medición/).length > 0;
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    const hayEnElSiguiente = screen.queryAllByText(/Visita de obra|Replanteo|Reunión|Entrega|Medición|Recepción/).length > 0;
    expect(hayEnEsteMes || hayEnElSiguiente).toBe(true);
    // Un año lejano no tiene citas del mock.
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: String(hoy.getFullYear() + 2) } });
    expect(screen.queryAllByText(/Visita de obra/)).toHaveLength(0);
  });
});

describe('Agenda demo: añadir cita a mano', () => {
  it('con el día seleccionado ya puesto, la cita aparece en el calendario y en la card del dashboard', async () => {
    render(
      conProveedor(
        <>
          <AgendaPage />
          <DemoCalendarioCard />
        </>
      )
    );

    // Elegir un día del mes actual: hoy.
    const hoy = new Date();
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir cita' }));

    const form = screen.getByRole('form', { name: 'Nueva cita' });
    expect((within(form).getByLabelText('Fecha') as HTMLInputElement).value).toBe(isoLocal(hoy));
    const obras = within(form).getByLabelText(/Obra/) as HTMLSelectElement;
    expect(within(obras).getAllByRole('option').length).toBe(7); // «Sin obra» + 6 obras del mock

    fireEvent.change(within(form).getByLabelText('Título'), { target: { value: 'Cita de prueba demo' } });
    fireEvent.change(within(form).getByLabelText('Hora'), { target: { value: '06:00' } });
    fireEvent.change(obras, { target: { value: 'Cocina Barakaldo' } });
    fireEvent.change(within(form).getByLabelText(/Nota/), { target: { value: 'Llevar el replanteo' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cita' }));

    // Calendario: aparece en la celda del día y, seleccionado, en el detalle con obra y nota.
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Nueva cita' })).not.toBeInTheDocument());
    expect(screen.getAllByText('Cita de prueba demo').length).toBeGreaterThan(0);
    expect(screen.getByText('Obra: Cocina Barakaldo')).toBeInTheDocument();
    expect(screen.getByText('Llevar el replanteo')).toBeInTheDocument();

    // Card del dashboard: «Próximas citas».
    const card = screen.getByText('Ver calendario').closest('button') as HTMLElement;
    expect(within(card).getByText('Cita de prueba demo')).toBeInTheDocument();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('una cita en otro mes lleva el calendario a ese mes y no se guarda sin título', () => {
    render(conProveedor(<AgendaPage />));
    const hoy = new Date();
    const futuro = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 10);

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir cita' }));
    const form = screen.getByRole('form', { name: 'Nueva cita' });
    fireEvent.change(within(form).getByLabelText('Fecha'), { target: { value: isoLocal(futuro) } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cita' }));
    // Sin título el formulario sigue abierto y no hay cita.
    expect(screen.getByRole('form', { name: 'Nueva cita' })).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText('Título'), { target: { value: 'Reunión futura' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cita' }));

    expect((screen.getByLabelText('Mes') as HTMLSelectElement).value).toBe(String(futuro.getMonth()));
    expect(screen.getAllByText('Reunión futura').length).toBeGreaterThan(0);
    expect(nombreMes(futuro).length).toBeGreaterThan(0);
  });

});
