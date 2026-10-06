/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MensajesPage from '@/app/mensajes/page';

const mockFetch = jest.fn();
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const CONV = { id: 'c1', business_id: 'biz-1', message: 'Hola, ¿cuánto cuesta?', priority: 'normal', status: 'pending', created_at: '2026-10-01T10:00:00Z', ai_responses: [] };

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ businessId: 'biz-1', businessName: 'Reformas Pino', user: null }),
}));
jest.mock('@/app/dashboard/logout-button', () => ({ __esModule: true, default: () => null }));
jest.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: t === 'conversations' ? [CONV] : [], error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: mockInsert,
    }),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('/mensajes: error de la IA', () => {
  it('con 429 no guarda ninguna respuesta y enseña el motivo dentro de la página', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ priority: 'normal' }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'Has hecho demasiadas consultas a la IA. Prueba de nuevo en 30 s.' }) });
    render(<MensajesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Generar Respuesta IA/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiadas consultas a la IA/);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('con respuesta correcta sí la guarda', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ priority: 'normal' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, response: 'Hola, te llamamos.' }) });
    render(<MensajesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Generar Respuesta IA/ }));
    await waitFor(() => expect(mockInsert).toHaveBeenCalledWith({ conversation_id: 'c1', ai_response: 'Hola, te llamamos.' }));
  });
});
