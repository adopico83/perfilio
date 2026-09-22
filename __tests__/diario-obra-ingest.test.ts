import { lookup } from 'node:dns/promises';
import {
  removeDiarioObraStorageObjects,
  uploadDiarioObraMediaToBucket,
} from '@/lib/diario-obra';
import {
  createDiarioObraSignedUpload,
  ingestDiarioObraFotos,
} from '@/lib/diario-obra-ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

jest.mock('@/lib/diario-obra', () => {
  const actual = jest.requireActual('@/lib/diario-obra');
  return {
    ...actual,
    uploadDiarioObraMediaToBucket: jest.fn(),
    removeDiarioObraStorageObjects: jest.fn().mockResolvedValue(undefined),
  };
});

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;
const uploadMock = uploadDiarioObraMediaToBucket as jest.MockedFunction<
  typeof uploadDiarioObraMediaToBucket
>;
const removeMock = removeDiarioObraStorageObjects as jest.MockedFunction<
  typeof removeDiarioObraStorageObjects
>;

const ENTRADA = '11111111-1111-4111-8111-111111111111';
const BIZ = 'biz-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function imageResponse(body: Buffer, headers?: Record<string, string>, status = 200) {
  const headerMap = new Map(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: body };
        },
        cancel: async () => undefined,
      }),
      cancel: async () => undefined,
    },
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

function redirectResponse(location: string, status = 302) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    body: { cancel: async () => undefined },
  };
}

function createSupabase(opts?: {
  missing?: boolean;
  fotos?: string[] | null;
  updateError?: string;
  signedUrl?: string | null;
  objects?: Record<string, { size: number; contentType: string | null }>;
  signedUploadPath?: string | null;
  signedUploadError?: string;
}) {
  let fotos = opts?.fotos === undefined ? ['biz/prev.jpg'] : opts.fotos;
  const updates: string[][] = [];
  const infoCalls: string[] = [];
  const signedUploadCalls: Array<{ bucket: string; path: string; upsert?: boolean }> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'diario_obra') throw new Error(`tabla inesperada: ${table}`);
      return {
        select() {
          const filters: Record<string, string> = {};
          const api = {
            eq(col: string, val: string) {
              filters[col] = val;
              return api;
            },
            async maybeSingle() {
              if (opts?.missing) return { data: null, error: null };
              if (filters.id !== ENTRADA || filters.business_id !== BIZ) {
                return { data: null, error: null };
              }
              return {
                data: { id: ENTRADA, fotos: fotos ? [...fotos] : null },
                error: null,
              };
            },
          };
          return api;
        },
        update(payload: { fotos: string[] }) {
          const filters: Record<string, string> = {};
          const api = {
            eq(col: string, val: string) {
              filters[col] = val;
              return api;
            },
            then(resolve: (value: { error: { message: string } | null }) => void) {
              if (opts?.updateError) {
                resolve({ error: { message: opts.updateError } });
                return;
              }
              if (filters.id !== ENTRADA || filters.business_id !== BIZ) {
                resolve({ error: { message: 'no row' } });
                return;
              }
              fotos = [...payload.fotos];
              updates.push([...payload.fotos]);
              resolve({ error: null });
            },
          };
          return api;
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string) {
            if (bucket !== 'diario-obra') throw new Error(bucket);
            if (opts?.signedUrl === null) return { data: null, error: { message: 'sign' } };
            return {
              data: { signedUrl: opts?.signedUrl ?? `https://signed.example/${path}` },
              error: null,
            };
          },
          async createSignedUploadUrl(path: string, options?: { upsert?: boolean }) {
            if (bucket !== 'diario-obra') throw new Error(bucket);
            signedUploadCalls.push({ bucket, path, upsert: options?.upsert });
            if (opts?.signedUploadError) {
              return { data: null, error: { message: opts.signedUploadError } };
            }
            const echoed = opts?.signedUploadPath === undefined ? path : opts.signedUploadPath;
            return {
              data: {
                signedUrl: `https://upload.example/object/upload/sign/${bucket}/${path}?token=tok-1`,
                token: 'tok-1',
                path: echoed,
              },
              error: null,
            };
          },
          async info(path: string) {
            if (bucket !== 'diario-obra') throw new Error(bucket);
            infoCalls.push(path);
            if (opts?.objects) {
              const found = opts.objects[path];
              if (!found) return { data: null, error: { message: 'not found' } };
              return {
                data: { size: found.size, contentType: found.contentType },
                error: null,
              };
            }
            return { data: { size: 1024, contentType: 'image/jpeg' }, error: null };
          },
          async remove() {
            return { error: null };
          },
        };
      },
    },
    updates: () => updates,
    infoCalls: () => infoCalls,
    signedUploadCalls: () => signedUploadCalls,
  };
  return supabase;
}

