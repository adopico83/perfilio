import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

let openaiCliente: OpenAI | null = null;

/** Cliente de OpenAI creado la primera vez que se usa (no al importar el módulo): así `next build` no exige OPENAI_API_KEY. */
function getOpenAI(): OpenAI {
  openaiCliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiCliente;
}

/** Whisper no admite archivos de más de 25 MB. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio');

    const isBlobLike =
      audioBlob &&
      typeof audioBlob === 'object' &&
      'arrayBuffer' in (audioBlob as object);

    if (!isBlobLike) {
      return NextResponse.json(
        { error: 'Audio requerido' },
        { status: 400 }
      );
    }

    const blob = audioBlob as unknown as Blob;

    if (blob.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'El audio es demasiado grande (máximo 25 MB). Graba un fragmento más corto.' },
        { status: 413 }
      );
    }

    if (blob.size < 1000) {
      return NextResponse.json(
        { error: 'Audio demasiado corto o vacío' },
        { status: 400 }
      );
    }

    let transcription;
    try {
      const fileMp3 = new File([blob], 'audio.mp3', { type: 'audio/mpeg' });
      transcription = await getOpenAI().audio.transcriptions.create({
        file: fileMp3,
        model: 'whisper-1',
        language: 'es',
      });
    } catch {
      const fileOgg = new File([blob], 'audio.ogg', { type: 'audio/ogg' });
      transcription = await getOpenAI().audio.transcriptions.create({
        file: fileOgg,
        model: 'whisper-1',
        language: 'es',
      });
    }

    return NextResponse.json({ texto: transcription.text });
  } catch (err) {
    console.error('Error en /api/transcribe:', err);
    return NextResponse.json(
      { error: 'Error al transcribir' },
      { status: 500 }
    );
  }
}

