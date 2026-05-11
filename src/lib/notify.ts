import { createAdminClient } from '@/lib/supabase/admin';

export interface BichoNotification {
  message: string;
  urgency: 'alta' | 'media' | 'baja';
  type: string;
  slug: string;
}

type PushoverResponse = {
  status?: number;
  errors?: string[];
};

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PUSHOVER_PRIORITY: Record<BichoNotification['urgency'], number> = {
  alta: 1,
  media: 0,
  baja: -1,
};

export async function sendBichoNotification(
  notification: BichoNotification
): Promise<boolean> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();

  const { data: existingNotification, error: lookupError } = await supabase
    .from('bicho_notifications')
    .select('id')
    .eq('slug', notification.slug)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error('[sendBichoNotification] lookup failed', lookupError.message);
    return false;
  }

  if (existingNotification) {
    return false;
  }

  const token = process.env.PUSHOVER_API_TOKEN ?? process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY ?? process.env.PUSHOVER_USER;

  if (!token || !user) {
    console.error('[sendBichoNotification] missing Pushover credentials');
    return false;
  }

  const response = await fetch(PUSHOVER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      token,
      user,
      title: '🐝 El Bicho',
      message: notification.message,
      priority: String(PUSHOVER_PRIORITY[notification.urgency]),
    }),
  });

  const pushoverResult = (await response.json()) as PushoverResponse;

  if (pushoverResult.status !== 1) {
    console.error('[sendBichoNotification] Pushover failed', pushoverResult);
    return false;
  }

  const { error: insertError } = await supabase
    .from('bicho_notifications')
    .insert({
      message: notification.message,
      urgency: notification.urgency,
      type: notification.type,
      slug: notification.slug,
    });

  if (insertError) {
    console.error('[sendBichoNotification] insert failed', insertError.message);
    return false;
  }

  return true;
}
