import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** YYYY-MM-DD del instante dado en la zona horaria indicada (p. ej. Europa/Madrid). */
function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Suma días a una fecha civil YYYY-MM-DD. */
function addDaysToYmd(ymd: string, days: number): string {
  const [y, mo, da] = ymd.split('-').map(Number);
  const u = Date.UTC(y, mo - 1, da + days);
  return new Date(u).toISOString().slice(0, 10);
}

const ESTADOS_DOC = ['pendiente', 'aceptado', 'rechazado', 'facturado', 'pagado'] as const;
type EstadoDoc = (typeof ESTADOS_DOC)[number];

function parseEstadoDoc(raw: unknown): EstadoDoc | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (ESTADOS_DOC as readonly string[]).includes(s) ? (s as EstadoDoc) : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, business_id, historial } = body;

    if (!mensaje || typeof mensaje !== 'string') {
      return NextResponse.json(
        { error: 'mensaje es requerido y debe ser un string' },
        { status: 400 }
      );
    }
    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id es requerido' },
        { status: 400 }
      );
    }

    const historialValido = Array.isArray(historial)
      ? historial.filter(
          (m: unknown) =>
            m &&
            typeof m === 'object' &&
            'role' in m &&
            'content' in m &&
            (m as { role: string }).role !== 'system' &&
            typeof (m as { content: unknown }).content === 'string'
        ).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      : [];

    const supabase = createServiceClient();
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();
    const { data: profile, error: profileError } = await supabase
      .from('business_profiles')
      .select('nombre, sector, descripcion, servicios, tarifas, contexto_adicional')
      .eq('id', business_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'No se encontró el perfil del negocio' },
        { status: 404 }
      );
    }

    const nombre = profile.nombre ?? 'el negocio';
    const sector = profile.sector ?? 'no especificado';
    const descripcion = profile.descripcion ?? '';
    const servicios = profile.servicios ?? '';
    const tarifas = profile.tarifas ?? '';
    const contexto_adicional = profile.contexto_adicional ?? '';

    const fechaActual = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let agendaContextoPrimerMensaje = '';
    const esPrimerMensajeConversacion =
      historialValido.length === 0 || historialValido.length === 1;

    if (esPrimerMensajeConversacion) {
      const tzAgenda = 'Europe/Madrid';
      const hoyYmd = formatYmdInTimeZone(new Date(), tzAgenda);
      const mananaYmd = addDaysToYmd(hoyYmd, 1);

      const { data: agendaRows, error: agendaError } = await supabase
        .from('agenda')
        .select('titulo, fecha, hora')
        .eq('business_id', business_id)
        .in('fecha', [hoyYmd, mananaYmd])
        .order('fecha', { ascending: true });

      if (!agendaError && agendaRows && agendaRows.length > 0) {
        const lineas = agendaRows.map(
          (row: { titulo?: string | null; fecha?: string | null; hora?: string | null }) => {
            const titulo = String(row.titulo ?? '').trim() || 'Evento';
            const fecha = row.fecha ?? '';
            const cuando =
              fecha === hoyYmd ? 'hoy' : fecha === mananaYmd ? 'mañana' : fecha;
            const horaStr = row.hora != null && String(row.hora).trim()
              ? ` a las ${String(row.hora).trim()}`
              : '';
            return `- ${titulo} (${cuando}${horaStr})`;
          }
        );
        agendaContextoPrimerMensaje = `

PRIMER MENSAJE — Eventos en agenda (solo hoy y mañana; fechas en calendario local del negocio):
${lineas.join('\n')}

Al inicio de tu respuesta, antes de atender lo que pide el usuario, menciona de forma breve y natural (una o dos frases, tono coloquial) lo relevante de estos eventos; no hagas una lista numerada ni viñetas. Puedes usar fórmulas del estilo "Por cierto, ..." y luego enlazar con "Dicho esto," o similar antes de seguir con su petición.`;
      }
    }

    const systemPrompt = `Eres el asistente IA de ${nombre}, un negocio de ${sector}.
${descripcion}
Servicios que ofrece: ${servicios}
Tarifas aproximadas: ${tarifas}
Información adicional: ${contexto_adicional}
Responde siempre de forma profesional, concisa y en español.

IMPORTANTE — herramientas de creación en base de datos:
- La herramienta "crear_presupuesto" SOLO debe llamarse cuando el usuario pide EXPLÍCITAMENTE crear, generar o hacer un presupuesto NUEVO (p. ej. "crea un presupuesto", "genera un presupuesto para...", "hazme un presupuesto"). NO la uses si solo pregunta por presupuestos existentes, menciona la palabra "presupuesto" en contexto informativo, o quiere ver/listar/consultar presupuestos (usa entonces "listar_presupuestos" u "obtener_presupuestos_pendientes").
- La herramienta "crear_factura" SOLO cuando pida EXPLÍCITAMENTE crear/generar/registrar una factura nueva. Para ver o listar facturas usa "listar_facturas" u "obtener_facturas_pendientes", sin crear.
- La herramienta "crear_albaran" SOLO cuando pida EXPLÍCITAMENTE crear/generar un albarán nuevo. Para consultar o listar albaranes usa "listar_albaranes" u "obtener_albaranes_pendientes", sin crear.

Si el usuario solo quiere información o listados, responde con texto y/o las herramientas de listado o pendientes; nunca invoques crear_* en esos casos.

Estado y edición de presupuestos, facturas y albaranes:
- Estados válidos al cambiar estado: pendiente, aceptado, rechazado, facturado, pagado.
- "cambiar_estado_presupuesto", "cambiar_estado_factura" y "cambiar_estado_albaran" requieren el id (UUID) del documento y el estado deseado.
- Si el usuario identifica un documento por cliente o contexto (p. ej. "acepta el presupuesto de Juan Mari", "marca como pagada la factura de…"), primero usa "listar_presupuestos", "listar_facturas" o "listar_albaranes" para obtener el id correcto (y desambiguar si hay varios), y después llama a la herramienta cambiar_estado_* correspondiente.
- Para modificar datos sin cambiar solo el estado, usa "editar_presupuesto", "editar_factura" o "editar_albaran" con el id y solo los campos que deban actualizarse (cliente_nombre, importe_total, descripcion). En presupuestos, "descripcion" actualiza el texto del presupuesto guardado (presupuesto_generado).

Si te piden explícitamente un presupuesto nuevo, usa las tarifas como referencia y genera uno estructurado en la respuesta y, si procede, llama a "crear_presupuesto" con el texto generado.
Cuando el usuario pida generar una factura, sigue este flujo:
- Si el usuario no ha dado el desglose completo, primero pregunta:
  - Nombre del cliente y NIF/CIF si lo tiene
  - Conceptos de mano de obra: horas trabajadas y tarifa por hora
  - Materiales utilizados: nombre, cantidad y precio unitario de cada uno
  - Desplazamiento u otros conceptos adicionales si los hay
- Una vez tengas todos los datos, genera la factura estructurada con:
  - Líneas detalladas: concepto, cantidad, precio unitario, importe
  - Subtotal (base imponible)
  - IVA 21 %
  - Total
Cuando el usuario pida generar una factura, estructura la respuesta con: número de factura, cliente, NIF/CIF si lo tienes, descripción de trabajos, base imponible, IVA (21%) y total.
Cuando el usuario pida generar un albarán, estructura la respuesta con: cliente, descripción de trabajos realizados, fecha y total si aplica.
Siempre confirma al usuario que has guardado el documento en el sistema.
Al inicio de cada conversación, si hay mensajes pendientes de clientes, menciónalos proactivamente.
Puedes ayudar al usuario a gestionar mensajes de clientes, generar presupuestos, facturas y albaranes.

Fecha actual: ${fechaActual}
Cuando generes presupuestos, usa esta fecha como fecha del presupuesto.${agendaContextoPrimerMensaje}`;

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'obtener_presupuestos_pendientes',
          description:
            'Obtiene presupuestos pendientes del negocio actual con cliente, importe y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_facturas_pendientes',
          description:
            'Obtiene facturas pendientes del negocio actual con cliente, importe y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_albaranes_pendientes',
          description: 'Obtiene albaranes pendientes del negocio actual con cliente y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_presupuestos',
          description:
            'Lista los últimos 10 presupuestos del negocio (todos los estados). Úsala cuando el usuario pida ver, consultar o listar sus presupuestos sin crear uno nuevo.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_facturas',
          description:
            'Lista las últimas 10 facturas del negocio. Úsala cuando el usuario pida ver, consultar o listar facturas sin crear una nueva.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_albaranes',
          description:
            'Lista los últimos 10 albaranes del negocio. Úsala cuando el usuario pida ver, consultar o listar albaranes sin crear uno nuevo.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_presupuesto',
          description:
            'Actualiza el estado de un presupuesto por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_presupuestos antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_factura',
          description:
            'Actualiza el estado de una factura por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_facturas antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_albaran',
          description:
            'Actualiza el estado de un albarán por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_albaranes antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_presupuesto',
          description:
            'Actualiza un presupuesto existente (cliente_nombre, importe_total y/o descripcion del texto del presupuesto). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Importe total' },
              descripcion: {
                type: 'string',
                description: 'Nuevo texto del presupuesto (sustituye presupuesto_generado)',
              },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_factura',
          description:
            'Actualiza una factura existente (cliente_nombre, importe_total como total con IVA, y/o descripcion de trabajos). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total con IVA (actualiza base e IVA al 21%)' },
              descripcion: { type: 'string', description: 'Descripción / conceptos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_albaran',
          description:
            'Actualiza un albarán existente (cliente_nombre, importe_total, y/o descripcion). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total' },
              descripcion: { type: 'string', description: 'Descripción de trabajos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_presupuesto',
          description:
            'Guarda en el sistema un presupuesto NUEVO ya redactado. Solo llamar si el usuario pidió explícitamente crear/generar un presupuesto nuevo. Requiere el texto completo del presupuesto.',
          parameters: {
            type: 'object',
            properties: {
              texto_presupuesto: {
                type: 'string',
                description: 'Texto completo del presupuesto a guardar',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente si se conoce' },
              importe_total: { type: 'number', description: 'Importe total si se conoce' },
            },
            required: ['texto_presupuesto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_factura',
          description:
            'Registra en el sistema una factura NUEVA. Solo si el usuario pidió explícitamente crear/generar una factura.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción o conceptos de la factura',
              },
              total: { type: 'number', description: 'Total con IVA si aplica' },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_albaran',
          description:
            'Registra en el sistema un albarán NUEVO. Solo si el usuario pidió explícitamente crear/generar un albarán.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción de trabajos o entrega',
              },
              total: { type: 'number', description: 'Total opcional' },
              cliente_nombre: { type: 'string', description: 'Cliente si se conoce' },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_mensajes_pendientes',
          description:
            'Obtiene respuestas IA del negocio pendientes de aprobación (sin aprobar ni rechazar): texto generado, borrador editado y conversación asociada',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'leer_emails_recientes',
          description:
            'Lee los últimos 5 emails recientes del inbox del usuario conectado y devuelve remitente, asunto y resumen del cuerpo',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'enviar_email',
          description:
            'Envía un email usando Gmail del usuario conectado con destinatario, asunto y cuerpo',
          parameters: {
            type: 'object',
            properties: {
              destinatario: { type: 'string' },
              asunto: { type: 'string' },
              cuerpo: { type: 'string' },
            },
            required: ['destinatario', 'asunto', 'cuerpo'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_recordatorio',
          description:
            'Crea un recordatorio o evento en la agenda del negocio con título, fecha (YYYY-MM-DD) y opcionalmente hora',
          parameters: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Título del recordatorio' },
              fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
              hora: { type: 'string', description: 'Hora opcional (texto libre)' },
            },
            required: ['titulo', 'fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_recordatorio',
          description:
            'Actualiza un recordatorio existente en la agenda del negocio. Indica el id del evento y al menos uno de: título, fecha (YYYY-MM-DD) u hora',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
              titulo: { type: 'string', description: 'Nuevo título' },
              fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
              hora: { type: 'string', description: 'Nueva hora (texto libre) o vacío para quitar' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_recordatorio',
          description: 'Elimina un recordatorio de la agenda del negocio por su id',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
    ];

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historialValido.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: mensaje },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 800,
    });

    const firstMessage = completion.choices[0]?.message;

    const getGmailAccessToken = async () => {
      if (!authUser?.id) return { error: 'No hay usuario autenticado para Gmail' } as const;

      const { data: tokenRow, error: tokenError } = await supabase
        .from('gmail_tokens')
        .select('access_token, refresh_token, expiry_date')
        .eq('user_id', authUser.id)
        .single();

      if (tokenError || !tokenRow?.access_token) {
        return { error: 'Gmail no conectado para este usuario' } as const;
      }

      let accessToken: string = tokenRow.access_token;
      const refreshToken: string | null = tokenRow.refresh_token ?? null;
      const expiryDateMs = tokenRow.expiry_date
        ? new Date(tokenRow.expiry_date).getTime()
        : 0;

      if (refreshToken && expiryDateMs && expiryDateMs <= Date.now()) {
        console.log('Gmail token expirado, iniciando refresh...', {
          userId: authUser.id,
          expiryDate: tokenRow.expiry_date,
        });
        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
        });

        if (refreshRes.ok) {
          const refreshed = (await refreshRes.json()) as {
            access_token?: string;
            expires_in?: number;
          };
          console.log('Resultado refresh token Gmail:', {
            ok: true,
            hasAccessToken: !!refreshed.access_token,
            expiresIn: refreshed.expires_in ?? null,
          });

          if (refreshed.access_token) {
            accessToken = refreshed.access_token;
            const newExpiryDate = new Date(
              Date.now() + (refreshed.expires_in ?? 3600) * 1000
            ).toISOString();

            await supabase
              .from('gmail_tokens')
              .update({
                access_token: accessToken,
                expiry_date: newExpiryDate,
              })
              .eq('user_id', authUser.id);
          }
        } else {
          let refreshErrorBody: unknown = null;
          try {
            refreshErrorBody = await refreshRes.json();
          } catch {
            refreshErrorBody = await refreshRes.text().catch(() => null);
          }
          console.log('Error refrescando token Gmail:', {
            ok: false,
            status: refreshRes.status,
            body: refreshErrorBody,
          });
        }
      }

      return { accessToken } as const;
    };

    const runTool = async (toolName: string, toolArgs: Record<string, unknown>) => {
      console.log('Ejecutando tool:', toolName);
      switch (toolName) {
        case 'obtener_presupuestos_pendientes': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('cliente_nombre, importe_total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.importe_total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_facturas_pendientes': {
          const { data, error } = await supabase
            .from('facturas')
            .select('cliente_nombre, total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_albaranes_pendientes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('cliente_nombre, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'listar_presupuestos': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('id, cliente_nombre, importe_total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              cliente_nombre?: string | null;
              importe_total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.importe_total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_facturas': {
          const { data, error } = await supabase
            .from('facturas')
            .select('id, cliente_nombre, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              cliente_nombre?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_albaranes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('id, cliente_nombre, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              cliente_nombre?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'cambiar_estado_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_factura': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            importe_total?: number;
            presupuesto_generado?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.importe_total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.presupuesto_generado = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_factura': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            total?: number;
            base_imponible?: number;
            iva?: number;
            descripcion_trabajos?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const totalNum = Number(toolArgs.importe_total);
            if (!Number.isFinite(totalNum)) {
              return { error: 'importe_total debe ser un número válido' };
            }
            const baseImponible = totalNum ? totalNum / 1.21 : 0;
            const iva = totalNum ? totalNum - baseImponible : 0;
            updates.total = totalNum;
            updates.base_imponible = Number.isFinite(baseImponible) ? baseImponible : 0;
            updates.iva = Number.isFinite(iva) ? iva : 0;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: { cliente_nombre?: string; total?: number; descripcion_trabajos?: string } =
            {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'crear_presupuesto': {
          const texto = String(toolArgs.texto_presupuesto ?? '').trim();
          if (!texto) {
            return { error: 'texto_presupuesto es obligatorio' };
          }
          const clienteNombre =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const importeRaw = toolArgs.importe_total;
          const importe_total =
            importeRaw != null && Number.isFinite(Number(importeRaw))
              ? Number(importeRaw)
              : null;

          const { error } = await supabase.from('presupuestos').insert({
            business_id,
            mensaje_cliente: mensaje,
            presupuesto_generado: texto,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'borrador',
            ...(importe_total != null && { importe_total }),
            ...(clienteNombre.length > 0 && { cliente_nombre: clienteNombre }),
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_factura': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : 0;
          const baseImponible = totalNum ? totalNum / 1.21 : 0;
          const iva = totalNum ? totalNum - baseImponible : 0;

          const { error } = await supabase.from('facturas').insert({
            business_id,
            cliente_nombre: null,
            descripcion_trabajos: desc,
            base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
            iva: Number.isFinite(iva) ? iva : 0,
            total: Number.isFinite(totalNum) ? totalNum : 0,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_albaran': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw))
              ? Number(totalRaw)
              : null;
          const clienteAlb =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';

          const { error } = await supabase.from('albaranes').insert({
            business_id,
            cliente_nombre: clienteAlb.length > 0 ? clienteAlb : null,
            descripcion_trabajos: desc,
            total: totalNum,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'obtener_mensajes_pendientes': {
          const { data: convRows, error: convError } = await supabase
            .from('conversation_history')
            .select('conversation_id')
            .eq('business_id', business_id);

          if (convError) {
            console.log('Resultado mensajes:', null, convError);
            return { error: convError.message };
          }

          const conversationIds = [
            ...new Set(
              (convRows ?? [])
                .map((r: { conversation_id?: string | null }) => r.conversation_id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
            ),
          ];

          if (conversationIds.length === 0) {
            console.log('Resultado mensajes:', [], null);
            return { items: [] };
          }

          const { data, error } = await supabase
            .from('ai_responses')
            .select(
              'id, conversation_id, created_at, ai_response, edited_response, approved_at, rejected_at'
            )
            .in('conversation_id', conversationIds)
            .is('approved_at', null)
            .is('rejected_at', null)
            .order('created_at', { ascending: false })
            .limit(50);

          console.log('Resultado mensajes:', data, error);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              conversation_id?: string | null;
              created_at?: string | null;
              ai_response?: string | null;
              edited_response?: string | null;
              approved_at?: string | null;
              rejected_at?: string | null;
            }) => ({
              id: r.id ?? null,
              conversation_id: r.conversation_id ?? null,
              creado_en: r.created_at ?? null,
              respuesta_ia: r.ai_response ?? null,
              borrador_editado: r.edited_response ?? null,
              pendiente_de_aprobacion: !r.approved_at && !r.rejected_at,
            })),
          };
        }
        case 'leer_emails_recientes': {
          const tokenResult = await getGmailAccessToken();
          if ('error' in tokenResult) return { error: tokenResult.error };
          const accessToken = tokenResult.accessToken;

          const listRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (!listRes.ok) {
            return { error: 'No se pudieron leer emails recientes de Gmail' };
          }

          const listJson = (await listRes.json()) as {
            messages?: Array<{ id: string }>;
          };

          const msgIds = listJson.messages ?? [];
          const items: Array<{ remitente: string | null; asunto: string | null; resumen: string | null }> = [];

          for (const msg of msgIds) {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );
            if (!msgRes.ok) continue;

            const msgJson = (await msgRes.json()) as {
              snippet?: string;
              payload?: { headers?: Array<{ name?: string; value?: string }> };
            };

            const headers = msgJson.payload?.headers ?? [];
            const from =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
            const subject =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ??
              null;

            items.push({
              remitente: from,
              asunto: subject,
              resumen: msgJson.snippet ?? null,
            });
          }

          return { items };
        }
        case 'enviar_email': {
          const destinatario = String(toolArgs.destinatario ?? '').trim();
          const asunto = String(toolArgs.asunto ?? '').trim();
          const cuerpo = String(toolArgs.cuerpo ?? '').trim();

          if (!destinatario || !asunto || !cuerpo) {
            return { error: 'Faltan parámetros obligatorios para enviar email' };
          }

          const tokenResult = await getGmailAccessToken();
          if ('error' in tokenResult) return { error: tokenResult.error };
          const accessToken = tokenResult.accessToken;

          const mime = [
            `To: ${destinatario}`,
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            `Subject: ${asunto}`,
            '',
            cuerpo,
          ].join('\r\n');

          const raw = Buffer.from(mime, 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

          const sendRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ raw }),
            }
          );

          if (!sendRes.ok) {
            return { error: 'No se pudo enviar el email con Gmail' };
          }

          return { ok: true };
        }
        case 'crear_recordatorio': {
          const titulo = String(toolArgs.titulo ?? '').trim();
          const fechaRaw = String(toolArgs.fecha ?? '').trim();
          const horaOpt = toolArgs.hora != null ? String(toolArgs.hora).trim() : '';

          if (!titulo) {
            return { error: 'El título del recordatorio es obligatorio' };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
            return { error: 'La fecha debe tener formato YYYY-MM-DD' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const insertPayload: {
            business_id: string;
            titulo: string;
            fecha: string;
            hora?: string;
          } = {
            business_id: businessIdBody,
            titulo,
            fecha: fechaRaw,
          };
          if (horaOpt) {
            insertPayload.hora = horaOpt;
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .insert(insertPayload)
            .select('id')
            .single();

          if (error || !row?.id) {
            return { error: error?.message ?? 'No se pudo crear el recordatorio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const updates: { titulo?: string; fecha?: string; hora?: string | null } = {};
          if (toolArgs.titulo !== undefined) {
            const t = String(toolArgs.titulo ?? '').trim();
            if (!t) {
              return { error: 'El título no puede estar vacío' };
            }
            updates.titulo = t;
          }
          if (toolArgs.fecha !== undefined) {
            const f = String(toolArgs.fecha ?? '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
              return { error: 'La fecha debe tener formato YYYY-MM-DD' };
            }
            updates.fecha = f;
          }
          if (toolArgs.hora !== undefined) {
            const h = String(toolArgs.hora ?? '').trim();
            updates.hora = h.length > 0 ? h : null;
          }

          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (titulo, fecha u hora)' };
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .update(updates)
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!row?.id) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'eliminar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const { data: deleted, error } = await supabase
            .from('agenda')
            .delete()
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!deleted) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true };
        }
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

    /** Máximo de rondas tool → API; la última usa tool_choice "none" para obligar respuesta en texto. */
    const MAX_TOOL_ROUNDS = 12;

    let assistantMessage = firstMessage;
    let respuesta = assistantMessage?.content ?? '';

    for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound++) {
      const toolCalls = assistantMessage?.tool_calls;
      if (!toolCalls?.length) break;

      messages.push({
        role: 'assistant',
        content: assistantMessage!.content ?? null,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }
        const toolResult = await runTool(toolCall.function.name, parsedArgs);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      const isLastToolRound = toolRound >= MAX_TOOL_ROUNDS - 1;
      const nextCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: isLastToolRound ? 'none' : 'auto',
        temperature: 0.7,
        max_tokens: 800,
      });

      assistantMessage = nextCompletion.choices[0]?.message;
      const nextContent = assistantMessage?.content;
      if (typeof nextContent === 'string' && nextContent.trim().length > 0) {
        respuesta = nextContent;
      }
    }

    if (!String(respuesta ?? '').trim()) {
      respuesta =
        'No he podido generar una respuesta en texto. Prueba a reformular la pregunta o inténtalo de nuevo.';
    }

    return NextResponse.json({ respuesta });
  } catch (error) {
    console.error('Error en /api/agente:', error);
    return NextResponse.json(
      { error: 'Error al generar la respuesta del agente' },
      { status: 500 }
    );
  }
}
