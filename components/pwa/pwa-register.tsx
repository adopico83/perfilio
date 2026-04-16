'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob === 'function' ? atob(base64) : '';
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Flujo completo de permiso + suscripción push + registro en servidor.
 * Debe llamarse desde un gesto de usuario (p. ej. click) para cumplir con iOS Safari.
 */
export async function subscribeToPush(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.ready;

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublic || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublic),
    }));

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return;

  const { data: profile } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const businessId = profile?.id;
  if (!businessId) return;

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      business_id: businessId,
      subscription: sub.toJSON(),
    }),
  });
}

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const run = async () => {
      try {
        if (!('serviceWorker' in navigator)) return;

        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        if (cancelled) return;

        await reg.update().catch(() => {});
      } catch {
        /* registro PWA opcional */
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
