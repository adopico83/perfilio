import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { McpContext } from '@/lib/mcp/context';

function bearerTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  const token = m[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function tokensEqualConstantTime(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function validateMcpToken(request: Request): Promise<McpContext | null> {
  const provided = bearerTokenFromRequest(request);
  const expected = process.env.MCP_API_TOKEN?.trim();
  const businessId = process.env.MCP_BUSINESS_ID?.trim();
  if (!provided || !expected || !businessId) return null;
  if (!tokensEqualConstantTime(expected, provided)) return null;

  const userId = (process.env.MCP_USER_ID ?? 'mcp-integration').trim() || 'mcp-integration';
  const supabase = createServiceClient();

  return {
    supabase,
    businessId,
    userId,
  };
}
