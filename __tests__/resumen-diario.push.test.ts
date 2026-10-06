import { enviarPushResumen, TITULO_PUSH_RESUMEN } from '@/lib/resumen-diario/push';
import { calcularResumenDia, textoResumen } from '@/lib/resumen-diario/calcular';
import { crearFakeDb } from './helpers/fake-db';

const sendNotification = jest.fn();
const configurarWebPush = jest.fn();
jest.mock('@/lib/notificaciones/web-push', () => ({
  configurarWebPush: () => configurarWebPush(),
  webpush: { sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

const NOW = new Date('2026-10-05T05:30:00Z');
// Pino: el dueño de la clave global de Pushover (los demás negocios necesitan clave propia).
const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';
const resumen = calcularResumenDia(
  {
    citas: [],
    obras: [{ id: 'o1', nombre: 'Reforma', estado: 'activa', created_at: '2026-10-04T00:00:00Z' }],
    diario: [],
    presupuestos: [],
    facturas: [],
    jornadas: [{ obra_id: 'o1', horas_reales: 30 }],
    presupuestosObra: [{ obra_id: 'o1', importe_total: 1000, estado: 'aceptado' }],
  },
  NOW
);

const fetchMock = jest.fn();
const ENV = { ...process.env };

function db(activo: boolean | undefined, subs: unknown[] = [], id = BIZ, avisos: Array<Record<string, unknown>> = []) {
  return crearFakeDb({
    business_avisos_movil: avisos,
    business_profiles: activo === undefined ? [] : [{ id, resumen_push: activo }],
    push_subscriptions: subs.map((subscription) => ({ business_id: BIZ, subscription })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.PUSHOVER_API_TOKEN;
  delete process.env.PUSHOVER_TOKEN;
  delete process.env.PUSHOVER_USER_KEY;
  delete process.env.PUSHOVER_USER;
  delete process.env.PUSHOVER_BUSINESS_ID;
  global.fetch = fetchMock as unknown as typeof fetch;
  configurarWebPush.mockImplementation(() => {
    throw new Error('VAPID keys no configuradas');
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  process.env = ENV;
});

describe('enviarPushResumen: Pushover por negocio', () => {
  it('otro negocio sin clave propia NO recibe la clave global (sin_destinatario)', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'global-de-pino';
    const r = await enviarPushResumen(db(true, [], OTRO).client, OTRO, resumen);
    expect(r.pushover).toBe('sin_destinatario');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('otro negocio con clave propia recibe en SU clave', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'global-de-pino';
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1 }) });
    const propia = 'a'.repeat(30);
    const r = await enviarPushResumen(db(true, [], OTRO, [{ business_id: OTRO, pushover_user_key: propia }]).client, OTRO, resumen);
    expect(r.pushover).toBe('enviado');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams).get('user')).toBe(propia);
  });
});

describe('enviarPushResumen', () => {
  it('desactivado por defecto: no envía nada y no usa la red', async () => {
    process.env.PUSHOVER_API_TOKEN = 't';
    process.env.PUSHOVER_USER_KEY = 'u';
    for (const activo of [false, undefined]) {
      const r = await enviarPushResumen(db(activo).client, BIZ, resumen);
      expect(r).toEqual({ pushover: 'desactivado', webpush: 'desactivado' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('activado pero sin credenciales de Pushover ni VAPID', async () => {
    const r = await enviarPushResumen(db(true).client, BIZ, resumen);
    expect(r).toEqual({ pushover: 'sin_credenciales', webpush: 'sin_credenciales' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Pushover OK: título, mensaje del resumen y prioridad alta por el margen', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'usr';
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1 }) });
    const r = await enviarPushResumen(db(true).client, BIZ, resumen);
    expect(r.pushover).toBe('enviado');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.pushover.net/1/messages.json');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('token')).toBe('tok');
    expect(body.get('user')).toBe('usr');
    expect(body.get('title')).toBe(TITULO_PUSH_RESUMEN);
    expect(body.get('message')).toBe(textoResumen(resumen));
    expect(body.get('priority')).toBe('1');
  });

  it('recorta el mensaje a 1024 caracteres', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'usr';
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1 }) });
    const obras = Array.from({ length: 80 }, (_, i) => ({
      id: `o${i}`,
      nombre: `Obra con un nombre bastante largo número ${i}`,
      estado: 'activa',
      created_at: '2026-01-01T00:00:00Z',
    }));
    const largo = calcularResumenDia({ citas: [], obras, diario: [], presupuestos: [], facturas: [] }, NOW);
    expect(textoResumen(largo).length).toBeGreaterThan(1024);
    await enviarPushResumen(db(true).client, BIZ, largo);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect((body.get('message') ?? '').length).toBeLessThanOrEqual(1024);
  });

  it('Pushover KO (status 0 o fallo de red): devuelve error sin lanzar', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'usr';
    fetchMock.mockResolvedValueOnce({ json: async () => ({ status: 0 }) });
    expect((await enviarPushResumen(db(true).client, BIZ, resumen)).pushover).toBe('error');
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(enviarPushResumen(db(true).client, BIZ, resumen)).resolves.toMatchObject({ pushover: 'error' });
  });

  it('web push: envía a las suscripciones del negocio', async () => {
    configurarWebPush.mockImplementation(() => undefined);
    sendNotification.mockResolvedValue(undefined);
    const sub = { endpoint: 'https://push.test/1', keys: {} };
    const r = await enviarPushResumen(db(true, [sub, { sinEndpoint: true }]).client, BIZ, resumen);
    expect(r.webpush).toBe('enviado');
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: TITULO_PUSH_RESUMEN });
  });

  it('web push: sin suscripciones o con todas fallando, sin lanzar', async () => {
    configurarWebPush.mockImplementation(() => undefined);
    expect((await enviarPushResumen(db(true).client, BIZ, resumen)).webpush).toBe('sin_suscripciones');
    sendNotification.mockRejectedValue(new Error('410 gone'));
    const r = await enviarPushResumen(db(true, [{ endpoint: 'https://push.test/1' }]).client, BIZ, resumen);
    expect(r.webpush).toBe('error');
  });

  it('nunca lanza aunque la base de datos reviente', async () => {
    const roto = { from: () => { throw new Error('db caída'); } } as never;
    await expect(enviarPushResumen(roto, BIZ, resumen)).resolves.toEqual({ pushover: 'error', webpush: 'error' });
  });
});