describe('ingestDiarioObraFotos', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    uploadMock.mockImplementation(async (_supabase, params) => ({
      path: `${BIZ}/${params.stem}.jpg`,
    }));
    removeMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(async () =>
      imageResponse(JPEG, { 'content-type': 'image/jpeg' })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('descarga https, sube al bucket y conserva las fotos ya guardadas', async () => {
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/fotos/fachada%20norte.jpg' }],
    });

    expect(result).toEqual({
      ok: true,
      entrada_id: ENTRADA,
      items: [
        {
          url: 'https://cdn.example.com/fotos/fachada%20norte.jpg',
          path: `${BIZ}/fachada_norte.jpg`,
          signedUrl: `https://signed.example/${BIZ}/fachada_norte.jpg`,
        },
      ],
    });
    expect(lookupMock).toHaveBeenCalledWith('cdn.example.com', { all: true });
    expect(uploadMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        businessId: BIZ,
        contentType: 'image/jpeg',
        stem: 'fachada_norte',
      })
    );
    expect(supabase.updates()).toEqual([['biz/prev.jpg', `${BIZ}/fachada_norte.jpg`]]);
  });

  it('sigue un redirect https y vuelve a comprobar el host', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://img.example.com/obra/foto.jpg'))
      .mockResolvedValueOnce(imageResponse(JPEG, { 'content-type': 'image/jpeg' }));
    const supabase = createSupabase({ fotos: null });

    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/go' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lookupMock).toHaveBeenCalledWith('img.example.com', { all: true });
    expect(result).toMatchObject({
      ok: true,
      items: [{ path: `${BIZ}/go.jpg` }],
    });
    expect(supabase.updates()).toEqual([[`${BIZ}/go.jpg`]]);
  });

  it('es best-effort: una URL inválida no impide guardar las demás', async () => {
    uploadMock
      .mockResolvedValueOnce({ path: `${BIZ}/1.jpg` })
      .mockResolvedValueOnce({ path: `${BIZ}/2.jpg` });
    const supabase = createSupabase({ fotos: [] });

    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [
        { type: 'url', url: 'https://cdn.example.com/a.jpg' },
        { type: 'url', url: 'http://cdn.example.com/b.jpg' },
        { type: 'url', url: 'https://cdn.example.com/c.jpg' },
      ],
    });

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      entrada_id: ENTRADA,
      items: [
        {
          url: 'https://cdn.example.com/a.jpg',
          path: `${BIZ}/1.jpg`,
          signedUrl: `https://signed.example/${BIZ}/1.jpg`,
        },
        {
          url: 'https://cdn.example.com/c.jpg',
          path: `${BIZ}/2.jpg`,
          signedUrl: `https://signed.example/${BIZ}/2.jpg`,
        },
      ],
      errors: [
        {
          url: 'http://cdn.example.com/b.jpg',
          error: 'Solo se admiten URLs https.',
        },
      ],
    });
    expect(supabase.updates().at(-1)).toEqual([`${BIZ}/1.jpg`, `${BIZ}/2.jpg`]);
  });

  it('acepta un buffer ya en memoria por el mismo camino de storage', async () => {
    const supabase = createSupabase({ fotos: ['biz/prev.jpg'] });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [
        {
          type: 'buffer',
          buffer: JPEG,
          contentType: 'image/jpeg',
          fileName: 'desde-app.jpg',
        },
      ],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ contentType: 'image/jpeg', stem: 'desde-app' })
    );
    expect(result).toMatchObject({
      ok: true,
      items: [{ path: `${BIZ}/desde-app.jpg` }],
    });
  });

  it('falla cerrado si la entrada no es del negocio, sin descargar ni subir', async () => {
    const supabase = createSupabase({ missing: true });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/a.jpg' }],
    });

    expect(result).toEqual({
      error: 'Entrada de diario no encontrada o no pertenece a este negocio',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://localhost/a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://10.0.0.8/a.jpg',
    'https://192.168.1.20/a.jpg',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/computeMetadata/v1/',
  ])('bloquea %s sin hacer fetch', async (url) => {
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ url, error: 'Host no permitido (red privada, local o de metadatos).' }],
    });
  });

  it('rechaza un nombre que resuelve a una IP privada', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.9.9.9', family: 4 }] as never);
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://interno.example.com/a.jpg' }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'Host no permitido (red privada, local o de metadatos).' }],
    });
  });

  it('no sigue un redirect hacia una IP de metadatos', async () => {
    fetchMock.mockResolvedValueOnce(
      redirectResponse('https://169.254.169.254/latest/meta-data')
    );
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/a.jpg' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'Host no permitido (red privada, local o de metadatos).' }],
    });
  });

  it('rechaza Content-Length por encima de 10 MB antes de leer el cuerpo', async () => {
    fetchMock.mockResolvedValueOnce(
      imageResponse(JPEG, {
        'content-type': 'image/jpeg',
        'content-length': String(10 * 1024 * 1024 + 1),
      })
    );
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/grande.jpg' }],
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'La foto supera el tamaño máximo permitido (10 MB).' }],
    });
  });

  it('rechaza el cuerpo si supera 10 MB aunque no venga Content-Length', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: { byteLength: 10 * 1024 * 1024 + 1 } }),
          cancel: async () => undefined,
        }),
      },
    });
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/grande.jpg' }],
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'La foto supera el tamaño máximo permitido (10 MB).' }],
    });
  });

  it('rechaza bytes que no son una imagen permitida', async () => {
    fetchMock.mockResolvedValueOnce(
      imageResponse(Buffer.from('<html></html>'), { 'content-type': 'text/html' })
    );
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/pagina' }],
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'El archivo no es una imagen jpeg, png, webp, gif o heic.' }],
    });
  });

  it('rechaza si el Content-Type no coincide con los magic bytes', async () => {
    fetchMock.mockResolvedValueOnce(
      imageResponse(JPEG, { 'content-type': 'image/png' })
    );
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/a.jpg' }],
    });

    expect(result).toMatchObject({
      ok: false,
      errors: [{ error: 'El tipo declarado no coincide con el contenido de la imagen.' }],
    });
  });

  it('reconoce heic por la marca ftyp aunque el Content-Type sea genérico', async () => {
    const heic = Buffer.alloc(16);
    heic.write('ftyp', 4, 'ascii');
    heic.write('heic', 8, 'ascii');
    fetchMock.mockResolvedValueOnce(
      imageResponse(heic, { 'content-type': 'application/octet-stream' })
    );
    const supabase = createSupabase();
    await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/foto.heic' }],
    });

    expect(uploadMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ contentType: 'image/heic', stem: 'foto' })
    );
  });

  it('si la fila no se actualiza, borra el objeto subido y reporta el ítem', async () => {
    const supabase = createSupabase({ updateError: 'update falló' });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/a.jpg' }],
    });

    expect(removeMock).toHaveBeenCalledWith(supabase, [`${BIZ}/a.jpg`]);
    expect(result).toEqual({
      ok: false,
      entrada_id: ENTRADA,
      items: [],
      errors: [{ url: 'https://cdn.example.com/a.jpg', error: 'update falló' }],
    });
  });

  it('devuelve la ruta aunque no se pueda firmar la URL', async () => {
    const supabase = createSupabase({ signedUrl: null });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'url', url: 'https://cdn.example.com/a.jpg' }],
    });

    expect(result).toEqual({
      ok: true,
      entrada_id: ENTRADA,
      items: [{ url: 'https://cdn.example.com/a.jpg', path: `${BIZ}/a.jpg` }],
    });
  });

  it('rechaza más de 8 fotos antes de descargar', async () => {
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: Array.from({ length: 9 }, (_, i) => ({
        type: 'url' as const,
        url: `https://cdn.example.com/${i}.jpg`,
      })),
    });

    expect(result).toEqual({ error: 'foto_urls admite como máximo 8 fotos.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createDiarioObraSignedUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve una ruta bajo el businessId y la URL firmada del bucket diario-obra', async () => {
    const supabase = createSupabase();
    const result = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/jpeg',
      fileName: 'fachada norte.jpg',
    });

    expect(result).toEqual({
      upload_url: expect.stringMatching(/^https:\/\/upload\.example\/object\/upload\/sign\/diario-obra\/biz-1\//),
      path: expect.stringMatching(/^biz-1\/\d+_[0-9a-f]{8}_fachada_norte\.jpg$/),
      token: 'tok-1',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      max_bytes: 10 * 1024 * 1024,
    });
    expect(supabase.signedUploadCalls()).toEqual([
      expect.objectContaining({
        bucket: 'diario-obra',
        upsert: false,
        path: (result as { path: string }).path,
      }),
    ]);
  });

  it('cuelga la ruta de la entrada si pertenece al negocio', async () => {
    const supabase = createSupabase();
    const result = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/png',
      entradaId: ENTRADA,
    });

    expect(result).toMatchObject({
      path: expect.stringMatching(new RegExp(`^${BIZ}/${ENTRADA}/\\d+_[0-9a-f]{8}_diario_foto\\.png$`)),
      headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
    });
  });

  it('normaliza image/jpg y image/heif', async () => {
    const supabase = createSupabase();
    const jpeg = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/jpg',
    });
    const heif = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/heif',
    });
    expect(jpeg).toMatchObject({
      path: expect.stringMatching(/\.jpg$/),
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(heif).toMatchObject({
      path: expect.stringMatching(/\.heic$/),
      headers: { 'content-type': 'image/heic' },
    });
  });

  it('rechaza mime que no es foto y no pide URL firmada', async () => {
    const supabase = createSupabase();
    const result = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'video/mp4',
    });
    expect(result).toEqual({
      error: 'Tipo de imagen no permitido. Usa jpeg, png, webp, gif o heic.',
    });
    expect(supabase.signedUploadCalls()).toEqual([]);
  });

  it('falla cerrado si la entrada no es del negocio', async () => {
    const supabase = createSupabase({ missing: true });
    const result = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/webp',
      entradaId: ENTRADA,
    });
    expect(result).toEqual({
      error: 'Entrada de diario no encontrada o no pertenece a este negocio',
    });
    expect(supabase.signedUploadCalls()).toEqual([]);
  });

  it('rechaza una URL firmada cuya ruta no es la del negocio', async () => {
    const supabase = createSupabase({ signedUploadPath: 'otro-negocio/foto.jpg' });
    const result = await createDiarioObraSignedUpload(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      mimeType: 'image/gif',
    });
    expect(result).toEqual({ error: 'La URL firmada no coincide con la ruta del negocio.' });
  });
});

