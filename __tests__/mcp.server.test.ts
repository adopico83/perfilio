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
  it('registra foto_urls (1–8) y no expone base64', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).adjuntar_foto_diario;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/no admite base64/i);
    expect(tool.description ?? '').toMatch(/https/i);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['entrada_diario_id', 'foto_urls']);
    expect(shape).not.toHaveProperty('foto_base64');
    expect(shape).not.toHaveProperty('mime_type');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({ entrada_diario_id: 'x', foto_urls: [] }).success).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: 'x',
        foto_urls: Array.from({ length: 9 }, () => 'https://cdn.example.com/a.jpg'),
      }).success
    ).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
        foto_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      }).success
    ).toBe(true);
  });
});