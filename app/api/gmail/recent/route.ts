import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const GMAIL_LIST = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_RESULTS = 4;

type GmailRecentItem = {
  remitente: string | null;
  asunto: string | null;
  fechaIso: string | null;
  noLeido: boolean;
};

export async function GET() {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();

    if (!authUser?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: tokenRow, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('access_token, refresh_token, expiry_date')
      .eq('user_id', authUser.id)
      .single();

    if (tokenError || !tokenRow?.access_token) {
      return NextResponse.json({
        items: [] as GmailRecentItem[],
        error: 'gmail_not_connected',
      });
    }

    let accessToken: string = tokenRow.access_token;
    const refreshToken: string | null = tokenRow.refresh_token ?? null;
    const expiryDateMs = tokenRow.expiry_date
      ? new Date(tokenRow.expiry_date).getTime()
      : 0;

    if (refreshToken && expiryDateMs && expiryDateMs <= Date.now()) {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (refreshRes.ok) {
        const refreshed = (await refreshRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        if (refreshed.access_token) {
          accessToken = refreshed.access_token;
          const newExpiryDate = new Date(
            Date.now() + (refreshed.expires_in ?? 3600) * 1000
          ).toISOString();
          await supabase
            .from('gmail_tokens')
            .update({
              access_token: accessToken,
              expiry_date: newExpiryDate,
            })
            .eq('user_id', authUser.id);
        }
      }
    }

    const listRes = await fetch(
      `${GMAIL_LIST}?maxResults=${MAX_RESULTS}&labelIds=INBOX`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!listRes.ok) {
      return NextResponse.json({
        items: [] as GmailRecentItem[],
        error: 'gmail_fetch_failed',
      });
    }

    const listJson = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
    };

    const msgIds = listJson.messages ?? [];
    const items: GmailRecentItem[] = [];

    for (const msg of msgIds) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!msgRes.ok) continue;

      const msgJson = (await msgRes.json()) as {
        snippet?: string;
        labelIds?: string[];
        internalDate?: string;
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };

      const headers = msgJson.payload?.headers ?? [];
      const from =
        headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
      const subject =
        headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ?? null;

      const internalMs = msgJson.internalDate
        ? Number(msgJson.internalDate)
        : NaN;
      const fechaIso = Number.isFinite(internalMs)
        ? new Date(internalMs).toISOString()
        : null;

      const noLeido = (msgJson.labelIds ?? []).includes('UNREAD');

      items.push({
        remitente: from,
        asunto: subject,
        fechaIso,
        noLeido,
      });
    }

    return NextResponse.json({ items, error: null as string | null });
  } catch (e) {
    console.error('GET /api/gmail/recent:', e);
    return NextResponse.json(
      { items: [], error: 'internal_error' },
      { status: 500 }
    );
  }
}
