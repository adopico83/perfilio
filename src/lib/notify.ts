import { createAdminClient } from '@/lib/supabase/admin';

export interface BichoNotification {
  /** UUID del negocio al que pertenece el aviso. Si falta, se deduce de `obra_id`. */
  business_id?: string | null;
  /** Obra a la que se refiere el aviso; sirve para averiguar el negocio si no se pasa business_id. */
  obra_id?: string | null;
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

/** Negocio del aviso: el indicado o, si no, el de su obra. null si no se puede saber. */
async function resolveBusinessId(
  supabase: ReturnType<typeof createAdminClient>,
  notification: BichoNotification
): Promise<string | null> {
  const direct = notification.business_id?.trim();
  if (direct) return direct;
  const obraId = notification.obra_id?.trim();
  if (!obraId) return null;
  const { data, error } = await supabase
    .from('obras')
    .select('business_id')
    .eq('id', obraId)
    .maybeSingle();
  if (error) {
    console.error('[sendBichoNotification] obra lookup failed', error.message);
    return null;
  }
  return (data as { business_id?: string | null } | null)?.business_id ?? null;
}

export async function sendBichoNotification(
  notification: BichoNotification
): Promise<boolean> {
  const supabase = createAdminClient();
  const businessId = await resolveBusinessId(supabase, notification);
  if (!businessId) {
    // Sin negocio el aviso quedaría invisible con RLS (y mezclado entre negocios): no se envía.
    console.error('[sendBichoNotification] falta business_id (o obra_id con negocio)');
    return false;
  }
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();

  const { data: existingNotification, error: lookupError } = await supabase
    .from('bicho_notifications')
    .select('id')
    .eq('business_id', businessId)
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
      business_id: businessId,
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
