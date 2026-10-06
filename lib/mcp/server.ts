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
        'Crea una cita o reunión en la agenda de Perfilio del negocio de esta conexión. Antes de llamarla, repite al usuario el asunto, el día y la hora y espera a que los confirme; no inventes datos que no haya dicho. No llama a Google: solo guarda en Perfilio. Interpreta la fecha y las horas en Europe/Madrid y las guarda como día (fecha) y hora local HH:MM. Si ok es true, la respuesta trae starts_at, ends_at y google_calendar_hint (recordatorio de 15 minutos) para copiar el mismo evento al Google Calendar del usuario, salvo que haya pedido solo Perfilio. El asunto, el día y la hora de inicio son obligatorios. Si la respuesta es un error de fecha u hora, pregunta al usuario por el dato correcto en vez de adivinarlo.',
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
        'Solo lectura. Lista las próximas citas sin completar del negocio, desde hoy en Europe/Madrid (hasta 10 por defecto, máximo 20). Úsala cuando el usuario pregunte qué tiene en la agenda o antes de crear una cita para comprobar que no se solapa con otra. Puedes acotar con desde y hasta.',
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
      description: 'Solo lectura. Lista hasta 10 obras activas del negocio (estado distinto de cerrada), de la más reciente a la más antigua. Cada obra trae: id (uuid), nombre, direccion, estado y created_at. Llámala siempre que necesites el id de una obra y pásalo tal cual (sin modificarlo) en otras tools, por ejemplo obra_id en crear_entrada_diario. Si el usuario nombra una obra y hay varias parecidas, enséñale las opciones y pregúntale cuál es; no elijas tú.',
      inputSchema: {},
    },
    async () => toolTextResult(await executeMcpTool('ver_obras_activas', {}, ctx))
  );

  server.registerTool(
    'ver_facturas_pendientes',
    {
      description: 'Solo lectura. Lista hasta 10 facturas en estado pendiente de cobro del negocio, de la más reciente a la más antigua. Cada factura trae: id (uuid), numero_factura, cliente_nombre, total (con IVA, en euros), estado y created_at. Los importes son los guardados: no los recalcules. Usa el id o el numero_factura exactos de esta lista para pedir el PDF con obtener_enlace_pdf_factura.',
      inputSchema: {},
    },
    async () => toolTextResult(await executeMcpTool('ver_facturas_pendientes', {}, ctx))
  );

  server.registerTool(
    'crear_factura_desde_presupuesto',
    {
      description:
        'Crea la factura de un presupuesto aceptado o aprobado del negocio de esta conexión. Es una acción que escribe datos y genera un número de factura: pide confirmación explícita al usuario (diciéndole el cliente y el importe del presupuesto) antes de llamarla. Es idempotente: si ya existe la factura de ese presupuesto, la devuelve en vez de duplicarla (ya_existia: true). Indica el id (uuid) o el numero del presupuesto, tomados de ver_presupuestos; no los inventes. Si el presupuesto no está aceptado o aprobado, o al cliente le falta el NIF o la dirección, la respuesta es un error: cuéntaselo al usuario y no reintentes.',
      inputSchema: {
        id: z.string().optional().describe('UUID del presupuesto, tal cual lo devolvió ver_presupuestos'),
        numero: z.number().optional().describe('Número correlativo del presupuesto (el que ve el usuario), alternativa a id'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_factura_desde_presupuesto', args, ctx))
  );

  server.registerTool(
    'obtener_enlace_pdf_factura',
    {
      description:
        'Genera el PDF oficial de una factura del negocio de esta conexión y devuelve un enlace firmado y temporal para descargarlo o mandárselo al cliente. No modifica la factura. Indica el id (uuid) o el numero de la factura, tomados de ver_facturas_pendientes o de lo que el usuario haya dicho; si no sabes cuál es, pregúntale. El enlace caduca en dias_validez días (1 a 30, por defecto 7): avisa al usuario de cuándo caduca.',
      inputSchema: {
        id: z.string().optional().describe('UUID de la factura, tal cual lo devolvió ver_facturas_pendientes'),
        numero: z.number().optional().describe('Número de factura (el que ve el usuario), alternativa a id'),
        dias_validez: z
          .number()
          .optional()
          .describe('Días de validez del enlace, entero entre 1 y 30. Por defecto 7'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('obtener_enlace_pdf_factura', args, ctx))
  );

  server.registerTool(
    'resumen_del_dia',
    {
      description:
        'Solo lectura. Resumen del día del negocio: citas de hoy y de mañana, obras activas paradas (sin entradas en el diario en 5 días), presupuestos enviados hace más de 7 días sin respuesta, y facturas pendientes de cobro y vencidas. Cada punto trae su enlace (href) y el campo texto trae el resumen ya redactado. Úsala cuando el usuario pregunte qué hay para hoy o qué tiene pendiente. Si todo_en_orden es true no hay nada que avisar: díselo así, sin inventar tareas.',
      inputSchema: {},
    },
    async () => toolTextResult(await executeMcpTool('resumen_del_dia', {}, ctx))
  );

  server.registerTool(
    'crear_presupuesto',
    {
      description:
        'Atajo sin revisión humana: calcula y crea el presupuesto en un solo paso, sin que el usuario vea antes el cálculo. NO la uses salvo que el usuario pida expresamente saltarse la revisión; lo normal es previsualizar_presupuesto y después confirmar_presupuesto. Si la usas, pide antes confirmación explícita. Con descripcion en texto libre sin partidas estructuradas ya no funciona. Los presupuestos creados así quedan en borrador y no cuentan como confirmados.',
      inputSchema: {
        cliente_nombre: z.string().describe('Nombre del cliente'),
        descripcion: z
          .string()
          .optional()
          .describe(
            'Texto ya canónico (con partidas «Cantidad: ... | Precio: ... € | Importe: ... €») para recalcular sin revisión previa; ignora total si difiere. No admite texto libre.'
          ),
        total: z
          .number()
          .optional()
          .describe('Solo para comparar con lo calculado y avisar si no coincide; nunca se usa como total final'),
        obra_id: z.string().optional().describe('UUID de la obra (opcional)'),
        capitulos: z
          .array(
            z.object({
              nombre: z.string().optional().describe('Nombre del capítulo, opcional (por defecto GENERAL)'),
              partidas: z
                .array(
                  z.object({
                    descripcion: z.string(),
                    cantidad: z.number(),
                    unidad: z.string().optional(),
                    precio_unitario: z
                      .number()
                      .optional()
                      .describe('Si falta, la partida queda marcada como incompleta y no se puede confirmar'),
                    importe_declarado: z
                      .number()
                      .optional()
                      .describe('Importe que dijo el cliente/operario para esta línea, solo para comparar y avisar'),
                  })
                )
                .describe('Partidas de este capítulo'),
            })
          )
          .optional()
          .describe(
            'De 1 a 100 partidas en total entre todos los capítulos. Si se omite, se usa el camino legacy con descripcion.'
          ),
        iva_porcentaje: z.number().optional().describe('Porcentaje de IVA entero, por defecto 21'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('crear_presupuesto', args, ctx))
  );

  server.registerTool(
    'previsualizar_presupuesto',
    {
      description:
        'Primer paso para crear un presupuesto. Calcula y guarda una previsualización (base, IVA, total, avisos) sin escribir en presupuestos, así que es seguro llamarla. Enséñale al usuario el resultado completo (partidas, base, IVA, total y avisos) y llama a confirmar_presupuesto solo con su aprobación explícita. Nunca calcules tú los importes: el servidor recalcula siempre desde cantidad y precio unitario. Si falta el precio de alguna partida, pregúntaselo al usuario; no lo supongas. Si cambia algo, vuelve a previsualizar y enséñale el nuevo resultado.',
      inputSchema: {
        cliente_nombre: z.string().describe('Nombre del cliente'),
        obra_id: z.string().optional().describe('UUID de la obra (opcional)'),
        iva_porcentaje: z.number().optional().describe('Porcentaje de IVA entero, por defecto 21'),
        observaciones: z.string().optional().describe('Observaciones libres, opcional'),
        total_declarado: z
          .number()
          .optional()
          .describe(
            'Total que dijo el cliente/operario, solo para comparar y avisar si no cuadra; nunca se usa como total final'
          ),
        capitulos: z
          .array(
            z.object({
              nombre: z.string().optional().describe('Nombre del capítulo, opcional (por defecto GENERAL)'),
              partidas: z
                .array(
                  z.object({
                    descripcion: z.string(),
                    cantidad: z.number(),
                    unidad: z.string().optional(),
                    precio_unitario: z
                      .number()
                      .optional()
                      .describe('Si falta, la partida queda marcada como incompleta y no se puede confirmar'),
                    importe_declarado: z
                      .number()
                      .optional()
                      .describe('Importe que dijo el cliente/operario para esta línea, solo para comparar y avisar'),
                  })
                )
                .describe('Partidas de este capítulo'),
            })
          )
          .describe('De 1 a 100 partidas en total entre todos los capítulos'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('previsualizar_presupuesto', args, ctx))
  );

  server.registerTool(
    'confirmar_presupuesto',
    {
      description:
        'Segundo paso: confirma una previsualización ya aprobada por el usuario y crea el presupuesto definitivo con numeración correlativa. Escribe datos: no la llames hasta que el usuario haya visto el resultado de previsualizar_presupuesto y lo haya dejado aprobado de forma explícita. Pasa el preview_id exacto devuelto por previsualizar_presupuesto; nunca le pases un total ni partidas aquí, se ignorarían. Confirmar la misma previsualización dos veces devuelve el mismo presupuesto ya creado, no crea uno nuevo (es idempotente).',
      inputSchema: {
        preview_id: z.string().describe('El preview_id devuelto por previsualizar_presupuesto'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('confirmar_presupuesto', args, ctx))
  );

  server.registerTool(
    'ver_presupuestos',
    {
      description:
        'Solo lectura. Lista presupuestos del negocio de esta conexión, del más reciente al más antiguo, con filtros opcionales. Los importes son exactamente los guardados en la base de datos: nunca los recalcules ni los corrijas. «confirmado» es true si el presupuesto pasó por previsualizar_presupuesto + confirmar_presupuesto, o su estado es enviado, aceptado, aprobado o facturado; los creados con el atajo crear_presupuesto no cuentan mientras sigan en borrador. Usa ver_presupuesto para el detalle. Cada presupuesto trae su id y su número: úsalos tal cual en otras tools. Si el usuario nombra un cliente y salen varios presupuestos, enséñale las opciones y pregúntale cuál quiere; no elijas tú.',
      inputSchema: {
        cliente: z.string().optional().describe('Nombre o fragmento del cliente, opcional'),
        estado: z.string().optional().describe('Estado exacto (borrador, enviado, aceptado...), opcional'),
        desde: z.string().optional().describe('Fecha inicial inclusive AAAA-MM-DD, opcional'),
        hasta: z.string().optional().describe('Fecha final inclusive AAAA-MM-DD, opcional'),
        limite: z.number().optional().describe('Cuántos presupuestos devolver, entre 1 y 50. Por defecto 20'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('ver_presupuestos', args, ctx))
  );

  server.registerTool(
    'ver_presupuesto',
    {
      description:
        'Solo lectura. Devuelve el detalle de un presupuesto del negocio de esta conexión (capítulos, partidas, base, IVA y total), por id o por número. Los importes son tal cual están en la base de datos: nunca los recalcules. Si el texto guardado no trae el pie con base e IVA, esos campos vienen a null. Indica id o numero (los que devolvió ver_presupuestos, sin inventarlos); si no existe, la respuesta es un error y debes decírselo al usuario.',
      inputSchema: {
        id: z.string().optional().describe('UUID del presupuesto'),
        numero: z.number().optional().describe('Número correlativo del presupuesto (numero_presupuesto)'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('ver_presupuesto', args, ctx))
  );

  server.registerTool(
    'obtener_enlace_pdf_presupuesto',
    {
      description:
        'Devuelve un enlace firmado y temporal al PDF oficial de un presupuesto, para mandárselo al cliente. Solo funciona con presupuestos confirmados del negocio de esta conexión: los que pasaron por previsualizar_presupuesto + confirmar_presupuesto, o cuyo estado es enviado, aceptado, aprobado o facturado (los creados con el atajo crear_presupuesto no cuentan mientras sigan en borrador). Regenera el PDF en cada llamada, así que siempre refleja el estado actual. Caduca a los 7 días por defecto; máximo 30 (más se rechaza). Indica id o numero (los que devolvió ver_presupuestos). Si el presupuesto no está confirmado, la respuesta es un error: explícaselo al usuario en vez de insistir.',
      inputSchema: {
        id: z.string().optional().describe('UUID del presupuesto'),
        numero: z.number().optional().describe('Número correlativo del presupuesto (numero_presupuesto)'),
        dias_validez: z
          .number()
          .optional()
          .describe('Días de validez del enlace, entero entre 1 y 30. Por defecto 7'),
      },
    },
    async (args) => toolTextResult(await executeMcpTool('obtener_enlace_pdf_presupuesto', args, ctx))
  );

  server.registerTool(
    'registrar_horas',
    {
      description: 'Registra o actualiza las horas de un operario en una obra un día concreto (hoy por defecto). Escribe datos: antes de llamarla, repite al usuario operario, obra, horas y fecha y espera su confirmación. Busca por nombre o fragmento: si el nombre encaja con varios operarios u obras, la respuesta es un error con la lista de opciones; enséñasela al usuario, pregúntale cuál es y vuelve a llamar con el nombre completo, sin elegir tú. Si ya había horas ese día para ese operario y obra, las sustituye.',
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
      description:
        'Añade una entrada al diario de obra. Indica obra_id (exacto) u obra_nombre. Si no estás seguro de la obra, llama antes a ver_obras_activas y pasa obra_id. Si el nombre encaja con varias obras, la respuesta trae candidatos con sus id: enséñaselos al usuario, pregúntale cuál es y repite la llamada con su obra_id. Escribe datos: antes de llamarla, confirma con el usuario la obra y el texto de la entrada.',
      inputSchema: {
        obra_id: z.string().optional().describe('UUID de la obra (manda sobre obra_nombre)'),
        obra_nombre: z.string().optional().describe('Nombre de la obra (alternativa a obra_id)'),
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
      description: `Crea una URL firmada para subir una foto con PUT directo al bucket diario-obra de este negocio (máx. ${maxMb} MB, jpeg/png/webp/gif/heic). Devuelve upload_url, path, token y headers. Después haz PUT de los bytes y llama a adjuntar_foto_diario con storage_paths. No usa base64 ni hosts externos. Úsala solo cuando el usuario quiera subir una foto; no modifica el diario hasta que llames a adjuntar_foto_diario.`,
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
      description: `Adjunta de 1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos a una entrada del diario. Camino del bot: storage_paths (rutas devueltas por crear_upload_firmado_diario, ya subidas al bucket diario-obra de este negocio). foto_urls queda solo para integraciones con una URL https pública: el servidor las descarga. No envíes ambos. No admite base64. Escribe datos: pasa el entrada_diario_id exacto de la entrada (la devuelve crear_entrada_diario) y confirma con el usuario a qué entrada van las fotos si hay duda.`,
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
