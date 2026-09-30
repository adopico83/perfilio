/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import AlbaranesPage from '@/app/albaranes/page';
import ClientesPage from '@/app/clientes/page';
import ClienteFichaPage from '@/app/clientes/[id]/page';
import GastosPage from '@/app/gastos/page';
import MensajesPage from '@/app/mensajes/page';
import ObrasPage from '@/app/obras/page';
import OperariosPage from '@/app/operarios/page';
import ObraModal from '@/components/dashboard/obra-modal';

const mockFrom = jest.fn();
const mockCreateClient = jest.fn();
const mockFetch = jest.fn();
const mockGetBusinessId = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'demo-cliente-1' }),
}));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({
    businessId: 'b1',
    businessName: 'Reformas Demo Errenteria',
    user: null,
  }),
}));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('@/lib/supabase/get-business-id', () => ({
  getBusinessIdClient: (...args: unknown[]) => mockGetBusinessId(...args),
}));
jest.mock('@/contexts/obra-modal-context', () => ({
  useObraModal: () => ({
    abrirObra: jest.fn(),
    cerrarObra: jest.fn(),
    isOpen: true,
    obraId: 'demo-obra-1',
  }),
}));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/dashboard-main-nav', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/toggle-agente-nav-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/dashboard/agente-context-chips', () => ({
  __esModule: true,
  default: () => null,
  chipsObra: () => [],
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  const fail = (nombre: string) => () => {
    throw new Error(`${nombre} no debe llamarse en demo`);
  };
  mockFrom.mockImplementation(fail('Supabase'));
  mockCreateClient.mockImplementation(fail('createClient'));
  mockGetBusinessId.mockImplementation(fail('getBusinessIdClient'));
  mockFetch.mockImplementation(fail('fetch'));
});

const CASOS: Array<[string, () => ReactElement, string[]]> = [
  ['albaranes', () => <AlbaranesPage />, ['ALB-2026-011', 'ALB-2026-014', 'ALB-2026-012', 'ALB-2026-013']],
  ['clientes', () => <ClientesPage />, ['Nerea Urrutia', 'Kafetegi Berria S.L.', 'Aitor Elorriaga']],
  ['ficha de cliente', () => <ClienteFichaPage />, ['Nerea Urrutia', 'nerea.urrutia@example.com', 'Reforma integral piso Algorta']],
  ['gastos', () => <GastosPage />, ['Reforma baño Deusto', 'Cocina Barakaldo', 'Sin obra asignada']],
  ['mensajes', () => <MensajesPage />, ['Leire Olabarria', 'Kafetegi Berria S.L.', 'Iñigo Larrea', 'Jon Arrieta']],
  ['obras', () => <ObrasPage />, ['Reforma integral piso Algorta', 'Baño y cocina Leioa', 'Reforma baño Basauri']],
  ['operarios', () => <OperariosPage />, ['Unai G.', 'Ane M.', 'Xabier L.', 'Mikel A.']],
  ['ficha de obra', () => <ObraModal />, ['Reforma integral piso Algorta', 'Nerea Urrutia']],
];

describe('páginas con el mock demo', () => {
  it.each(CASOS)('%s pinta datos del mock sin llamar a Supabase ni a fetch', async (_nombre, pagina, textos) => {
    render(pagina());

    for (const texto of textos) {
      await waitFor(() => expect(screen.getAllByText(texto, { exact: false }).length).toBeGreaterThan(0));
    }
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockGetBusinessId).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
