/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import VolverAlDashboard from '@/components/ui/volver-dashboard';

const mockUseDemo = jest.fn();
jest.mock('@/lib/use-demo-tenant', () => ({ useDemoTenant: () => mockUseDemo() }));

describe('VolverAlDashboard', () => {
  it.each([[true], [false]])('se ve con demo=%s, apunta a /dashboard y dice «← Volver al Dashboard»', (demo) => {
    mockUseDemo.mockReturnValue(demo);
    render(<VolverAlDashboard />);
    const link = screen.getByRole('link', { name: '← Volver al Dashboard' });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});

/** Páginas que no necesitan salida, con el motivo. */
const SIN_SALIDA: Record<string, string> = {
  'page.tsx': 'Landing pública',
  'login/page.tsx': 'Pública (tiene «← Volver al inicio»)',
  'dashboard/page.tsx': 'Es el destino de todas las salidas',
  'ajustes/page.tsx': 'Solo hace redirect a /ajustes/marca',
};

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'api') return [];
    if (statSync(p).isDirectory()) return paginas(p);
    return n === 'page.tsx' ? [p] : [];
  });
}

describe('guardián: ninguna pantalla sin salida', () => {
  const raiz = join(process.cwd(), 'app');
  const todas = paginas(raiz).map((p) => relative(raiz, p));

  it('encuentra las pantallas', () => expect(todas.length).toBeGreaterThan(10));

  it.each(todas.filter((p) => !(p in SIN_SALIDA)))('%s usa VolverAlDashboard o enlaza a /dashboard', (p) => {
    const src = readFileSync(join(raiz, p), 'utf8');
    const tiene = src.includes('<VolverAlDashboard') || /href=["']\/dashboard["']/.test(src);
    expect(tiene).toBe(true);
  });
});
