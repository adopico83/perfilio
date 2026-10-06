import { NextRequest } from 'next/server';

const mockUser = jest.fn();
const mockOwns = jest.fn();
const mockBusinessIdServer = jest.fn();
const updates: Array<{ tabla: string; valores: Record<string, unknown>; id: unknown }> = [];
const uploads: Array<{ bucket: string; path: string; type: unknown }> = [];
let uploadError: { message: string } | null = null;

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockUser() } }),
  createServiceClient: () => ({
    from: (tabla: string) => ({
      update: (valores: Record<string, unknown>) => ({
        eq: async (_c: string, id: unknown) => (updates.push({ tabla, valores, id }), { error: null }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { razon_social: 'Pino', logo_url: 'biz-1/logo.png', marca_tipografia: 'Courier' }, error: null }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _b: unknown, opts: { contentType: string }) => (uploads.push({ bucket, path, type: opts.contentType }), { error: uploadError }),
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
  }),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: (...a: unknown[]) => mockOwns(...a) }));
jest.mock('@/lib/supabase/get-business-id', () => ({ getBusinessIdServer: () => mockBusinessIdServer() }));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  uploads.length = 0;
  uploadError = null;
  mockUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockOwns.mockResolvedValue(true);
  mockBusinessIdServer.mockResolvedValue('biz-1');
});

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/negocio/marca/route');
  return PATCH(new NextRequest('http://x/api/negocio/marca', { method: 'PATCH', body: JSON.stringify(body) }));
};

describe('PATCH /api/negocio/marca', () => {
  it('401 sin sesión', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await patch({ nif: 'x' })).status).toBe(401);
  });
  it('403 si el business_id pedido no es del usuario, y no escribe', async () => {
    mockOwns.mockResolvedValue(false);
    const res = await patch({ business_id: 'otro-negocio', nif: 'x' });
    expect(res.status).toBe(403);
    expect(mockOwns).toHaveBeenCalledWith(expect.anything(), 'u1', 'otro-negocio');
    expect(updates).toHaveLength(0);
  });
  it('400 con color o tipografía inválidos (misma validación que los CHECK)', async () => {
    expect((await patch({ marca_color_primario: 'rojo' })).status).toBe(400);
    expect((await patch({ marca_tipografia: 'Arial' })).status).toBe(400);
    expect((await patch({ marca_observaciones_presupuesto: 'x'.repeat(1001) })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('400 si no hay nada que guardar', async () => {
    expect((await patch({ id: 'x', logo_url: 'hack' })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('guarda solo columnas de la lista blanca, sobre el negocio del usuario', async () => {
    const res = await patch({
      id: 'otro-id',
      user_id: 'otro-user',
      logo_url: '../../x',
      nif: ' B123 ',
      marca_color_primario: '#AABBCC',
      marca_tipografia: '',
    });
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      {
        tabla: 'business_profiles',
        valores: { nif: 'B123', marca_color_primario: '#AABBCC', marca_tipografia: null },
        id: 'biz-1',
      },
    ]);
  });
});

describe('GET /api/negocio/marca', () => {
  it('devuelve ajustes y logo firmado, sin exponer la ruta interna del logo', async () => {
    const { GET } = await import('@/app/api/negocio/marca/route');
    const res = await GET(new NextRequest('http://x/api/negocio/marca'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ajustes).toMatchObject({ razon_social: 'Pino', marca_tipografia: 'Courier' });
    expect(json.ajustes).not.toHaveProperty('logo_url');
    expect(json.logo_url_firmada).toBe('https://signed/biz-1/logo.png');
  });
  it('401 sin sesión', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import('@/app/api/negocio/marca/route');
    expect((await GET(new NextRequest('http://x/api/negocio/marca'))).status).toBe(401);
  });
});

async function subir(bytes: Uint8Array, nombre = 'logo.png', extra: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/negocio/logo/route');
  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart], { type: 'image/png' }), nombre);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return POST(new NextRequest('http://x/api/negocio/logo', { method: 'POST', body: form }));
}

describe('POST /api/negocio/logo', () => {
  it('sube un PNG a business-assets/{business_id}/logo-*.png y guarda la ruta', async () => {
    const res = await subir(PNG);
    expect(res.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ bucket: 'business-assets', type: 'image/png' });
    expect(uploads[0].path).toMatch(/^biz-1\/logo-\d+\.png$/);
    expect(updates[0]).toMatchObject({ tabla: 'business_profiles', id: 'biz-1', valores: { logo_url: uploads[0].path } });
    expect((await res.json()).logo_url_firmada).toContain('https://signed/biz-1/logo-');
  });
  it('rechaza un archivo que no es png/jpeg/webp aunque se llame logo.png', async () => {
    const res = await subir(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(res.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });
  it('rechaza más de 2 MB con 413', async () => {
    const grande = new Uint8Array(2 * 1024 * 1024 + 1);
    grande.set(PNG);
    expect((await subir(grande)).status).toBe(413);
    expect(uploads).toHaveLength(0);
  });
  it('403 si el business_id no es del usuario', async () => {
    mockOwns.mockResolvedValue(false);
    expect((await subir(PNG, 'a.png', { business_id: 'ajeno' })).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });
  it('401 sin sesión', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await subir(PNG)).status).toBe(401);
  });
  it('si Storage falla, error 500 y no guarda la ruta', async () => {
    uploadError = { message: 'bucket not found' };
    expect((await subir(PNG)).status).toBe(500);
    expect(updates).toHaveLength(0);
  });
  it('sin archivo, 400', async () => {
    const { POST } = await import('@/app/api/negocio/logo/route');
    const form = new FormData();
    form.append('business_id', 'biz-1');
    expect((await POST(new NextRequest('http://x/api/negocio/logo', { method: 'POST', body: form }))).status).toBe(400);
  });
});
