jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

import {
  JEV_INTENT_CATEGORIES,
  JEV_INTENT_MODEL,
  JEV_SYSTEMONE_URL,
  mapJevChoiceToAgentIntent,
  parseAgentIntentCategory,
} from '@/lib/agente/router';

function jevBody(choice: string, confidence: number) {
  return {
    model: 'jev-1.13.0',
    answers: {
      intent: {
        type: 'choice',
        choice,
        confidence,
        probabilities: { [choice]: confidence },
      },
    },
    usage: { input_tokens: 20, output_tokens: 0 },
  };
}

describe('mapJevChoiceToAgentIntent', () => {
  it.each([
    ['presupuesto', 'presupuesto'],
    ['factura', 'documentos'],
    ['diario', 'diario'],
    ['horas', 'operarios'],
    ['gastos', 'gastos'],
    ['obras', 'documentos'],
    ['clientes', 'clientes'],
    ['correo', 'emails'],
    ['agenda', 'agenda'],
    ['general', 'general'],
  ] as const)('mapea %s con confianza 0.7', (choice, expected) => {
    expect(mapJevChoiceToAgentIntent(choice, 0.7)).toBe(expected);
  });

  it('confianza por debajo de 0.7 cae a general', () => {
    expect(mapJevChoiceToAgentIntent('horas', 0.69)).toBe('general');
    expect(mapJevChoiceToAgentIntent('presupuesto', 0)).toBe('general');
  });

  it('choice desconocida o confidence no numérica cae a general', () => {
    expect(mapJevChoiceToAgentIntent('calculo', 0.99)).toBe('general');
    expect(mapJevChoiceToAgentIntent('horas', '0.99')).toBe('general');
    expect(mapJevChoiceToAgentIntent(null, 0.99)).toBe('general');
  });
});

describe('parseAgentIntentCategory', () => {
  const prevKey = process.env.JEV_API_KEY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (prevKey === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = prevKey;
  });

  it('pide a Jev una question choice con las 10 categorías y mapea la respuesta', async () => {
    process.env.JEV_API_KEY = 'jev-test-key';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(jevBody('horas', 0.91)), { status: 200 }));

    await expect(
      parseAgentIntentCategory('Registra 8 horas de Juan', {
        borradorActivo: true,
        ultimoAsistente: '¿De qué operario?',
      })
    ).resolves.toBe('operarios');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(JEV_SYSTEMONE_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jev-test-key');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(JEV_INTENT_MODEL);
    expect(body.questions.intent.type).toBe('choice');
    expect(Object.keys(body.questions.intent.criteria)).toEqual([...JEV_INTENT_CATEGORIES]);
    expect(body.state).toContain('Registra 8 horas de Juan');
    expect(body.state).toMatch(/borrador de presupuesto/i);
    expect(body.state).toContain('¿De qué operario?');
  });

  it('confidence < 0.7 devuelve general', async () => {
    process.env.JEV_API_KEY = 'jev-test-key';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(jevBody('factura', 0.69)), { status: 200 }));

    await expect(parseAgentIntentCategory('una factura')).resolves.toBe('general');
  });

  it('sin API key no llama a la red y devuelve general', async () => {
    delete process.env.JEV_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(parseAgentIntentCategory('hola')).resolves.toBe('general');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('error de red, HTTP no ok o cuerpo inválido devuelven general', async () => {
    process.env.JEV_API_KEY = 'jev-test-key';
    const fetchMock = jest.spyOn(global, 'fetch');

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(parseAgentIntentCategory('hola')).resolves.toBe('general');

    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
    await expect(parseAgentIntentCategory('hola')).resolves.toBe('general');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ answers: { intent: { type: 'noul', noul: 1 } } }), {
        status: 200,
      })
    );
    await expect(parseAgentIntentCategory('hola')).resolves.toBe('general');
  });
});
