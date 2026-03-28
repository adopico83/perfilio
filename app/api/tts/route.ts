import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const OPENAI_SPEECH = 'https://api.openai.com/v1/audio/speech';
const MAX_INPUT_LENGTH = 4096;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const texto =
      typeof body === 'object' &&
      body !== null &&
      'texto' in body &&
      typeof (body as { texto: unknown }).texto === 'string'
        ? (body as { texto: string }).texto.trim()
        : '';

    if (!texto) {
      return NextResponse.json({ error: 'texto es requerido' }, { status: 400 });
    }

    if (texto.length > MAX_INPUT_LENGTH) {
      return NextResponse.json(
        { error: `texto demasiado largo (máx. ${MAX_INPUT_LENGTH} caracteres)` },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TTS no configurado' }, { status: 500 });
    }

    const upstream = await fetch(OPENAI_SPEECH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'onyx',
        input: texto,
      }),
    });

    if (!upstream.ok) {
      let detail: string | null = null;
      try {
        const errJson = (await upstream.json()) as { error?: { message?: string } };
        detail = errJson.error?.message ?? null;
      } catch {
        detail = await upstream.text().catch(() => null);
      }
      console.error('OpenAI TTS error:', upstream.status, detail);
      return NextResponse.json(
        { error: 'No se pudo generar el audio' },
        { status: 502 }
      );
    }

    if (!upstream.body) {
      return NextResponse.json({ error: 'Respuesta vacía del servicio TTS' }, { status: 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('POST /api/tts:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
