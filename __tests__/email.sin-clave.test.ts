const sendMock = jest.fn();
const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send: (...a: unknown[]) => sendMock(...a) } }));
jest.mock('resend', () => ({ Resend: function (...a: unknown[]) { return ResendMock(...a); } }));

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.RESEND_API_KEY;
  sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => { process.env = ENV; });

describe('lib/email sin RESEND_API_KEY', () => {
  it('importar el módulo no lanza ni crea el cliente', async () => {
    await expect(import('@/lib/email')).resolves.toBeDefined();
    expect(ResendMock).not.toHaveBeenCalled();
  });
  it('sendUrgencyAlert devuelve success:false, avisa y no llama a Resend', async () => {
    const { sendUrgencyAlert } = await import('@/lib/email');
    expect(await sendUrgencyAlert('a@b.es', 'hola', 'Ana', 'web')).toEqual({ success: false, error: 'RESEND_API_KEY no configurada' });
    expect(console.warn).toHaveBeenCalled();
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
  it('con clave crea el cliente y envía', async () => {
    process.env.RESEND_API_KEY = 're_x';
    const { sendUrgencyAlert } = await import('@/lib/email');
    expect(await sendUrgencyAlert('a@b.es', '<b>hola</b>', 'Ana', 'web')).toEqual({ success: true });
    expect(ResendMock).toHaveBeenCalledWith('re_x');
    expect(sendMock.mock.calls[0][0].html).toContain('&lt;b&gt;');
  });
});

describe('/api/lista-espera-notificacion sin RESEND_API_KEY', () => {
  it('importar no lanza; responde 500 claro y no crea el cliente', async () => {
    process.env.NOTIFICATION_EMAIL = 'x@y.es';
    const { POST } = await import('@/app/api/lista-espera-notificacion/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ nombre: 'a', apellido: 'b', telefono: '1', email: 'c@d.es' }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/RESEND_API_KEY/);
    expect(ResendMock).not.toHaveBeenCalled();
  });
});
