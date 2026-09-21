import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateMcpToken } from '@/lib/mcp/auth';
import { createPerfilioMcpServer } from '@/lib/mcp/server';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const ctx = await validateMcpToken(request);
  if (!ctx) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }
    );
  }

  const mcpServer = createPerfilioMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await mcpServer.connect(transport);
    const response = await transport.handleRequest(request);

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-cache');
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('[mcp] POST error:', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }
    );
  } finally {
    await transport.close().catch(() => undefined);
    await mcpServer.close().catch(() => undefined);
  }
}
