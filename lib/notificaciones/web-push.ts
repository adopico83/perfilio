import * as webpush from 'web-push';

/** Configura las claves VAPID; lanza si faltan. Compartido por /api/push/send y el resumen diario. */
export function configurarWebPush(): void {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_MAILTO ?? 'mailto:hello@perfilio.app';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys no configuradas');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export { webpush };
