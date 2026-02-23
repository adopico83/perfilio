import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { message, context } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Mensaje requerido' },
        { status: 400 }
      );
    }

    // Llamada a OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente profesional que ayuda a empresas a responder emails y mensajes de clientes. Sé conciso, profesional y útil.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const aiResponse = completion.choices[0].message.content;

    return NextResponse.json({
      success: true,
      response: aiResponse,
      tokens: completion.usage?.total_tokens,
    });

  } catch (error: any) {
    console.error('Error en assistant API:', error);
    return NextResponse.json(
      { error: 'Error al generar respuesta' },
      { status: 500 }
    );
  }
}