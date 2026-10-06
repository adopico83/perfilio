import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { comprobarLimiteIARuta, respuestaLimiteIA } from '@/lib/ia/limite-uso';
import { modeloAgente, parametrosGeneracion } from '@/lib/agente/modelo';

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
    // Solo con sesión. Ya no lee ni guarda el historial de ningún negocio: esa rama usaba la
    // service role con un business_id del cuerpo sin comprobar nada y nadie la usaba.
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { message } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Mensaje requerido' },
        { status: 400 }
      );
    }

    // Límite de uso (cupo común con la otra ruta de IA): 429 antes de gastar OpenAI.
    const limite = await comprobarLimiteIARuta(supabaseAuth, user.id);
    if (!limite.permitido) return respuestaLimiteIA(limite);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ];

    // Cliente creado aquí (no al importar el módulo) para no exigir OPENAI_API_KEY en los tests.
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const modelo = modeloAgente();
    const completion = await openai.chat.completions.create({
      model: modelo,
      messages,
      ...parametrosGeneracion(modelo, { maxTokens: 500, temperature: 0.7 }),
    });

    const aiResponse = completion.choices[0].message.content ?? '';

    return NextResponse.json({
      success: true,
      response: aiResponse,
      tokens: completion.usage?.total_tokens,
    });
  } catch (error: unknown) {
    console.error('Error en assistant API:', error);
    return NextResponse.json(
      { error: 'Error al generar respuesta' },
      { status: 500 }
    );
  }
}
