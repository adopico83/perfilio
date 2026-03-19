import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const clientId = '698093732644-saqjb8vqe5ecokfal95ahb43uquf3c2d.apps.googleusercontent.com';
    const appUrl = 'http://localhost:3000';

    if (!clientId || !appUrl) {
      return NextResponse.json(
        { error: 'Faltan variables de entorno para Gmail OAuth' },
        { status: 500 }
      );
    }

    const redirectUri = `${appUrl}/api/auth/gmail/callback`;
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return NextResponse.json({ url });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Error al generar URL de autorización de Gmail' },
      { status: 500 }
    );
  }
}

