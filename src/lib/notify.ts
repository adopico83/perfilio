import { createAdminClient } from '@/lib/supabase/admin';
import { destinoPushover, enviarPushover } from '@/lib/notificaciones/pushover';

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

  // Destinatario por negocio: su clave propia o, solo para el dueño de la global (Pino), la global.
  const destino = await destinoPushover(supabase, businessId);
  if (!destino) {
    console.error('[sendBichoNotification] el negocio no tiene destinatario de Pushover');
    return false;
  }

  const enviado = await enviarPushover({
    ...destino,
    title: '🐝 El Bicho',
    message: notification.message,
    urgencia: notification.urgency,
  });
  if (!enviado) {
    console.error('[sendBichoNotification] Pushover failed');
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
