import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseServer } from '@/lib/supabase-server';

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

    const supabase = getSupabaseServer();
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

Fecha actual: ${fechaActual}
Cuando generes presupuestos, usa esta fecha como fecha del presupuesto.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historialValido.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: mensaje },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 800,
    });

    const respuesta = completion.choices[0]?.message?.content ?? '';

    const lowerMensaje = mensaje.toLowerCase();

    const esPresupuesto = /presupuesto|precio|coste|cuánto cuesta/.test(lowerMensaje);
    if (esPresupuesto && respuesta) {
      try {
        await supabase.from('presupuestos').insert({
          business_id,
          mensaje_cliente: mensaje,
          presupuesto_generado: respuesta,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'borrador',
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
