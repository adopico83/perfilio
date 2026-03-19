import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return NextResponse.redirect(
        new URL('/dashboard?gmail=error_code', request.url)
      );
    }

    const clientId =  '698093732644-saqjb8vqe5ecokfal95ahb43uquf3c2d.apps.googleusercontent.com';
    const clientSecret = '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';
    const appUrl = 'http://localhost:3000';

    if (!clientId || !clientSecret || !appUrl) {
      return NextResponse.redirect(
        new URL('/dashboard?gmail=error_env', request.url)
      );
    }

    const redirectUri = `${appUrl}/api/auth/gmail/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(
        new URL('/dashboard?gmail=error_token', request.url)
      );
    }

    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenData.access_token) {
      return NextResponse.redirect(
        new URL('/dashboard?gmail=error_token', request.url)
      );
    }

    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const expiryDate = new Date(
      Date.now() + (tokenData.expires_in ?? 3600) * 1000
    ).toISOString();

    const serviceClient = createServiceClient();
    const { error } = await serviceClient.from('gmail_tokens').upsert(
      {
        user_id: user.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expiry_date: expiryDate,
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      return NextResponse.redirect(
        new URL('/dashboard?gmail=error_save', request.url)
      );
    }

    return NextResponse.redirect(
      new URL('/dashboard?gmail=connected', request.url)
    );
  } catch {
    return NextResponse.redirect(
      new URL('/dashboard?gmail=error_unknown', request.url)
    );
  }
}

