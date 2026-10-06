import { NextRequest } from 'next/server';

const removes: string[][] = [];
let anterior: string | null = 'biz-1/logo-1.png';
let updateError: { message: string } | null = null;
let removeError: { message: string } | null = null;

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { logo_url: anterior }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: updateError }) }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async (rutas: string[]) => (removes.push(rutas), { error: removeError }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: null }),
      }),
    },
  }),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: async () => true }));
jest.mock('@/lib/supabase/get-business-id', () => ({ getBusinessIdServer: async () => 'biz-1' }));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
async function subir() {
  const { POST } = await import('@/app/api/negocio/logo/route');
  const form = new FormData();
  form.append('file', new Blob([PNG as BlobPart], { type: 'image/png' }), 'logo.png');
  return POST(new NextRequest('http://x/api/negocio/logo', { method: 'POST', body: form }));
}

beforeEach(() => {
  removes.length = 0;
  anterior = 'biz-1/logo-1.png';
  updateError = null;
  removeError = null;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('logo: no se acumulan ficheros en Storage', () => {
  it('borra el logo anterior tras guardar el nuevo', async () => {
    const res = await subir();
    expect(res.status).toBe(200);
    expect(removes).toEqual([['biz-1/logo-1.png']]);
  });
  it('no borra nada si no había logo, si es de otra carpeta o si es una URL externa', async () => {
    for (const previo of [null, 'otro-negocio/logo.png', 'https://externo.com/logo.png']) {
      anterior = previo;
      expect((await subir()).status).toBe(200);
    }
    expect(removes).toHaveLength(0);
  });
  it('si falla guardar la ruta, borra el recién subido y devuelve el error', async () => {
    updateError = { message: 'rls' };
    const res = await subir();
    expect(res.status).toBe(500);
    expect(removes).toHaveLength(1);
    expect(removes[0][0]).toMatch(/^biz-1\/logo-\d+\.png$/);
    expect(removes[0]).not.toContain('biz-1/logo-1.png');
  });
  it('si falla el borrado del anterior responde ok con aviso', async () => {
    removeError = { message: 'no se pudo' };
    const res = await subir();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.aviso).toMatch(/no se pudo borrar el anterior/);
  });
});
