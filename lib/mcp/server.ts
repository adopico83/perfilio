import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpContext } from '@/lib/mcp/context';
import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  DIARIO_FOTO_INGEST_MAX_BYTES,
  DIARIO_FOTO_INGEST_MAX_ITEMS,
} from '@/lib/diario-obra-ingest';

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
    'crear_cita',
    {
      description:
        'Crea una cita o reunión en la agenda de Perfilio del negocio de esta conexión. No llama a Google. Interpreta la fecha y las horas en Europe/Madrid y las guarda como día (fecha) y hora local HH:MM. Si ok es true, la respuesta trae starts_at, ends_at y google_calendar_hint (recordatorio de 15 minutos) para copiar el mismo evento al Google Calendar del usuario, salvo que haya pedido solo Perfilio. El asunto, el día y la hora de inicio son obligatorios.',
      inputSchema: {
        asunto: z.string().describe('Asunto o título de la cita, tal como se dicta'),
        fecha: z
          .string()
          .describe(
            'Día en Europe/Madrid: AAAA-MM-DD, DD/MM/AAAA, hoy, mañana, pasado mañana, un día de la semana o «24 de septiembre»'
          ),
        hora_inicio: z
          .string()
          .describe('Hora de inicio en Europe/Madrid, por ejemplo 10:00 o «a las 10 de la mañana»'),
        hora_fin: z
          .string()
          .optional()
          .describe('Hora de fin opcional, mismo formato. La tabla no tiene columna de fin: se anota en la descripción'),
        lugar: z.string().optional().describe('Lugar o dirección, opcional'),
        notas: z.string().optional().describe('Notas libres, opcional'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_cita', args, ctx))
  );

  server.registerTool(
    'ver_citas',
    {
      description:
        'Lista las próximas citas sin completar del negocio, desde hoy en Europe/Madrid. Hasta 10 por defecto.',
      inputSchema: {
        desde: z
          .string()
          .optional()
          .describe('Día inicial inclusive. Por defecto, hoy en Europe/Madrid. Mismos formatos que crear_cita'),
        hasta: z.string().optional().describe('Día final inclusive, opcional'),
        limite: z.number().optional().describe('Cuántas citas devolver, entre 1 y 20. Por defecto 10'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('ver_citas', args, ctx))
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

  const maxMb = Math.round(DIARIO_FOTO_INGEST_MAX_BYTES / (1024 * 1024));

  server.registerTool(
    'crear_upload_firmado_diario',
    {
      description: `Crea una URL firmada para subir una foto con PUT directo al bucket diario-obra de este negocio (máx. ${maxMb} MB, jpeg/png/webp/gif/heic). Devuelve upload_url, path, token y headers. Después haz PUT de los bytes y llama a adjuntar_foto_diario con storage_paths. No usa base64 ni hosts externos.`,
      inputSchema: {
        mime_type: z
          .string()
          .describe('MIME de la imagen: image/jpeg, image/png, image/webp, image/gif o image/heic'),
        nombre_archivo: z
          .string()
          .optional()
          .describe('Nombre de archivo opcional; solo se conserva un stem seguro'),
        entrada_diario_id: z
          .string()
          .optional()
          .describe('UUID de la entrada, opcional, para colgar la ruta de esa entrada'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_upload_firmado_diario', args, ctx))
  );

  server.registerTool(
    'adjuntar_foto_diario',
    {
      description: `Adjunta de 1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos a una entrada del diario. Camino del bot: storage_paths (rutas devueltas por crear_upload_firmado_diario, ya subidas al bucket diario-obra de este negocio). foto_urls queda solo para integraciones con una URL https pública: el servidor las descarga. No envíes ambos. No admite base64.`,
      inputSchema: {
        entrada_diario_id: z.string().describe('UUID de la fila diario_obra'),
        storage_paths: z
          .array(z.string())
          .min(1)
          .max(DIARIO_FOTO_INGEST_MAX_ITEMS)
          .optional()
          .describe(
            `Rutas relativas del bucket diario-obra de este negocio (1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS}). Camino principal tras el PUT firmado.`
          ),
        foto_urls: z
          .array(z.string())
          .min(1)
          .max(DIARIO_FOTO_INGEST_MAX_ITEMS)
          .optional()
          .describe(
            `Alternativa de integraciones: URLs https públicas (1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS}). No lo uses si ya subiste con crear_upload_firmado_diario.`
          ),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('adjuntar_foto_diario', args, ctx))
  );

  return server;
}
