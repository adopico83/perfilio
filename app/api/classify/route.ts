import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Mensaje requerido' },
        { status: 400 }
      );
    }

    // Llamada a OpenAI para clasificar
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
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
      temperature: 0.3, // Baja temperatura para respuestas más consistentes
      max_tokens: 10,
    });

    const priority = completion.choices[0].message.content?.trim().toLowerCase() || 'normal';

    // Validar que la respuesta sea válida
    const validPriorities = ['urgent', 'normal', 'low'];
    const finalPriority = validPriorities.includes(priority) ? priority : 'normal';

    return NextResponse.json({
      success: true,
      priority: finalPriority,
    });

  } catch (error: any) {
    console.error('Error clasificando mensaje:', error);
    return NextResponse.json(
      { error: 'Error al clasificar mensaje' },
      { status: 500 }
    );
  }
}