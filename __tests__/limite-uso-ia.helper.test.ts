import {
  LIMITE_POR_DIA,
  LIMITE_POR_MINUTO,
  comprobarLimiteIA,
  reiniciarContadorEnMemoria,
  respuestaLimiteIA,
} from '@/lib/ia/limite-uso';

const NOW = new Date('2026-10-06T10:15:20Z');

function conRpc(respuestas: Array<{ data?: unknown; error?: { message: string } | null }> | 'siempre-error') {
  const llamadas: Array<Record<string, unknown>> = [];
  let i = 0;
  return {
    llamadas,
    client: {
      rpc: async (_n: string, args: Record<string, unknown>) => {
        llamadas.push(args);
        if (respuestas === 'siempre-error') return { data: null, error: { message: 'function does not exist' } };
        const r = respuestas[Math.min(i++, respuestas.length - 1)];
        return { data: r.data ?? null, error: r.error ?? null };
      },
    } as never,
  };
}

beforeEach(() => {
  reiniciarContadorEnMemoria();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('comprobarLimiteIA', () => {
  it('manda a la función los límites, el minuto y el día de Madrid', async () => {
    const f = conRpc([{ data: { permitido: true } }]);
    expect(await comprobarLimiteIA(f.client, 'u1', 'biz', NOW)).toEqual({ permitido: true });
    expect(f.llamadas[0]).toEqual({
      p_user: 'u1', p_business: 'biz', p_minuto: '2026-10-06T10:15', p_dia: '2026-10-06',
      p_max_minuto: LIMITE_POR_MINUTO, p_max_dia: LIMITE_POR_DIA,
    });
  });
  it('rechazo por minuto: reintentar en lo que queda del minuto', async () => {
    const f = conRpc([{ data: { permitido: false, motivo: 'minuto' } }]);
    expect(await comprobarLimiteIA(f.client, 'u1', 'biz', NOW)).toEqual({ permitido: false, motivo: 'minuto', reintentarEnS: 40 });
  });
  it('rechazo por día: reintentar hasta la medianoche de Madrid', async () => {
    const f = conRpc([{ data: { permitido: false, motivo: 'dia' } }]);
    const r = await comprobarLimiteIA(f.client, 'u1', 'biz', NOW); // 12:15:20 en Madrid
    expect(r).toMatchObject({ permitido: false, motivo: 'dia', reintentarEnS: 86_400 - (12 * 3600 + 15 * 60 + 20) });
  });
  it('si la base falla usa el contador en memoria con los mismos límites', async () => {
    const f = conRpc('siempre-error');
    for (let i = 0; i < LIMITE_POR_MINUTO; i++) expect((await comprobarLimiteIA(f.client, 'u1', 'biz', NOW)).permitido).toBe(true);
    expect(await comprobarLimiteIA(f.client, 'u1', 'biz', NOW)).toMatchObject({ permitido: false, motivo: 'minuto' });
    // otro usuario tiene su propio cupo
    expect((await comprobarLimiteIA(f.client, 'u2', 'biz', NOW)).permitido).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
  it('en memoria también hay tope diario y el minuto siguiente tiene cupo nuevo', async () => {
    const f = conRpc('siempre-error');
    let ultimo = await comprobarLimiteIA(f.client, 'u1', '', NOW);
    for (let i = 1; i < LIMITE_POR_DIA + 1; i++) {
      const t = new Date(NOW.getTime() + i * 60_000); // un minuto distinto cada vez
      ultimo = await comprobarLimiteIA(f.client, 'u1', '', t);
    }
    expect(ultimo).toMatchObject({ permitido: false, motivo: 'dia' });
  });
  it('respuesta inesperada de la función = fallo de base → memoria', async () => {
    const f = conRpc([{ data: { raro: true } }]);
    expect((await comprobarLimiteIA(f.client, 'u1', 'biz', NOW)).permitido).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('respuestaLimiteIA', () => {
  it('429 con Retry-After y el mensaje acordado', async () => {
    const res = respuestaLimiteIA({ permitido: false, motivo: 'minuto', reintentarEnS: 40 });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('40');
    expect(await res.json()).toEqual({ error: 'Has hecho demasiadas consultas a la IA. Prueba de nuevo en 40 s.' });
  });
});
