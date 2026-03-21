import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const systemPrompt = `Eres el asistente IA de ${nombre}, un negocio de ${sector}.
${descripcion}
Servicios que ofrece: ${servicios}
Tarifas aproximadas: ${tarifas}
Información adicional: ${contexto_adicional}
Responde siempre de forma profesional, concisa y en español.
Si te piden un presupuesto, usa las tarifas como referencia y genera uno estructurado.
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
Cuando generes presupuestos, usa esta fecha como fecha del presupuesto.`;

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
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

    let respuesta = firstMessage?.content ?? '';

    if (firstMessage?.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: firstMessage.content ?? '',
        tool_calls: firstMessage.tool_calls,
      });

      for (const toolCall of firstMessage.tool_calls) {
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

      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 800,
      });

      respuesta = finalCompletion.choices[0]?.message?.content ?? respuesta;
    }

    const lowerMensaje = mensaje.toLowerCase();

    const esPresupuesto = /presupuesto|precio|coste|cuánto cuesta/.test(lowerMensaje);
    if (esPresupuesto && respuesta) {
      try {
        let importe_total: number | null = null;
        const totalMatch = respuesta.match(/(?:total|importe total)\s*[:\s]*(\d+[.,]\d{2}|\d+)\s*(?:€|eur|euros)?/i);
        if (totalMatch) {
          const parsed = parseFloat(totalMatch[1].replace(',', '.'));
          if (Number.isFinite(parsed)) importe_total = parsed;
        }
        if (importe_total == null) {
          const fallback = respuesta.match(/(\d+[.,]\d{2}|\d+)\s*€?\s*$/im);
          if (fallback) {
            const parsed = parseFloat(fallback[1].replace(',', '.'));
            if (Number.isFinite(parsed)) importe_total = parsed;
          }
        }

        let cliente_nombre: string | null = null;
        const clienteMatch = mensaje.match(/(?:cliente|para|a)\s*[:\s]*([A-Za-zÀ-ÿ\s]+?)(?:\n|,|\.|$)/i);
        if (clienteMatch && clienteMatch[1].trim().length > 0) {
          cliente_nombre = clienteMatch[1].trim().slice(0, 255);
        }

        await supabase.from('presupuestos').insert({
          business_id,
          mensaje_cliente: mensaje,
          presupuesto_generado: respuesta,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'borrador',
          ...(importe_total != null && { importe_total }),
          ...(cliente_nombre != null && cliente_nombre !== '' && { cliente_nombre }),
        });
      } catch (err) {
        console.error('Error guardando presupuesto:', err);
      }
    }

    const esFactura = /factura|facturar|cobrar/.test(lowerMensaje);
    if (esFactura && respuesta) {
      try {
        const matchImporte = mensaje.match(/(\d+[.,]?\d*)\s*(€|eur|euros)?/i);
        const totalNum = matchImporte ? parseFloat(matchImporte[1].replace(',', '.')) : 0;
        const baseImponible = totalNum ? totalNum / 1.21 : 0;
        const iva = totalNum ? totalNum - baseImponible : 0;

        await supabase.from('facturas').insert({
          business_id,
          cliente_nombre: null,
          descripcion_trabajos: mensaje,
          base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
          iva: Number.isFinite(iva) ? iva : 0,
          total: Number.isFinite(totalNum) ? totalNum : 0,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'pendiente',
        });
      } catch (err) {
        console.error('Error guardando factura:', err);
      }
    }

    const esAlbaran = /albar[aá]n|entrega|nota de entrega/.test(lowerMensaje);
    if (esAlbaran && respuesta) {
      try {
        const matchImporte = mensaje.match(/(\d+[.,]?\d*)\s*(€|eur|euros)?/i);
        const totalNum = matchImporte ? parseFloat(matchImporte[1].replace(',', '.')) : null;

        await supabase.from('albaranes').insert({
          business_id,
          cliente_nombre: null,
          descripcion_trabajos: mensaje,
          total: totalNum,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'pendiente',
        });
      } catch (err) {
        console.error('Error guardando albarán:', err);
      }
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
