import { createServiceClient } from '@/lib/supabase/server';

/**
 * Obtiene un access_token válido para Gmail API del usuario (refresh si caducó).
 */
export async function getGmailAccessTokenForUser(
  userId: string
): Promise<{ accessToken: string } | { error: string }> {
  const supabase = createServiceClient();

  const { data: tokenRow, error: tokenError } = await supabase
    .from('gmail_tokens')
    .select('access_token, refresh_token, expiry_date')
    .eq('user_id', userId)
    .single();

  if (tokenError || !tokenRow?.access_token) {
    return { error: 'Gmail no conectado para este usuario' };
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
          .eq('user_id', userId);
      }
    }
  }

  return { accessToken };
}
