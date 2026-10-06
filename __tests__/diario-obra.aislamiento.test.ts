import {
  collectDiarioObraStoragePathsFromEntry,
  insertDiarioObraEntry,
  rutaPerteneceANegocio,
  signDiarioObraEntriesMedia,
  validarMediaDelNegocio,
  buildDiarioObraObjectPath,
} from '@/lib/diario-obra';

const A = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const B = '900ed462-7640-4893-9030-a41163219f7a';

describe('el primer segmento de la ruta es el business_id', () => {
  it('buildDiarioObraObjectPath lo pone primero (con o sin subcarpeta de entrada)', () => {
    const base = { businessId: A, contentType: 'image/jpeg', stem: 'foto', now: 1700 };
    expect(buildDiarioObraObjectPath(base)).toBe(`${A}/1700_foto.jpg`);
    expect(buildDiarioObraObjectPath({ ...base, subfolder: 'entrada-1' })).toBe(`${A}/entrada-1/1700_foto.jpg`);
  });
});

describe('rutaPerteneceANegocio', () => {
  it.each([
    [`${A}/1700_foto.jpg`, true],
    [`${A}/entrada/1700_foto.jpg`, true],
    [`https://x.supabase.co/storage/v1/object/sign/diario-obra/${A}/f.jpg?token=t`, true],
    [`${B}/1700_foto.jpg`, false],
    [`https://x.supabase.co/storage/v1/object/sign/diario-obra/${B}/f.jpg?token=t`, false],
    [`${A}/../${B}/f.jpg`, false],
    [`${A}x/f.jpg`, false],
    [`${A}`, false],
    ['', false],
    ['https://externa.example/f.jpg', false],
  ])('%s → %s', (ruta, esperado) => {
    expect(rutaPerteneceANegocio(A, ruta)).toBe(esperado);
  });
});

describe('validarMediaDelNegocio', () => {
  it('vacío o nulo es válido', () => {
    expect(validarMediaDelNegocio(A, undefined)).toEqual({ ok: true });
    expect(validarMediaDelNegocio(A, [])).toEqual({ ok: true });
  });
  it('rechaza una sola ruta ajena aunque haya otras propias, nombrando el campo', () => {
    expect(validarMediaDelNegocio(A, [`${A}/a.jpg`, `${B}/b.jpg`], 'videos')).toEqual({
      ok: false,
      error: 'videos: una de las rutas no pertenece a este negocio',
    });
  });
  it('deja pasar una URL https externa (se descartará al guardar)', () => {
    expect(validarMediaDelNegocio(A, ['https://externa.example/f.jpg'])).toEqual({ ok: true });
  });
});

describe('insertDiarioObraEntry (última línea de defensa)', () => {
  it('no llega a insertar si hay una ruta de otro negocio', async () => {
    const from = jest.fn();
    const r = await insertDiarioObraEntry({ from } as never, {
      business_id: A,
      obra_nombre: 'Obra',
      fotos: [`${B}/b.jpg`],
    });
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/no pertenece/);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('collectDiarioObraStoragePathsFromEntry con negocio', () => {
  const row = { fotos: [`${A}/a.jpg`, `${B}/b.jpg`], videos: [`${B}/v.mp4`, `${A}/v.mp4`] };
  it('sin negocio devuelve todo (compatibilidad)', () => {
    expect(collectDiarioObraStoragePathsFromEntry(row)).toHaveLength(4);
  });
  it('con negocio solo devuelve las suyas: nunca se borran ficheros ajenos', () => {
    expect(collectDiarioObraStoragePathsFromEntry(row, A).sort()).toEqual([`${A}/a.jpg`, `${A}/v.mp4`]);
  });
});

describe('signDiarioObraEntriesMedia', () => {
  it('firma las del negocio, omite las ajenas y respeta lo que no es del bucket', async () => {
    const firmadas: string[] = [];
    const supabase = {
      storage: {
        from: () => ({
          createSignedUrl: async (p: string) => (firmadas.push(p), { data: { signedUrl: `s/${p}` }, error: null }),
        }),
      },
    } as never;
    const [e] = await signDiarioObraEntriesMedia(
      supabase,
      [{ fotos: [`${A}/a.jpg`, `${B}/b.jpg`, 'https://externa.example/f.jpg'], videos: null }],
      A
    );
    expect(firmadas).toEqual([`${A}/a.jpg`]);
    expect(e.fotos).toEqual([`s/${A}/a.jpg`, 'https://externa.example/f.jpg']);
    expect(e.videos).toBeNull();
  });
});
