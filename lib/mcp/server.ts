import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpContext } from '@/lib/mcp/context';
import { executeMcpTool } from '@/lib/mcp/execute-tool';

function toolTextResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createPerfilioMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'perfilio-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'ver_obras_activas',
    {
      description: 'Lista hasta 10 obras activas del negocio (estado distinto de cerrada).',
      inputSchema: {},
    },
    async () => toolTextResult(await executeMcpTool('ver_obras_activas', {}, ctx))
  );

  server.registerTool(
    'ver_facturas_pendientes',
    {
      description: 'Lista hasta 10 facturas en estado pendiente del negocio.',
      inputSchema: {},
    },
    async () => toolTextResult(await executeMcpTool('ver_facturas_pendientes', {}, ctx))
  );

  server.registerTool(
    'crear_presupuesto',
    {
      description: 'Crea un presupuesto en borrador con numeración correlativa.',
      inputSchema: {
        cliente_nombre: z.string().describe('Nombre del cliente'),
        descripcion: z.string().describe('Texto del presupuesto'),
        total: z.number().describe('Importe total'),
        obra_id: z.string().optional().describe('UUID de la obra (opcional)'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_presupuesto', args, ctx))
  );

  server.registerTool(
    'registrar_horas',
    {
      description: 'Registra o actualiza horas de un operario en una obra.',
      inputSchema: {
        operario_nombre: z.string().describe('Nombre o fragmento del operario'),
        obra_nombre: z.string().describe('Nombre o fragmento de la obra'),
        horas: z.number().describe('Horas trabajadas'),
        fecha: z.string().optional().describe('Fecha YYYY-MM-DD (opcional, hoy por defecto)'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('registrar_horas', args, ctx))
  );

  server.registerTool(
    'crear_entrada_diario',
    {
      description: 'Añade una entrada al diario de obra.',
      inputSchema: {
        obra_nombre: z.string().describe('Nombre de la obra'),
        descripcion: z.string().describe('Texto de la entrada'),
        fecha: z.string().optional().describe('Fecha YYYY-MM-DD (opcional)'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_entrada_diario', args, ctx))
  );

  return server;
}
