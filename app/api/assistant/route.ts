import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseServer } from '@/lib/supabase-server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `Eres el asistente virtual de un taller especializado en carpintería de aluminio y PVC en España.
        
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
        - Despedida profesional`;

export async function POST(request: NextRequest) {
  try {
    const { message, context, sender_email, business_id } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Mensaje requerido' },
        { status: 400 }
      );
    }

    let history: { role: 'user' | 'assistant'; content: string }[] = [];

    if (sender_email && business_id) {
      try {
        const supabase = getSupabaseServer();
        const { data: rows } = await supabase
          .from('conversation_history')
          .select('role, content')
          .eq('business_id', business_id)
          .eq('sender_email', sender_email)
          .order('created_at', { ascending: false })
          .limit(6);

        if (rows && rows.length > 0) {
          history = [...rows]
            .reverse()
            .map((r) => ({
              role: r.role as 'user' | 'assistant',
              content: r.content,
            }));
        }
      } catch (err) {
        console.error('Error recuperando historial conversación:', err);
      }
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });

    const aiResponse = completion.choices[0].message.content ?? '';

    if (sender_email && business_id && aiResponse) {
      try {
        const supabase = getSupabaseServer();
        await supabase.from('conversation_history').insert([
          {
            business_id,
            sender_email,
            role: 'user',
            content: message,
          },
          {
            business_id,
            sender_email,
            role: 'assistant',
            content: aiResponse,
          },
        ]);
      } catch (err) {
        console.error('Error guardando historial conversación:', err);
      }
    }

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
