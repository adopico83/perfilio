/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import type { AdminClient } from './supabase.ts';

export interface BichoNotification {
  business_id: string;
  message: string;
  urgency: 'alta' | 'media' | 'baja';
  type: string;
  slug: string;
  content_hash?: string | null;
  metadata?: Record<string, unknown> | null;
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
  adminClient: AdminClient,
  notification: BichoNotification
): Promise<boolean> {
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();

  const { data: existingNotification, error: lookupError } = await adminClient
    .from('bicho_notifications')
    .select('id')
    .eq('business_id', notification.business_id)
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

  const token = Deno.env.get('PUSHOVER_API_TOKEN') ?? Deno.env.get('PUSHOVER_TOKEN');
  const user = Deno.env.get('PUSHOVER_USER_KEY') ?? Deno.env.get('PUSHOVER_USER');

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

  const { error: insertError } = await adminClient
    .from('bicho_notifications')
    .insert({
      business_id: notification.business_id,
      message: notification.message,
      urgency: notification.urgency,
      type: notification.type,
      slug: notification.slug,
      content_hash: notification.content_hash ?? null,
      metadata: notification.metadata ?? null,
    });

  if (insertError) {
    console.error('[sendBichoNotification] insert failed', insertError.message);
    return false;
  }

  return true;
}