describe('ingestDiarioObraFotos — storage_paths', () => {
  const okPath = `${BIZ}/1700000000000_fachada.jpg`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adjunta una ruta del negocio sin volver a subir ni descargar', async () => {
    const supabase = createSupabase({
      fotos: ['biz/prev.jpg'],
      objects: { [okPath]: { size: 2048, contentType: 'image/jpeg' } },
    });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'storage_path', path: `  ${okPath}  ` }],
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      entrada_id: ENTRADA,
      items: [{ path: okPath, signedUrl: `https://signed.example/${okPath}` }],
    });
    expect(supabase.updates()).toEqual([['biz/prev.jpg', okPath]]);
    expect(supabase.infoCalls()).toEqual([okPath]);
  });

  it.each([
    ['otro-negocio/foto.jpg', 'La ruta no pertenece a este negocio.'],
    [`${BIZ}-evil/foto.jpg`, 'La ruta no pertenece a este negocio.'],
    [`${BIZ}/../otro/foto.jpg`, 'Ruta de storage no permitida.'],
    [`../${BIZ}/foto.jpg`, 'Ruta de storage no permitida.'],
    [`/${BIZ}/foto.jpg`, 'Ruta de storage no permitida.'],
    [`${BIZ}/%2e%2e/otro.jpg`, 'Ruta de storage no permitida.'],
    [`https://cdn.example.com/${BIZ}/foto.jpg`, 'Ruta de storage no permitida.'],
    [`${BIZ}/./foto.jpg`, 'Ruta de storage no permitida.'],
    [`${BIZ}//foto.jpg`, 'Ruta de storage no permitida.'],
  ])('rechaza %s', async (path, error) => {
    const supabase = createSupabase({ fotos: ['biz/prev.jpg'] });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'storage_path', path }],
    });

    expect(result).toEqual({
      ok: false,
      entrada_id: ENTRADA,
      items: [],
      errors: [{ path, error }],
    });
    expect(supabase.updates()).toEqual([]);
    expect(supabase.infoCalls()).toEqual([]);
    expect(removeMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('es best-effort: una ruta ajena o demasiado grande no impide adjuntar las válidas', async () => {
    const good = `${BIZ}/ok.jpg`;
    const huge = `${BIZ}/grande.jpg`;
    const foreign = 'otro-negocio/x.jpg';
    const supabase = createSupabase({
      fotos: [],
      objects: {
        [good]: { size: 100, contentType: 'image/jpeg' },
        [huge]: { size: 10 * 1024 * 1024 + 1, contentType: 'image/jpeg' },
      },
    });

    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [
        { type: 'storage_path', path: good },
        { type: 'storage_path', path: foreign },
        { type: 'storage_path', path: huge },
      ],
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      entrada_id: ENTRADA,
      items: [{ path: good, signedUrl: `https://signed.example/${good}` }],
      errors: [
        { path: foreign, error: 'La ruta no pertenece a este negocio.' },
        { path: huge, error: 'La foto supera el tamaño máximo permitido (10 MB).' },
      ],
    });
    expect(supabase.updates()).toEqual([[good]]);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith(supabase, [huge]);
    expect(supabase.infoCalls()).toEqual([good, huge]);
  });

  it('rechaza un objeto que no está en el bucket y no toca la fila', async () => {
    const missing = `${BIZ}/no-esta.jpg`;
    const supabase = createSupabase({ objects: {} });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'storage_path', path: missing }],
    });

    expect(result).toEqual({
      ok: false,
      entrada_id: ENTRADA,
      items: [],
      errors: [{ path: missing, error: 'No se encontró la foto en el bucket del diario.' }],
    });
    expect(supabase.updates()).toEqual([]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('borra y no adjunta un objeto cuyo MIME no es una imagen permitida', async () => {
    const path = `${BIZ}/nota.txt`;
    const supabase = createSupabase({
      objects: { [path]: { size: 20, contentType: 'text/plain' } },
    });
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: [{ type: 'storage_path', path }],
    });

    expect(result).toMatchObject({
      ok: false,
      errors: [{ path, error: 'El archivo no es una imagen jpeg, png, webp, gif o heic.' }],
    });
    expect(removeMock).toHaveBeenCalledWith(supabase, [path]);
    expect(supabase.updates()).toEqual([]);
  });

  it('rechaza más de 8 rutas antes de leer storage', async () => {
    const supabase = createSupabase();
    const result = await ingestDiarioObraFotos(supabase as unknown as SupabaseClient, {
      businessId: BIZ,
      entradaId: ENTRADA,
      sources: Array.from({ length: 9 }, (_, i) => ({
        type: 'storage_path' as const,
        path: `${BIZ}/${i}.jpg`,
      })),
    });

    expect(result).toEqual({ error: 'storage_paths admite como máximo 8 fotos.' });
    expect(supabase.infoCalls()).toEqual([]);
  });
});
