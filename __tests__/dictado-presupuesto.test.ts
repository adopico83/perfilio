const createMock = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  })),
}));

import { estructurarDictadoEnPartidas } from '@/lib/dictado-presupuesto';

describe('estructurarDictadoEnPartidas', () => {
  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('ignora el total del modelo y lo calcula como cantidad × precio', async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { descripcion: 'Solado', cantidad: 20, unidad: 'm2', precio_unitario: 35, total: 650 },
              { descripcion: 'Rejuntado', cantidad: 3, unidad: 'ud', precio_unitario: 33.333, total: 9999 },
              { descripcion: 'Sin total', cantidad: 2, unidad: 'ud', precio_unitario: 10 },
            ]),
          },
        },
      ],
    });

    const partidas = await estructurarDictadoEnPartidas('solado 20 m2', []);
    expect(partidas.map((p) => p.total)).toEqual([700, 99.99, 20]);
    expect(partidas[1].precio_unitario).toBe(33.33);
  });
});
