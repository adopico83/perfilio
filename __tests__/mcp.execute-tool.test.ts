import { executeMcpTool } from '@/lib/mcp/execute-tool';
import { uploadDiarioObraMediaToBucket } from '@/lib/diario-obra';
import type { McpContext } from '@/lib/mcp/context';

jest.mock('@/lib/diario-obra', () => {
  const actual = jest.requireActual('@/lib/diario-obra');
  return {
    ...actual,
    uploadDiarioObraMediaToBucket: jest.fn(),
  };
});

const uploadMock = uploadDiarioObraMediaToBucket as jest.MockedFunction<
  typeof uploadDiarioObraMediaToBucket
>;

const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

function makeCtx(overrides?: {
  maybeSingleResult?: { data: unknown; error: { message: string } | null };
  updateError?: { message: string } | null;
  signedUrl?: string | null;
  signError?: { message: string } | null;
}): McpContext & { __update: jest.Mock } {
  const update = jest.fn((payload: unknown) => {
    const secondEq = jest.fn().mockResolvedValue({
      data: null,
      error: overrides?.updateError ?? null,
    });
    const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
    return { eq: firstEq, __payload: payload };
  });

  const createSignedUrl = jest.fn().mockResolvedValue({
    data:
      overrides?.signedUrl === null
        ? null
        : { signedUrl: overrides?.signedUrl ?? 'https://signed/foto.jpg' },
    error: overrides?.signError ?? null,
  });

  const supabase = {
    from: jest.fn((table: string) => {
      if (table !== 'diario_obra') throw new Error(`tabla inesperada: ${table}`);
      const chain: Record<string, jest.Mock> = {};
      const self = () => chain;
      chain.select = jest.fn(self);
      chain.eq = jest.fn(self);
      chain.update = update;
      chain.maybeSingle = jest.fn().mockResolvedValue(
        overrides?.maybeSingleResult ?? {
          data: { id: 'entrada-1', fotos: ['biz-1/prev.jpg'] },
          error: null,
        }
      );
      return chain;
    }),
    storage: {
      from: jest.fn(() => ({ createSignedUrl })),
    },
  };

  return {
    businessId: 'biz-1',
    userId: 'user-1',
    supabase: supabase as unknown as McpContext['supabase'],
    __update: update,
  };
}

describe('executeMcpTool — adjuntar_foto_diario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadMock.mockResolvedValue({ path: 'biz-1/123_mcp_foto.jpg' });
  });

  it('sube la foto, la añade a fotos y devuelve path + url firmada', async () => {
    const ctx = makeCtx();
    const result = (await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: 'entrada-1',
        foto_base64: `data:image/jpeg;base64,${TINY_JPEG_B64}`,
        nombre_archivo: 'fachada.jpg',
      },
      ctx
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      entrada_id: 'entrada-1',
      path: 'biz-1/123_mcp_foto.jpg',
      url: 'https://signed/foto.jpg',
    });
    expect(uploadMock).toHaveBeenCalledWith(
      ctx.supabase,
      expect.objectContaining({
        businessId: 'biz-1',
        contentType: 'image/jpeg',
        stem: 'fachada',
      })
    );
    expect(ctx.__update).toHaveBeenCalledWith({
      fotos: ['biz-1/prev.jpg', 'biz-1/123_mcp_foto.jpg'],
    });
  });

  it('falla cerrado si la entrada no pertenece al negocio', async () => {
    const ctx = makeCtx({
      maybeSingleResult: { data: null, error: null },
    });
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      { entrada_diario_id: 'otra', foto_base64: TINY_JPEG_B64 },
      ctx
    );
    expect(result).toEqual({
      error: 'Entrada de diario no encontrada o no pertenece a este negocio',
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rechaza mime no permitido', async () => {
    const ctx = makeCtx();
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: 'entrada-1',
        foto_base64: TINY_JPEG_B64,
        mime_type: 'application/pdf',
      },
      ctx
    );
    expect(result).toEqual({
      error:
        'mime_type no permitido. Usa image/jpeg, image/png, image/webp, image/gif o image/heic.',
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rechaza foto vacía', async () => {
    const ctx = makeCtx();
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      { entrada_diario_id: 'entrada-1', foto_base64: '   ' },
      ctx
    );
    expect(result).toEqual({ error: 'foto_base64 es obligatorio' });
  });
});
