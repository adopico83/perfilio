/**
 * Batería de frases de Pino con OpenAI SIMULADO (ver evals/frases-pino.ts).
 *
 * El «modelo» devuelve la tool y los argumentos esperados; lo que se prueba es todo lo que hace el
 * servidor alrededor: (a) la tool está disponible para esa intención, (b) el guardarraíl no la
 * bloquea, (c) el comportamiento (pide confirmación sin escribir / pregunta con opciones / ejecuta /
 * lee) y (d) los números y nombres se resuelven al id del negocio correcto, nunca al de otro.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { CASOS_FRASES_PINO, type CasoAgente } from '../evals/frases-pino';
import { IDS, NEGOCIO_A, NEGOCIO_B, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/supabase/server', () => ({
  createServiceClient: jest.fn(),
  createClient: jest.fn(),
}));

const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: createMock } } })),
}));

// El dictado llama a OpenAI por dentro para estructurar partidas: se sustituye por un resultado fijo.
jest.mock('@/lib/dictado-presupuesto', () => ({
  ...jest.requireActual('@/lib/dictado-presupuesto'),
  estructurarDictadoEnPartidas: jest.fn(async () => [
    { descripcion: 'Alicatado de baño', cantidad: 12, unidad: 'm2', precio_unitario: 40, total: 480, categoria: 'alicatado' },
  ]),
}));

// @react-pdf/renderer es solo ESM y Jest no lo carga: el render del PDF se sustituye por un buffer.
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

type Llamada = { messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function: { name: string } }> };

let db: ReturnType<typeof crearFakeDb>;

function preparar(caso: CasoAgente) {
  db = crearFakeDb(crearBaseSimulada());
  (createServiceClient as jest.Mock).mockReturnValue(db.client);
  (createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'pino@example.com' } } }) },
  });

  // Jev (clasificador de intención) simulado.
  process.env.JEV_API_KEY = 'jev-test';
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      answers: { intent: { type: 'choice', choice: caso.intencionJev ?? 'general', confidence: 0.95 } },
    }),
  })) as never;

  createMock.mockReset();
  let n = 0;
  createMock.mockImplementation(async () => {
    n += 1;
    if (n === 1 && caso.toolEsperada && caso.frase !== 'Sí') {
      return {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: caso.toolEsperada, arguments: JSON.stringify(caso.argsEsperados ?? {}) } },
              ],
            },
          },
        ],
      };
    }
    return { choices: [{ message: { content: caso.toolEsperada ? 'Hecho.' : '¿En qué obra lo anoto y qué quieres apuntar?' } }] };
  });
}

async function postAgente(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/agente/route');
  const res = await POST(
    new NextRequest('http://localhost/api/agente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], ...body }),
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const escrituras = () => db.inserts.length + db.updates.length;
const nombresTools = (c: Llamada) => (c.tools ?? []).map((t) => t.function.name);

beforeAll(() => {
  delete process.env.AGENTE_CONFIRMACION; // aquí la barrera está ACTIVA (es lo que se prueba)
  process.env.OPENAI_API_KEY = 'test-key';
});

describe('frases de Pino con OpenAI simulado', () => {
  const normales = CASOS_FRASES_PINO.filter((c) => c.frase !== 'Sí');

  it.each(normales.map((c) => [c.frase, c] as const))('«%s»', async (_frase, caso) => {
    preparar(caso);
    const antes = escrituras();
    const { status, json } = await postAgente({ mensaje: caso.frase });

    expect(status).toBe(200);
    const respuesta = String(json.respuesta ?? '');

    // (a) la tool está disponible para esta intención
    if (caso.toolEsperada) {
      const primera = createMock.mock.calls[0]![0] as Llamada;
      expect(nombresTools(primera)).toContain(caso.toolEsperada);
    }

    // (b) el guardarraíl no la bloquea
    expect(respuesta).not.toMatch(/Requiere validación previa|No se permite crear o convertir/);

    // (c) comportamiento
    switch (caso.comportamiento) {
      case 'pide_confirmacion': {
        const accion = json.accion_pendiente as { tool: string; args: Record<string, unknown>; resumen: string } | undefined;
        expect(accion?.tool).toBe(caso.toolEsperada);
        expect(escrituras()).toBe(antes); // NO escribe nada hasta que el usuario confirme
        expect(respuesta).toMatch(/¿Lo hago\?|\?\s*$/);
        expect(respuesta).not.toMatch(/vuelve a llamar|solo_vista_previa/); // sin instrucciones para el modelo
        // (d) resolución al id del negocio correcto
        for (const [clave, valor] of Object.entries(caso.resueltoA ?? {})) {
          expect(accion?.args[clave]).toBe(valor);
        }
        break;
      }
      case 'pregunta_opciones': {
        expect(json.accion_pendiente).toBeUndefined();
        expect(escrituras()).toBe(antes);
        const opciones = json.opciones as Array<{ n: number; id: string; etiqueta: string }>;
        expect(opciones.length).toBeGreaterThanOrEqual(2);
        expect(respuesta).toMatch(/1\. /);
        expect(respuesta).toMatch(/2\. /);
        expect(respuesta).toContain('<!--opciones:'); // ids para resolver «la 2» en el turno siguiente
        break;
      }
      case 'ejecuta': {
        expect(json.accion_pendiente).toBeUndefined();
        expect(escrituras()).toBeGreaterThan(antes);
        break;
      }
      case 'solo_lectura': {
        expect(json.accion_pendiente).toBeUndefined();
        expect(escrituras()).toBe(antes);
        break;
      }
    }
    for (const texto of caso.respuestaContiene ?? []) expect(respuesta).toContain(texto);

    // (d) lectura de factura: el PDF sale de la carpeta del negocio correcto
    if (caso.resueltoA?.factura_id) {
      expect(db.subidas).toEqual([{ bucket: 'facturas-pdf', path: `${NEGOCIO_A}/${caso.resueltoA.factura_id}.pdf` }]);
    }
  });
});

describe('«Sí» tras una acción pendiente', () => {
  const caso = CASOS_FRASES_PINO.find((c) => c.frase === 'Sí')!;

  it('el panel reenvía confirmar_accion y el servidor la ejecuta sin volver a pasar por el modelo', async () => {
    // 1) Pino pide la factura del presupuesto 7: el servidor la retiene.
    const pedir = CASOS_FRASES_PINO.find((c) => c.frase === 'Hazme la factura del presupuesto 7')!;
    preparar(pedir);
    const { json: pendiente } = await postAgente({ mensaje: pedir.frase });
    const accion = pendiente.accion_pendiente as { tool: string; args: Record<string, unknown> };
    expect(accion.tool).toBe(caso.toolEsperada);
    expect(accion.args.presupuesto_id).toBe(caso.argsEsperados!.presupuesto_id);
    expect(db.tablas.facturas).toHaveLength(2);

    // 2) Dice «sí»: el panel manda confirmar_accion.
    const llamadasModelo = createMock.mock.calls.length;
    const { status, json } = await postAgente({ confirmar_accion: { tool: accion.tool, args: accion.args } });
    expect(status).toBe(200);
    expect(createMock.mock.calls.length).toBe(llamadasModelo); // sin pasar por el modelo
    expect(String(json.respuesta)).toMatch(/Factura nº 4 creada para Paqui/);

    const nueva = db.tablas.facturas.find((f) => f.presupuesto_id === IDS.presupuesto7)!;
    expect(nueva).toMatchObject({ business_id: NEGOCIO_A, numero_factura: 4, cliente_nombre: 'Paqui' });
    expect(db.tablas.presupuestos.find((p) => p.id === IDS.presupuesto7)!.estado).toBe('facturado');
    // El presupuesto nº 7 del otro negocio no se ha tocado.
    expect(db.tablas.presupuestos.find((p) => p.id === IDS.presupuesto7Ajeno)!.estado).toBe('aceptado');
    expect(db.tablas.facturas.some((f) => f.business_id === NEGOCIO_B && f.presupuesto_id)).toBe(false);
  });
});

describe('aislamiento entre negocios', () => {
  it('el nº 7 del negocio B no se alcanza desde el negocio A (ni por confirmar_accion con id ajeno)', async () => {
    preparar(CASOS_FRASES_PINO[0]!);
    const { json } = await postAgente({
      confirmar_accion: { tool: 'convertir_presupuesto_a_factura', args: { presupuesto_id: IDS.presupuesto7Ajeno } },
    });
    expect(String(json.respuesta)).toMatch(/No encuentro ningún presupuesto/);
    expect(db.tablas.facturas.filter((f) => f.presupuesto_id)).toHaveLength(0);
    expect(db.tablas.presupuestos.find((p) => p.id === IDS.presupuesto7Ajeno)!.estado).toBe('aceptado');
  });
});

describe('elegir una opción en el turno siguiente', () => {
  it('«la 2» se resuelve al id exacto de la 2.ª opción (sin depender de que el modelo se acuerde)', async () => {
    const caso = CASOS_FRASES_PINO.find((c) => c.frase === 'Hazme la factura del presupuesto de García')!;
    preparar(caso);
    const { json: pregunta } = await postAgente({ mensaje: caso.frase });
    const opciones = pregunta.opciones as Array<{ n: number; id: string; etiqueta: string }>;
    expect(opciones).toHaveLength(2);
    // El panel NO pinta el comentario con los ids, pero sí lo manda en el historial.
    const respuestaConMarca = String(pregunta.respuesta);
    expect(respuestaConMarca).toContain('<!--opciones:');

    // Turno siguiente: Pino dice «la 2» y el modelo (simulado) ya llama con el id que le llega.
    createMock.mockReset();
    createMock.mockImplementation(async () => ({ choices: [{ message: { content: 'Vale.' } }] }));
    await postAgente({
      mensaje: 'la 2',
      historial: [
        { role: 'user', content: caso.frase },
        { role: 'assistant', content: respuestaConMarca },
      ],
    });
    const primera = createMock.mock.calls[0]![0] as Llamada;
    const usuario = primera.messages.filter((m) => m.role === 'user').pop();
    const texto = JSON.stringify(usuario?.content);
    expect(texto).toContain(`id exacto: ${opciones[1]!.id}`);
    expect(texto).not.toContain('"la 2"');
  });
});
