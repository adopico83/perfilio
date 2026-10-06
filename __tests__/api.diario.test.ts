import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));

function mockAuthAndBusiness() {
  (createClient as jest.Mock).mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: jest.fn((table: string) => {
      if (table === 'business_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === 'business_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'biz-1' }, error: null }),
        };
      }
      return {};
    }),
  });
}

describe('/api/diario', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/diario/route');
    POST = mod.POST;
    GET = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('POST crea entrada correctamente', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'ent-1',
            business_id: 'biz-1',
            obra_nombre: 'Casa García',
            obra_direccion: 'Calle Mayor 1',
            texto: 'Solado terminado',
            fotos: ['https://x/a.jpg'],
            videos: [],
            fecha: '2026-06-15T10:30:00.000Z',
          },
          error: null,
        }),
      })),
    });

    const req = new NextRequest('http://localhost/api/diario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: 'biz-1',
        obra_nombre: 'Casa García',
        obra_direccion: 'Calle Mayor 1',
        texto: 'Solado terminado',
        fotos: ['https://x/a.jpg'],
        videos: [],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entrada).toMatchObject({
      id: 'ent-1',
      obra_nombre: 'Casa García',
      texto: 'Solado terminado',
    });
  });

  describe('POST con obra_id', () => {
    const OBRA = '22222222-2222-4222-8222-222222222222';

    /** Cliente de servicio: `obras` devuelve `obra` y `diario_obra` guarda lo que se inserta. */
    function mockServicio(obra: Record<string, unknown> | null) {
      const insertado: Array<Record<string, unknown>> = [];
      const filtros: Array<[string, unknown]> = [];
      (createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn((tabla: string) => {
          if (tabla === 'obras') {
            const q: Record<string, unknown> = {};
            q.select = () => q;
            q.eq = (c: string, v: unknown) => (filtros.push([c, v]), q);
            q.maybeSingle = async () => ({ data: obra, error: null });
            return q;
          }
          return {
            insert: (row: Record<string, unknown>) => {
              insertado.push(row);
              return { select: () => ({ single: async () => ({ data: { id: 'ent-1', ...row }, error: null }) }) };
            },
          };
        }),
      });
      return { insertado, filtros };
    }
    const post = (body: Record<string, unknown>) =>
      POST(
        new NextRequest('http://localhost/api/diario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );

    it('toma nombre, dirección y cliente de la base, no del navegador', async () => {
      const s = mockServicio({ id: OBRA, nombre: 'Reforma real', direccion: 'Calle Real 5', cliente_id: 'cli-9' });
      const res = await post({
        business_id: 'biz-1',
        obra_id: OBRA,
        obra_nombre: 'Nombre falso',
        obra_direccion: 'Dirección falsa',
        texto: 'Hoy se ha picado',
      });
      expect(res.status).toBe(200);
      expect(s.insertado[0]).toMatchObject({
        obra_id: OBRA,
        obra_nombre: 'Reforma real',
        obra_direccion: 'Calle Real 5',
        cliente_id: 'cli-9',
        business_id: 'biz-1',
      });
      expect(s.filtros).toContainEqual(['business_id', 'biz-1']);
    });

    it('403 si la obra no es de este negocio (o no existe) y no inserta nada', async () => {
      const s = mockServicio(null);
      const res = await post({ business_id: 'biz-1', obra_id: OBRA, texto: 'x' });
      expect(res.status).toBe(403);
      expect(s.insertado).toHaveLength(0);
    });

    it('con obra_id no hace falta obra_nombre', async () => {
      mockServicio({ id: OBRA, nombre: 'Reforma real', direccion: null, cliente_id: null });
      expect((await post({ business_id: 'biz-1', obra_id: OBRA, texto: 'x' })).status).toBe(200);
    });

    it('400 sin obra_id ni obra_nombre', async () => {
      mockServicio(null);
      expect((await post({ business_id: 'biz-1', texto: 'x' })).status).toBe(400);
    });

    it('solo obra_nombre sigue funcionando como antes (sin consultar obras)', async () => {
      const s = mockServicio(null);
      const res = await post({ business_id: 'biz-1', obra_nombre: 'Casa García', texto: 'x' });
      expect(res.status).toBe(200);
      expect(s.filtros).toHaveLength(0);
      expect(s.insertado[0]).toMatchObject({ obra_nombre: 'Casa García', obra_id: null });
    });
  });

  it('GET filtra por obra_nombre', async () => {
    const listado = {
      data: [
        {
          id: 'a1',
          business_id: 'biz-1',
          obra_nombre: 'Obra X',
          obra_direccion: null,
          texto: 't',
          fotos: [],
          videos: [],
          fecha: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    };

    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      then: (onFulfilled: (v: typeof listado) => unknown) =>
        Promise.resolve(listado).then(onFulfilled),
    };

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => builder),
    });

    const req = new NextRequest(
      'http://localhost/api/diario?business_id=biz-1&obra_nombre=Obra%20X'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entradas).toHaveLength(1);
    expect(json.entradas[0].obra_nombre).toBe('Obra X');
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1');
    expect(builder.eq).toHaveBeenCalledWith('obra_nombre', 'Obra X');
  });

  it('GET sin obra_nombre devuelve entradas agrupadas por obra', async () => {
    const listado = {
      data: [
        {
          id: 'e1',
          business_id: 'biz-1',
          obra_nombre: 'Obra Alpha',
          obra_direccion: 'Calle 1',
          texto: 'Nota A',
          fotos: [],
          videos: [],
          fecha: '2026-02-01T12:00:00.000Z',
        },
        {
          id: 'e2',
          business_id: 'biz-1',
          obra_nombre: 'Obra Beta',
          obra_direccion: null,
          texto: 'Nota B',
          fotos: [],
          videos: [],
          fecha: '2026-02-02T12:00:00.000Z',
        },
      ],
      error: null,
    };

    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      then: (onFulfilled: (v: typeof listado) => unknown) =>
        Promise.resolve(listado).then(onFulfilled),
    };

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => builder),
    });

    const req = new NextRequest('http://localhost/api/diario?business_id=biz-1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entradas).toBeUndefined();
    expect(json.agrupado_por_obra).toBeDefined();
    expect(json.agrupado_por_obra['Obra Alpha']).toHaveLength(1);
    expect(json.agrupado_por_obra['Obra Beta']).toHaveLength(1);
    expect(json.agrupado_por_obra['Obra Alpha'][0].texto).toBe('Nota A');
    expect(builder.eq).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1');
  });
});
