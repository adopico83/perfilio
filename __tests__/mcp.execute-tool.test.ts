import { executeMcpTool } from '@/lib/mcp/execute-tool';
import { ingestDiarioObraFotos } from '@/lib/diario-obra-ingest';
import type { McpContext } from '@/lib/mcp/context';

jest.mock('@/lib/diario-obra-ingest', () => ({
  DIARIO_FOTO_INGEST_MAX_ITEMS: 8,
  ingestDiarioObraFotos: jest.fn(),
}));

const ingestMock = ingestDiarioObraFotos as jest.MockedFunction<typeof ingestDiarioObraFotos>;

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
      error: 'foto_base64 ya no se admite. Envía foto_urls (1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('exige foto_urls', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      { entrada_diario_id: ENTRADA },
      ctx()
    );
    expect(result).toEqual({
      error: 'foto_urls es obligatorio (array de 1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });
});
