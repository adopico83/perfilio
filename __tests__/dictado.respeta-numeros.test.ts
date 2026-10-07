import { DictadoIncompletoError, estructurarDictadoEnPartidas } from '@/lib/dictado-presupuesto';

const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

const responde = (partidas: unknown) => createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(partidas) } }] });
const tarifas = [{ nombre: 'Alicatado de azulejo', unidad: 'm2', precio: 35, categoria: 'alicatado' }];

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});
beforeEach(() => createMock.mockReset());

describe('estructurarDictadoEnPartidas', () => {
  it('«alicatar 16 metros a 34»: aunque el modelo ponga 35 (la tarifa), sale 16 × 34', async () => {
    responde([{ descripcion: 'Alicatado', cantidad: 16, unidad: 'm2', precio_unitario: 35, categoria: 'alicatado' }]);
    const r = await estructurarDictadoEnPartidas('alicatar 16 metros a 34', tarifas);
    expect(r[0]).toMatchObject({ cantidad: 16, precio_unitario: 34, total: 544 });
  });

  it('sin cantidad NO se inventa una: se pregunta (y se dice de qué partida)', async () => {
    responde([{ descripcion: 'Demolición de tabique', cantidad: null, unidad: 'm2', precio_unitario: 18, categoria: 'demolicion' }]);
    const intento = estructurarDictadoEnPartidas('demolición de tabique', tarifas);
    await expect(intento).rejects.toBeInstanceOf(DictadoIncompletoError);
    responde([{ descripcion: 'Demolición de tabique', cantidad: null, unidad: 'm2', precio_unitario: 18, categoria: 'demolicion' }]);
    await expect(estructurarDictadoEnPartidas('demolición de tabique', tarifas)).rejects.toThrow(/Me falta la cantidad de «Demolición de tabique»/);
  });

  it('el prompt ya no manda estimar cantidades y exige copiar los números dichos', async () => {
    responde([{ descripcion: 'Alicatado', cantidad: 16, unidad: 'm2', precio_unitario: 34, categoria: 'alicatado' }]);
    await estructurarDictadoEnPartidas('alicatar 16 metros a 34', tarifas);
    const sistema = String(createMock.mock.calls[0]![0].messages[0].content);
    expect(sistema).not.toMatch(/estima una cantidad razonable/i);
    expect(sistema).toMatch(/cantidad: null/);
    expect(sistema).toMatch(/EXACTOS/);
  });

  it('con cantidad pero sin precio se usa la tarifa (lo único que se permite)', async () => {
    responde([{ descripcion: 'Enfoscado', cantidad: 20, unidad: 'm2', precio_unitario: 22, categoria: 'enfoscado' }]);
    const r = await estructurarDictadoEnPartidas('enfoscado 20m2', tarifas);
    expect(r[0]).toMatchObject({ cantidad: 20, precio_unitario: 22 });
  });
});
