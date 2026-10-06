import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { prometeSinHacer } from '@/lib/agente/orquestacion';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { reiniciarContadorEnMemoria } from '@/lib/ia/limite-uso';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

let db: ReturnType<typeof crearFakeDb>;
beforeEach(() => {
  reiniciarContadorEnMemoria();
  db = crearFakeDb(crearBaseSimulada());
  (createServiceClient as jest.Mock).mockReturnValue(db.client);
  (createClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) } });
  delete process.env.JEV_API_KEY;
  delete process.env.AGENTE_CONFIRMACION;
  process.env.OPENAI_API_KEY = 'k';
  createMock.mockReset();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

const llamada = (name: string, args: object, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const modeloLlama = (...calls: ReturnType<typeof llamada>[]) =>
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: calls } }] });
const modeloDice = (texto: string) => createMock.mockResolvedValueOnce({ choices: [{ message: { content: texto } }] });

const post = async (mensaje: string) => {
  const { POST } = await import('@/app/api/agente/route');
  const res = await POST(
    new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], mensaje }),
    })
  );
  return (await res.json()) as Record<string, unknown>;
};

describe('varias rondas de lectura por turno', () => {
  it('lee, vuelve a leer y contesta en el mismo turno (sin «voy a comprobar»)', async () => {
    modeloLlama(llamada('obtener_facturas_pendientes', {}));
    modeloLlama(llamada('listar_albaranes', {}, 'c2'));
    modeloDice('Tienes 1 factura pendiente y 3 albaranes.');
    const json = await post('qué facturas y albaranes tengo');
    expect(json.respuesta).toBe('Tienes 1 factura pendiente y 3 albaranes.');
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('el seguimiento recibe los resultados de la ronda anterior', async () => {
    modeloLlama(llamada('obtener_facturas_pendientes', {}));
    modeloDice('Una factura.');
    await post('qué facturas tengo pendientes');
    const msgs = (createMock.mock.calls[1]![0] as { messages: Array<{ role: string }> }).messages;
    expect(msgs.some((m) => m.role === 'tool')).toBe(true);
  });

  it('lee y luego pide una escritura: se queda en la confirmación y NO escribe', async () => {
    modeloLlama(llamada('buscar_cliente', { query: 'Paqui' }));
    modeloLlama(llamada('crear_cliente', { nombre: 'Lola Nueva' }, 'c2'));
    const json = await post('mira si existe Lola y créala');
    expect((json.accion_pendiente as { tool: string }).tool).toBe('crear_cliente');
    expect(db.inserts).toHaveLength(0);
    expect(createMock).toHaveBeenCalledTimes(2); // no hay más rondas tras la confirmación pendiente
  });

  it('tras una escritura no sigue pidiendo rondas (una acción necesita su «sí»)', async () => {
    modeloLlama(llamada('crear_cliente', { nombre: 'Lola Nueva' }));
    await post('crea el cliente Lola Nueva');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('nunca pasa de 4 rondas aunque el modelo siga pidiendo tools', async () => {
    createMock.mockImplementation(async () => ({ choices: [{ message: { content: null, tool_calls: [llamada('obtener_facturas_pendientes', {}, `c${Math.random()}`)] } }] }));
    await post('qué facturas tengo');
    // 4 rondas = 1 inicial + 3 seguimientos, y luego la prosa final.
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('«voy a comprobar» sin hacerlo', () => {
  it('detecta promesas cortas sin tool', () => {
    for (const t of ['Un momento, voy a comprobar la agenda.', 'Déjame ver…', 'Voy a registrar las horas.', 'Ahora mismo miro.']) {
      expect(prometeSinHacer(t)).toBe(true);
    }
    for (const t of ['Voy a crear el cliente Mikel. ¿Lo hago?', '¿Procedo?']) {
      expect(prometeSinHacer(t)).toBe(true);
    }
    for (const t of ['', 'Tienes 3 citas hoy: a las 10, a las 12 y a las 17.', 'Vale.', 'x'.repeat(300) + ' voy a comprobar']) {
      expect(prometeSinHacer(t)).toBe(false);
    }
  });

  it('si el modelo promete sin llamar a nada, se reintenta forzando una tool', async () => {
    modeloDice('Un momento, voy a comprobar tus facturas.');
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [llamada('obtener_facturas_pendientes', {})] } }] });
    modeloDice('Tienes 1 factura pendiente.');
    const json = await post('cómo vamos con el dinero');
    expect((createMock.mock.calls[1]![0] as { tool_choice?: unknown }).tool_choice).toBe('required');
    expect(json.respuesta).toBe('Tienes 1 factura pendiente.');
  });
});

void IDS;
