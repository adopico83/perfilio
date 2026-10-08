import { respuestaModelo } from './helpers/modelo-dos-pasos';
/**
 * Todas las frases de evals/frases-pino.ts pasan por el motor .jev de la RUTA real (/api/agente):
 * el «modelo» (OpenAI simulado) solo devuelve la ORDEN que traduce la frase (`evals/ordenes-jev.ts`); el resto
 * lo hace el servidor. Se comprueba lo GUARDADO en la base simulada, no solo el texto.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { CASOS_FRASES_PINO, type CasoAgente } from '../evals/frases-pino';
import { ORDEN_POR_FRASE } from '../evals/ordenes-jev';
import { NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';
import { reiniciarContadorEnMemoria } from '@/lib/ia/limite-uso';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: createMock } } })),
}));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));
jest.mock('@/lib/pdf/presupuesto-render', () => ({
  PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre, estado',
  nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
  renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
}));

const SOLO_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

let db: ReturnType<typeof crearFakeDb>;

beforeAll(() => {
  process.env.AGENTE_MOTOR = 'jev';
  delete process.env.AGENTE_CONFIRMACION;
  process.env.OPENAI_API_KEY = 'test-key';
  jest.useFakeTimers({ now: new Date('2026-10-06T10:00:00Z'), doNotFake: [...SOLO_DATE] });
});
afterAll(() => {
  process.env.AGENTE_MOTOR = 'legacy';
  jest.useRealTimers();
});

function preparar(caso: CasoAgente, orden: Record<string, unknown>) {
  reiniciarContadorEnMemoria();
  db = crearFakeDb(crearBaseSimulada());
  (createServiceClient as jest.Mock).mockReturnValue(db.client);
  (createClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'pino@example.com' } } }) } });
  process.env.JEV_API_KEY = 'jev-test';
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ answers: { intent: { type: 'choice', choice: caso.intencionJev ?? 'general', confidence: 0.95 } } }),
  })) as never;
  createMock.mockReset();
  createMock.mockImplementation(async (req: { tools?: Array<{ function: { name: string } }> }) => respuestaModelo(req, orden, { charla: 'Aupa, ¿en qué te ayudo?' }));
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/agente/route');
  const res = await POST(new NextRequest('http://localhost/api/agente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], ...body }) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Escrituras de negocio (sin contar la tabla de órdenes pendientes ni sus cancelaciones). */
const escrituras = () =>
  db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;

const casos = CASOS_FRASES_PINO.filter((c) => c.frase !== 'Sí' && ORDEN_POR_FRASE[c.frase]);

describe('todas las frases de Pino por el motor .jev', () => {
  it('hay una orden para cada frase (salvo el «Sí» de la barrera antigua)', () => {
    const sin = CASOS_FRASES_PINO.filter((c) => c.frase !== 'Sí' && !ORDEN_POR_FRASE[c.frase]).map((c) => c.frase);
    expect(sin).toEqual([]);
  });

  it.each(casos.map((c) => [c.frase, c] as const))('«%s»', async (_f, caso) => {
    const conf = ORDEN_POR_FRASE[caso.frase]!;
    preparar(caso, conf.orden);
    const antes = escrituras();
    const { status, json } = await post({ mensaje: caso.frase, historial: conf.historial ?? [] });
    expect(status).toBe(200);
    const respuesta = String(json.respuesta ?? '');
    const comportamiento = conf.comportamiento ?? caso.comportamiento;

    for (const t of conf.contiene ?? []) expect(respuesta).toContain(t);
    if (conf.orden.accion === 'CHARLA') {
      expect(respuesta).toContain('Aupa');
      expect(escrituras()).toBe(antes);
      return;
    }
    // El modelo no ve ninguna tool de escritura: solo `elegir_accion` y `orden_jev`.
    const vistas = createMock.mock.calls.flatMap((c) => ((c[0] as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map((t) => t.function.name));
    expect(vistas.length).toBeGreaterThan(0);
    for (const n of vistas) expect(['clasificar_intencion', 'elegir_accion', 'orden_jev']).toContain(n);

    switch (comportamiento) {
      case 'pide_confirmacion':
      case 'ejecuta': {
        const accion = json.accion_pendiente as { orden_id: string; args: Record<string, unknown>; resumen: string } | undefined;
        expect(accion?.orden_id).toBeTruthy();
        expect(accion?.args).toEqual({}); // al navegador NO le llegan los args
        expect(escrituras()).toBe(antes); // nada se guarda antes del «Sí»
        const ok = await post({ confirmar_accion: { orden_id: accion!.orden_id } });
        expect(ok.status).toBe(200);
        expect(escrituras()).toBeGreaterThan(antes);
        conf.guardado?.(db.tablas as never);
        // Una orden solo se usa UNA vez.
        const despues = escrituras();
        const otra = await post({ confirmar_accion: { orden_id: accion!.orden_id } });
        expect(String(otra.json.respuesta)).toMatch(/ya se ha usado|No encuentro/);
        expect(escrituras()).toBe(despues);
        break;
      }
      case 'pregunta_opciones': {
        expect(json.accion_pendiente).toBeUndefined();
        expect((json.opciones as unknown[]).length).toBeGreaterThanOrEqual(2);
        expect(respuesta).toMatch(/1\. /);
        expect(escrituras()).toBe(antes);
        break;
      }
      case 'solo_lectura':
      case 'pregunta_o_error': {
        expect(json.accion_pendiente).toBeUndefined();
        expect(escrituras()).toBe(antes);
        break;
      }
    }
  });
});
