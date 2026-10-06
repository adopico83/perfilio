import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  AGENTE_MODELO_POR_DEFECTO,
  modeloAdmiteTemperature,
  modeloAgente,
  parametrosGeneracion,
} from '@/lib/agente/modelo';
import { NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

const ORIGINAL = process.env.AGENTE_MODELO;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENTE_MODELO;
  else process.env.AGENTE_MODELO = ORIGINAL;
});

describe('modeloAgente', () => {
  it('sin variable → gpt-4o-mini', () => {
    delete process.env.AGENTE_MODELO;
    expect(modeloAgente()).toBe('gpt-4o-mini');
    expect(AGENTE_MODELO_POR_DEFECTO).toBe('gpt-4o-mini');
  });
  it('con AGENTE_MODELO → ese modelo (sin espacios); vacía → el de siempre', () => {
    process.env.AGENTE_MODELO = '  gpt-4.1-mini ';
    expect(modeloAgente()).toBe('gpt-4.1-mini');
    process.env.AGENTE_MODELO = '   ';
    expect(modeloAgente()).toBe('gpt-4o-mini');
  });
});

describe('parámetros compatibles con cualquier modelo', () => {
  it('usa max_completion_tokens (nunca max_tokens)', () => {
    const p = parametrosGeneracion('gpt-4o-mini', { maxTokens: 800, temperature: 0 });
    expect(p).toEqual({ max_completion_tokens: 800, temperature: 0 });
    expect(p).not.toHaveProperty('max_tokens');
  });
  it.each(['o1', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'GPT-5.1'])('%s no admite temperature', (m) => {
    expect(modeloAdmiteTemperature(m)).toBe(false);
    expect(parametrosGeneracion(m, { maxTokens: 100, temperature: 0.7 })).toEqual({ max_completion_tokens: 100 });
  });
  it.each(['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'])('%s sí admite temperature', (m) => {
    expect(modeloAdmiteTemperature(m)).toBe(true);
  });
});

describe('las tres llamadas del turno usan el modelo configurado', () => {
  beforeEach(() => {
    const db = crearFakeDb(crearBaseSimulada());
    (createServiceClient as jest.Mock).mockReturnValue(db.client);
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) },
    });
    delete process.env.JEV_API_KEY;
    process.env.OPENAI_API_KEY = 'k';
    createMock.mockReset();
  });
  const post = async (mensaje: string) => {
    const { POST } = await import('@/app/api/agente/route');
    return POST(
      new NextRequest('http://localhost/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], mensaje }),
      })
    );
  };
  const toolCall = (name: string) => ({
    choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: '{}' } }] } }],
  });
  const sinTools = { choices: [{ message: { content: 'Vale.' } }] };

  it('sin variable: gpt-4o-mini en turno con tools, reintento «required» y prosa final', async () => {
    delete process.env.AGENTE_MODELO;
    // 1) sin tool_calls pese a pedir acción → 2) reintento con tool_choice required → 3) prosa final
    createMock.mockResolvedValueOnce(sinTools).mockResolvedValueOnce(toolCall('obtener_facturas_pendientes')).mockResolvedValueOnce(sinTools);
    await post('lista las facturas pendientes');
    expect(createMock).toHaveBeenCalledTimes(3);
    const params = createMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(params.map((p) => p.model)).toEqual(['gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o-mini']);
    expect(params[1]!.tool_choice).toBe('required');
    for (const p of params) {
      expect(p).toHaveProperty('max_completion_tokens');
      expect(p).not.toHaveProperty('max_tokens');
      expect(p).toHaveProperty('temperature');
    }
  });

  it('con AGENTE_MODELO=gpt-4.1-mini se manda ese modelo en las tres', async () => {
    process.env.AGENTE_MODELO = 'gpt-4.1-mini';
    createMock.mockResolvedValueOnce(sinTools).mockResolvedValueOnce(toolCall('obtener_facturas_pendientes')).mockResolvedValueOnce(sinTools);
    await post('lista las facturas pendientes');
    expect(createMock.mock.calls.map((c) => (c[0] as { model: string }).model)).toEqual(['gpt-4.1-mini', 'gpt-4.1-mini', 'gpt-4.1-mini']);
  });

  it('con un modelo de razonamiento (gpt-5-mini) no se manda temperature en ninguna', async () => {
    process.env.AGENTE_MODELO = 'gpt-5-mini';
    createMock.mockResolvedValueOnce(sinTools).mockResolvedValueOnce(toolCall('obtener_facturas_pendientes')).mockResolvedValueOnce(sinTools);
    await post('lista las facturas pendientes');
    for (const c of createMock.mock.calls) {
      expect(c[0]).not.toHaveProperty('temperature');
      expect(c[0]).toHaveProperty('max_completion_tokens');
    }
  });
});
