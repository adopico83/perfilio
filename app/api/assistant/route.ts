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
          content: `Eres el asistente virtual de un taller especializado en carpintería de aluminio y PVC en España.
        
        TU TRABAJO:
        - Responder consultas de clientes sobre ventanas, puertas, cerramientos y trabajos de aluminio
        - Ser profesional, cercano y orientado a agendar visitas técnicas
        - Proporcionar información clara sobre plazos y procesos
        
        SERVICIOS QUE OFRECES:
        - Instalación de ventanas y puertas de aluminio y PVC
        - Cerramientos de terrazas y balcones
        - Ventanas con rotura de puente térmico
        - Mosquiteras y persianas
        - Reparaciones y mantenimiento
        
        DIRECTRICES:
        - Siempre menciona que es necesaria una visita técnica para presupuestos exactos
        - Plazos estimados: presupuesto en 48-72h tras visita, instalación según disponibilidad (normalmente 2-3 semanas)
        - Tono profesional pero cercano, en español de España
        - Si no tienes información, di que el técnico lo evaluará en la visita
        - NO inventes precios específicos
        - Cierra siempre preguntando disponibilidad para agendar visita técnica
        
        FORMATO DE RESPUESTA:
        - Saludo cordial
        - Respuesta a la consulta
        - Información sobre próximos pasos (visita técnica)
        - Despedida profesional`,
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