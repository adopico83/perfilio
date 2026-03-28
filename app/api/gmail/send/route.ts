import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGmailAccessTokenForUser } from '@/lib/gmail/get-access-token';

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();

    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const para = typeof b.para === 'string' ? b.para.trim() : '';
    const asunto = typeof b.asunto === 'string' ? b.asunto.trim() : '';
    const cuerpo = typeof b.cuerpo === 'string' ? b.cuerpo.trim() : '';

    if (!para || !asunto || !cuerpo) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: para, asunto, cuerpo' },
        { status: 400 }
      );
    }

    const tokenResult = await getGmailAccessTokenForUser(user.id);
    if ('error' in tokenResult) {
      return NextResponse.json({ error: tokenResult.error }, { status: 403 });
    }

    const mime = [
      `To: ${para}`,
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
          Authorization: `Bearer ${tokenResult.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!sendRes.ok) {
      return NextResponse.json(
        { error: 'No se pudo enviar el email con Gmail' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/gmail/send:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
