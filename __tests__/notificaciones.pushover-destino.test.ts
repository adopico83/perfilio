import { destinoPushover, PUSHOVER_BUSINESS_ID_POR_DEFECTO } from '@/lib/notificaciones/pushover';
import { crearFakeDb } from './helpers/fake-db';

const PINO = PUSHOVER_BUSINESS_ID_POR_DEFECTO;
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';
const ENV = { ...process.env };
const db = (avisos: Array<Record<string, unknown>> = []) => crearFakeDb({ business_avisos_movil: avisos }).client;

beforeEach(() => {
  process.env = { ...ENV };
  for (const k of ['PUSHOVER_API_TOKEN', 'PUSHOVER_TOKEN', 'PUSHOVER_USER_KEY', 'PUSHOVER_USER', 'PUSHOVER_BUSINESS_ID']) delete process.env[k];
});
afterAll(() => { process.env = ENV; });

describe('destinoPushover', () => {
  it('usa la clave propia del negocio', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    expect(await destinoPushover(db([{ business_id: OTRO, pushover_user_key: 'propia' }]), OTRO)).toEqual({ token: 'tok', user: 'propia' });
  });
  it('sin clave propia: Pino usa la global', async () => {
    process.env.PUSHOVER_TOKEN = 'tok';
    process.env.PUSHOVER_USER = 'global';
    expect(await destinoPushover(db(), PINO)).toEqual({ token: 'tok', user: 'global' });
  });
  it('sin clave propia: otro negocio → null (no recibe la clave global)', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'global';
    expect(await destinoPushover(db(), OTRO)).toBeNull();
  });
  it('PUSHOVER_BUSINESS_ID cambia el dueño de la clave global', async () => {
    process.env.PUSHOVER_API_TOKEN = 'tok';
    process.env.PUSHOVER_USER_KEY = 'global';
    process.env.PUSHOVER_BUSINESS_ID = OTRO;
    expect(await destinoPushover(db(), OTRO)).toEqual({ token: 'tok', user: 'global' });
    expect(await destinoPushover(db(), PINO)).toBeNull();
  });
  it('sin token de app → null', async () => {
    process.env.PUSHOVER_USER_KEY = 'global';
    expect(await destinoPushover(db(), PINO)).toBeNull();
  });
});
