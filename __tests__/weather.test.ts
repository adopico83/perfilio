/**
 * @jest-environment node
 */

import { getPrediccionPorCiudad } from '@/lib/weather';

describe('lib/weather', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENWEATHER_API_KEY;

  beforeEach(() => {
    process.env.OPENWEATHER_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENWEATHER_API_KEY = originalKey;
  });

  it('getPrediccionPorCiudad devuelve PrediccionMeteo con campos correctos', async () => {
    const baseDt = Math.floor(Date.now() / 1000);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        city: { timezone: 3600 },
        list: [
          {
            dt: baseDt,
            main: { temp: 14, temp_min: 11, temp_max: 17 },
            weather: [{ description: 'cielo claro', icon: '01d', main: 'Clear' }],
            wind: { speed: 4 },
            pop: 0,
          },
          {
            dt: baseDt + 10800,
            main: { temp: 15, temp_min: 11, temp_max: 18 },
            weather: [{ description: 'cielo claro', icon: '01d', main: 'Clear' }],
            wind: { speed: 4 },
            pop: 0,
          },
        ],
      }),
    });

    const preds = await getPrediccionPorCiudad('Madrid');
    expect(preds.length).toBeGreaterThanOrEqual(1);
    const p = preds[0];
    expect(p).toMatchObject({
      descripcion: expect.any(String),
      temp_min: expect.any(Number),
      temp_max: expect.any(Number),
      lluvia: false,
      viento_fuerte: false,
      icono: expect.stringMatching(/[\u2600-\u27BF⛈🌧🌤☀]/),
      recomendacion: expect.any(String),
    });
    expect(p.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.openweathermap.org/data/2.5/forecast')
    );
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('Madrid'));
  });
});
