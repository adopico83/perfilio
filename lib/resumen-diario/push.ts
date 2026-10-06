import type { SupabaseClient } from '@supabase/supabase-js';
import { textoResumen, type ResumenDia } from '@/lib/resumen-diario/calcular';
import { urgenciaResumen } from '@/lib/resumen-diario/guardar';
import {
  credencialesPushover,
  enviarPushover,
  recortarMensaje,
} from '@/lib/notificaciones/pushover';
import { configurarWebPush, webpush } from '@/lib/notificaciones/web-push';

export const TITULO_PUSH_RESUMEN = 'Perfilio · Resumen del día';

export type EstadoPushover = 'enviado' | 'sin_credenciales' | 'error' | 'desactivado';
export type EstadoWebPush = 'enviado' | 'sin_suscripciones' | 'sin_credenciales' | 'error' | 'desactivado';
export type ResultadoPushResumen = { pushover: EstadoPushover; webpush: EstadoWebPush };

/**
 * Manda el resumen del día como aviso push, solo si el negocio lo tiene activado
 * (`business_profiles.resumen_push = true`). Por defecto está apagado para todos.
 * Dos canales independientes: Pushover (credenciales en variables de entorno) y web push a las
 * suscripciones del negocio. Nunca lanza: un fallo de push no debe romper el cron.
 */
export async function enviarPushResumen(
  supabase: SupabaseClient,
  businessId: string,
  resumen: ResumenDia
): Promise<ResultadoPushResumen> {
  const resultado: ResultadoPushResumen = { pushover: 'desactivado', webpush: 'desactivado' };
  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('resumen_push')
      .eq('id', businessId)
      .maybeSingle();
    if (error) {
      console.error('[resumen-push] no se pudo leer resumen_push:', error.message);
      return resultado;
    }
    if ((data as { resumen_push?: boolean } | null)?.resumen_push !== true) return resultado;

    const mensaje = recortarMensaje(textoResumen(resumen));

    const cred = credencialesPushover();
    if (!cred) {
      resultado.pushover = 'sin_credenciales';
    } else {
      const ok = await enviarPushover({
        ...cred,
        title: TITULO_PUSH_RESUMEN,
        message: mensaje,
        urgencia: urgenciaResumen(resumen),
      });
      resultado.pushover = ok ? 'enviado' : 'error';
    }

    resultado.webpush = await enviarWebPush(supabase, businessId, mensaje);
  } catch (e) {
    console.error('[resumen-push] error inesperado:', e instanceof Error ? e.message : e);
    if (resultado.pushover === 'desactivado') resultado.pushover = 'error';
    if (resultado.webpush === 'desactivado') resultado.webpush = 'error';
  }
  return resultado;
}

async function enviarWebPush(
  supabase: SupabaseClient,
  businessId: string,
  mensaje: string
): Promise<EstadoWebPush> {
  try {
    configurarWebPush();
  } catch {
    return 'sin_credenciales';
  }
  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('business_id', businessId);
    if (error) return 'error';
    const payload = JSON.stringify({
      title: TITULO_PUSH_RESUMEN,
      body: mensaje,
      icon: '/icons/icon-192x192.png',
    });
    let enviados = 0;
    let fallos = 0;
    let total = 0;
    for (const row of (data ?? []) as Array<{ subscription: import('web-push').PushSubscription | null }>) {
      if (!row.subscription?.endpoint) continue;
      total += 1;
      try {
        await webpush.sendNotification(row.subscription, payload, { TTL: 60 * 60 });
        enviados += 1;
      } catch {
        fallos += 1;
      }
    }
    if (total === 0) return 'sin_suscripciones';
    return enviados > 0 ? 'enviado' : fallos > 0 ? 'error' : 'sin_suscripciones';
  } catch {
    return 'error';
  }
}
