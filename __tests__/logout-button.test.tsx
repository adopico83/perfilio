/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LogoutButton from '@/app/dashboard/logout-button';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: jest.fn() } }),
}));

describe('LogoutButton', () => {
  it('compacto: aria-label y title, texto oculto en móvil y sin partirse en dos líneas', () => {
    render(<LogoutButton compact />);
    const btn = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(btn).toHaveAttribute('title', 'Cerrar sesión');
    expect(btn).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(screen.getByText('Cerrar Sesión')).toHaveClass('hidden', 'sm:inline');
  });

  it('sin compact se queda como siempre: texto visible y sin aria-label propio', () => {
    render(<LogoutButton />);
    const btn = screen.getByRole('button', { name: 'Cerrar Sesión' });
    expect(btn).not.toHaveAttribute('aria-label');
    expect(screen.getByText('Cerrar Sesión')).not.toHaveClass('hidden');
  });
});
