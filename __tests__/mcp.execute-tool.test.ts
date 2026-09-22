import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  createDiarioObraSignedUpload,
  ingestDiarioObraFotos,
} from '@/lib/diario-obra-ingest';
import type { McpContext } from '@/lib/mcp/context';

jest.mock('@/lib/diario-obra-ingest', () => ({
  DIARIO_FOTO_INGEST_MAX_ITEMS: 8,
  ingestDiarioObraFotos: jest.fn(),
  createDiarioObraSignedUpload: jest.fn(),
}));

const ingestMock = ingestDiarioObraFotos as jest.MockedFunction<typeof ingestDiarioObraFotos>;
const signedUploadMock = createDiarioObraSignedUpload as jest.MockedFunction<
  typeof createDiarioObraSignedUpload
>;

const ENTRADA = '11111111-1111-4111-8111-111111111111';

function ctx(): McpContext {
  return {
    businessId: 'biz-1',
    userId: 'user-1',
    supabase: {} as McpContext['supabase'],
  };
}

describe('executeMcpTool — adjuntar_foto_diario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega el lote de URLs en la ingesta compartida', async () => {
    const c = ctx();
    ingestMock.mockResolvedValue({
      ok: true,
      entrada_id: ENTRADA,
      items: [
        {
          url: 'https://cdn.example.com/1.jpg',
          path: 'biz-1/1.jpg',
          signedUrl: 'https://signed/1.jpg',
        },
      ],
      errors: [{ url: 'https://cdn.example.com/2.jpg', error: 'Solo se admiten URLs https.' }],
    });

    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        foto_urls: ['https://cdn.example.com/1.jpg', '  https://cdn.example.com/2.jpg  '],
      },
      c
    );

    expect(ingestMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      entradaId: ENTRADA,
      sources: [
        { type: 'url', url: 'https://cdn.example.com/1.jpg' },
        { type: 'url', url: 'https://cdn.example.com/2.jpg' },
      ],
    });
    expect(result).toMatchObject({ ok: true, entrada_id: ENTRADA, items: [{ path: 'biz-1/1.jpg' }] });
  });

  it('rechaza base64 sin tocar storage ni la ingesta', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        foto_base64: '/9j/4AAQ',
        mime_type: 'image/jpeg',
      },
      ctx()
    );

    expect(result).toEqual({
      error:
        'foto_base64 ya no se admite. Crea una subida firmada con crear_upload_firmado_diario y adjunta storage_paths, o envía foto_urls (1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('exige storage_paths o foto_urls', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      { entrada_diario_id: ENTRADA },
      ctx()
    );
    expect(result).toEqual({
      error:
        'Indica storage_paths (1 a 8 rutas del bucket diario-obra) o, en integraciones, foto_urls (1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('adjunta por storage_paths con el businessId del contexto', async () => {
    const c = ctx();
    ingestMock.mockResolvedValue({
      ok: true,
      entrada_id: ENTRADA,
      items: [{ path: 'biz-1/1700_foto.jpg' }],
    });

    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        storage_paths: [' biz-1/1700_foto.jpg ', 'biz-1/1701_foto.jpg'],
      },
      c
    );

    expect(ingestMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      entradaId: ENTRADA,
      sources: [
        { type: 'storage_path', path: 'biz-1/1700_foto.jpg' },
        { type: 'storage_path', path: 'biz-1/1701_foto.jpg' },
      ],
    });
    expect(result).toMatchObject({ ok: true, items: [{ path: 'biz-1/1700_foto.jpg' }] });
  });

  it('no mezcla storage_paths y foto_urls', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        storage_paths: ['biz-1/a.jpg'],
        foto_urls: ['https://cdn.example.com/a.jpg'],
      },
      ctx()
    );
    expect(result).toEqual({ error: 'Indica solo storage_paths o solo foto_urls, no ambos.' });
    expect(ingestMock).not.toHaveBeenCalled();
  });
});

describe('executeMcpTool — crear_upload_firmado_diario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('firma la subida con el businessId del contexto, no con un id del argumento', async () => {
    const c = ctx();
    signedUploadMock.mockResolvedValue({
      upload_url: 'https://upload.example/put?token=tok',
      path: 'biz-1/1700_abcd_fachada.jpg',
      token: 'tok',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      max_bytes: 10 * 1024 * 1024,
    });

    const result = await executeMcpTool(
      'crear_upload_firmado_diario',
      {
        mime_type: 'image/jpeg',
        nombre_archivo: 'fachada.jpg',
        entrada_diario_id: ENTRADA,
        business_id: 'otro-negocio',
      },
      c
    );

    expect(signedUploadMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      mimeType: 'image/jpeg',
      fileName: 'fachada.jpg',
      entradaId: ENTRADA,
    });
    expect(result).toMatchObject({
      upload_url: 'https://upload.example/put?token=tok',
      path: expect.stringMatching(/^biz-1\//),
      token: 'tok',
    });
  });
});
