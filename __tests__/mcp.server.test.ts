import { createPerfilioMcpServer } from '@/lib/mcp/server';
import type { McpContext } from '@/lib/mcp/context';

type Registered = {
  description?: string;
  inputSchema?: { shape?: Record<string, unknown> };
};

function registeredTools(server: ReturnType<typeof createPerfilioMcpServer>): Record<string, Registered> {
  const bag = server as unknown as { _registeredTools?: Record<string, Registered> };
  return bag._registeredTools ?? {};
}

describe('MCP adjuntar_foto_diario', () => {
  it('registra storage_paths como camino principal y foto_urls como alternativa, sin base64', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).adjuntar_foto_diario;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/storage_paths/i);
    expect(tool.description ?? '').toMatch(/no admite base64/i);
    expect(tool.description ?? '').toMatch(/https/i);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['entrada_diario_id', 'foto_urls', 'storage_paths']);
    expect(shape).not.toHaveProperty('foto_base64');
    expect(shape).not.toHaveProperty('mime_type');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({ entrada_diario_id: 'x', foto_urls: [] }).success).toBe(false);
    expect(parsed.safeParse?.({ entrada_diario_id: 'x', storage_paths: [] }).success).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: 'x',
        storage_paths: Array.from({ length: 9 }, () => 'biz/a.jpg'),
      }).success
    ).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
        storage_paths: ['biz-1/a.jpg', 'biz-1/b.jpg'],
      }).success
    ).toBe(true);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
        foto_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      }).success
    ).toBe(true);
  });
});

describe('MCP crear_upload_firmado_diario', () => {
  it('pide mime_type y no acepta el archivo en el tool', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).crear_upload_firmado_diario;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/diario-obra/i);
    expect(tool.description ?? '').toMatch(/PUT/i);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['entrada_diario_id', 'mime_type', 'nombre_archivo']);
    expect(shape).not.toHaveProperty('foto_base64');
    expect(shape).not.toHaveProperty('business_id');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({}).success).toBe(false);
    expect(parsed.safeParse?.({ mime_type: 'image/jpeg' }).success).toBe(true);
    expect(
      parsed.safeParse?.({
        mime_type: 'image/png',
        nombre_archivo: 'fachada.png',
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true);
  });
});