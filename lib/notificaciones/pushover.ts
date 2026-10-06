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
