/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';

// El panel arrastra contextos, Supabase y @react-pdf; aquí solo se prueba la tarjeta «Sí, hazlo / No».
jest.mock('@supabase/ssr', () => ({ createBrowserClient: () => ({}) }));
jest.mock('@/components/presupuesto-borrador-canvas', () => ({ PresupuestoBorradorCanvas: () => null }));
jest.mock('@/contexts/canvas-context', () => ({ useCanvas: () => ({}) }));
jest.mock('@/contexts/agent-sidebar-context', () => ({ useAgentSidebar: () => ({}) }));
jest.mock('@/contexts/obra-modal-context', () => ({ useObraModal: () => ({}) }));
jest.mock('@/components/providers/session-provider', () => ({ useSession: () => ({}) }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children?: unknown }) => children }));
jest.mock('@/lib/diario-pdf-link', () => ({ isDiarioPdfDownloadLink: () => false }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

import { AccionPendienteCard } from '@/components/dashboard/agent-sidebar';

const accion = (estado: 'pendiente' | 'ejecutando' | 'confirmada' | 'cancelada') => ({
  tool: 'crear_cliente',
  args: {},
  resumen: 'Voy a crear un cliente.',
  estado,
});

describe('AccionPendienteCard', () => {
  it('pendiente: botones «Sí, hazlo» y «No» que llaman a sus manejadores', () => {
    const onSi = jest.fn();
    const onNo = jest.fn();
    render(<AccionPendienteCard accion={accion('pendiente')} onSi={onSi} onNo={onNo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, hazlo' }));
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onSi).toHaveBeenCalledTimes(1);
    expect(onNo).toHaveBeenCalledTimes(1);
  });
  it('ejecutando: los botones se bloquean para no confirmar dos veces', () => {
    render(<AccionPendienteCard accion={accion('ejecutando')} onSi={jest.fn()} onNo={jest.fn()} />);
    expect((screen.getByRole('button', { name: /Haciéndolo/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('confirmada y cancelada: solo un estado, sin botones', () => {
    const { rerender } = render(<AccionPendienteCard accion={accion('confirmada')} onSi={jest.fn()} onNo={jest.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Hecho');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<AccionPendienteCard accion={accion('cancelada')} onSi={jest.fn()} onNo={jest.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('No se ha hecho nada');
  });
});
