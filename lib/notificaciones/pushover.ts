import type { SupabaseClient } from '@supabase/supabase-js';

/** Envío a Pushover (https://pushover.net). Sin Supabase ni efectos secundarios: solo el POST. */
export const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
/** Límite de Pushover para el cuerpo del mensaje. */
export const PUSHOVER_MAX_MENSAJE = 1024;

export type UrgenciaAviso = 'alta' | 'media' | 'baja';
export const PUSHOVER_PRIORIDAD: Record<UrgenciaAviso, number> = { alta: 1, media: 0, baja: -1 };

/** Credenciales de las variables de entorno (acepta los dos nombres que ya se usaban). */
export function credencialesPushover(): { token: string; user: string } | null {
  const token = (process.env.PUSHOVER_API_TOKEN ?? process.env.PUSHOVER_TOKEN ?? '').trim();
  const user = (process.env.PUSHOVER_USER_KEY ?? process.env.PUSHOVER_USER ?? '').trim();
  return token && user ? { token, user } : null;
}

/** Token de la APP de Pushover (global: identifica a Perfilio, no a ninguna persona). */
export function tokenPushover(): string | null {
  return (process.env.PUSHOVER_API_TOKEN ?? process.env.PUSHOVER_TOKEN ?? '').trim() || null;
}

/**
 * Negocio dueño de la clave de usuario global (`PUSHOVER_USER_KEY`): Pino. Sin esto, el aviso de
 * cualquier negocio llegaría al móvil de Pino. Se puede cambiar con `PUSHOVER_BUSINESS_ID`.
 */
export const PUSHOVER_BUSINESS_ID_POR_DEFECTO = '8784450e-08a4-420a-8c37-d30bff8f0d39';

/**
 * A quién se le manda el aviso de un negocio: `{ token, user }` o null si no hay destinatario.
 * - user = la clave propia del negocio (tabla business_avisos_movil, solo servidor);
 * - si no tiene, la clave global SOLO si el negocio es el dueño de esa clave; si no, null.
 */
export async function destinoPushover(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ token: string; user: string } | null> {
  const token = tokenPushover();
  if (!token) return null;

  const { data } = await supabase
    .from('business_avisos_movil')
    .select('pushover_user_key')
    .eq('business_id', businessId)
    .maybeSingle();
  const propia = String((data as { pushover_user_key?: string | null } | null)?.pushover_user_key ?? '').trim();
  if (propia) return { token, user: propia };

  const global = (process.env.PUSHOVER_USER_KEY ?? process.env.PUSHOVER_USER ?? '').trim();
  const dueno = (process.env.PUSHOVER_BUSINESS_ID ?? '').trim() || PUSHOVER_BUSINESS_ID_POR_DEFECTO;
  return global && businessId === dueno ? { token, user: global } : null;
}

export function recortarMensaje(texto: string, max = PUSHOVER_MAX_MENSAJE): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;
}

/** Devuelve true si Pushover aceptó el mensaje (status 1). Nunca lanza. */
export async function enviarPushover(args: {
  token: string;
  user: string;
  title: string;
  message: string;
  urgencia: UrgenciaAviso;
}): Promise<boolean> {
  try {
    const response = await fetch(PUSHOVER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: args.token,
        user: args.user,
        title: args.title,
        message: recortarMensaje(args.message),
        priority: String(PUSHOVER_PRIORIDAD[args.urgencia]),
      }),
    });
    const resultado = (await response.json()) as { status?: number };
    return resultado.status === 1;
  } catch {
    return false;
  }
}
