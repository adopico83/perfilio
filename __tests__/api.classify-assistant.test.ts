import { NextRequest } from 'next/server';

const createMock = jest.fn();
const sendUrgencyAlert = jest.fn();
const mockUser = jest.fn();
const fromMock = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));
jest.mock('@/lib/email', () => ({ sendUrgencyAlert: (...a: unknown[]) => sendUrgencyAlert(...a) }));
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockUser() }, from: (...a: unknown[]) => fromMock(...a) }),
  createServiceClient: () => ({ from: (...a: unknown[]) => fromMock(...a) }),
}));

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, OPENAI_API_KEY: 'k' };
  delete process.env.AGENTE_MODELO;
  mockUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'pino@x.es' } } });
  createMock.mockResolvedValue({ choices: [{ message: { content: 'urgent' } }], usage: { total_tokens: 5 } });
});
afterAll(() => { process.env = ENV; });

const post = (body: unknown) => new NextRequest('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/classify', () => {
  const llamar = async (b: unknown) => (await import('@/app/api/classify/route')).POST(post(b));

  it('401 sin sesión y no llama a OpenAI', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await llamar({ message: 'hola' })).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
  it('usa modeloAgente() con max_completion_tokens y temperature', async () => {
    await llamar({ message: 'hola' });
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini', max_completion_tokens: 10, temperature: 0.3 });
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('max_tokens');
  });
  it('con AGENTE_MODELO=gpt-5-mini no manda temperature', async () => {
    process.env.AGENTE_MODELO = 'gpt-5-mini';
    await llamar({ message: 'hola' });
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe('gpt-5-mini');
    expect(arg).not.toHaveProperty('temperature');
    expect(arg.max_completion_tokens).toBeGreaterThan(10);
  });
  it('si es urgente avisa al email del usuario con sesión', async () => {
    const res = await llamar({ message: 'urgente!', senderName: 'Ana', channel: 'web' });
    expect(await res.json()).toMatchObject({ success: true, priority: 'urgent' });
    expect(sendUrgencyAlert).toHaveBeenCalledWith('pino@x.es', 'urgente!', 'Ana', 'web');
  });
  it('si el usuario no tiene email usa ALERT_EMAIL', async () => {
    process.env.ALERT_EMAIL = 'alerta@x.es';
    mockUser.mockResolvedValue({ data: { user: { id: 'u1', email: null } } });
    await llamar({ message: 'urgente!' });
    expect(sendUrgencyAlert).toHaveBeenCalledWith('alerta@x.es', 'urgente!', 'Remitente', 'N/A');
  });
});

describe('POST /api/assistant', () => {
  const llamar = async (b: unknown) => (await import('@/app/api/assistant/route')).POST(post(b));

  it('401 sin sesión', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await llamar({ message: 'hola' })).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
  it('usa modeloAgente() y devuelve la respuesta', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'Hola' } }], usage: { total_tokens: 9 } });
    const res = await llamar({ message: 'hola' });
    expect(await res.json()).toMatchObject({ success: true, response: 'Hola', tokens: 9 });
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini', max_completion_tokens: 500, temperature: 0.7 });
  });
  it('con gpt-5-mini no manda temperature', async () => {
    process.env.AGENTE_MODELO = 'gpt-5-mini';
    await llamar({ message: 'hola' });
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('temperature');
  });
  it('ignora business_id y sender_email del cuerpo: nunca toca conversation_history', async () => {
    await llamar({ message: 'hola', business_id: 'otro-negocio', sender_email: 'x@y.es' });
    expect(fromMock).not.toHaveBeenCalled();
    const mensajes = createMock.mock.calls[0][0].messages;
    expect(mensajes).toHaveLength(2); // system + user, sin historial
  });
});
