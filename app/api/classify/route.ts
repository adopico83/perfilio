import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { sendUrgencyAlert } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';
import { comprobarLimiteIARuta, respuestaLimiteIA } from '@/lib/ia/limite-uso';
import { modeloAdmiteTemperature, modeloAgente, parametrosGeneracion } from '@/lib/agente/modelo';

export async function POST(request: NextRequest) {
  try {
    // Solo con sesión: la ruta gasta OpenAI y puede mandar emails.
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { message, senderName, channel } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Mensaje requerido' },
        { status: 400 }
      );
    }

    // Límite de uso (cupo común con la otra ruta de IA): 429 antes de gastar OpenAI.
    const limite = await comprobarLimiteIARuta(supabaseAuth, user.id);
    if (!limite.permitido) return respuestaLimiteIA(limite);

    // Cliente creado aquí (no al importar el módulo) para no exigir OPENAI_API_KEY en los tests.
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const modelo = modeloAgente();
    const completion = await openai.chat.completions.create({
      model: modelo,
      messages: [
        {
          role: 'system',
          content: `Eres un sistema de clasificación de urgencia para mensajes de clientes de un taller de aluminio.

Clasifica cada mensaje en una de estas categorías:
- "urgent": Cliente enfadado, problema grave, avería, queja, necesita solución inmediata, palabras como "urgente", "ya", "ahora", "problema serio"
- "normal": Consulta estándar, solicitud de presupuesto, información sobre servicios
- "low": Spam, consultas muy genéricas, mensajes irrelevantes

Responde SOLO con una palabra: urgent, normal o low`,
        },
        {
          role: 'user',
          content: `Clasifica este mensaje: "${message}"`,
        },
      ],
      // Temperatura baja = respuestas consistentes. Los modelos de razonamiento gastan tokens
      // pensando, así que necesitan más margen que 10 para llegar a escribir la palabra.
      ...parametrosGeneracion(modelo, {
        maxTokens: modeloAdmiteTemperature(modelo) ? 10 : 256,
        temperature: 0.3,
      }),
    });

    const priority = completion.choices[0].message.content?.trim().toLowerCase() || 'normal';

    // Validar que la respuesta sea válida
    const validPriorities = ['urgent', 'normal', 'low'];
    const finalPriority = validPriorities.includes(priority) ? priority : 'normal';

    // Alerta por email cuando el mensaje es urgente
    if (finalPriority === 'urgent') {
      // El email del usuario con sesión; si no lo tiene, ALERT_EMAIL.
      const to = user.email ?? process.env.ALERT_EMAIL;

      if (to) {
        await sendUrgencyAlert(
          to,
          message,
          senderName ?? 'Remitente',
          channel ?? 'N/A'
        );
      }
    }

    return NextResponse.json({
      success: true,
      priority: finalPriority,
    });

  } catch (error: unknown) {
    console.error('Error clasificando mensaje:', error);
    return NextResponse.json(
      { error: 'Error al clasificar mensaje' },
      { status: 500 }
    );
  }
}