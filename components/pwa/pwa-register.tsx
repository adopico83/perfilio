'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

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
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('No hay sesión de usuario activa');
  }
  const businessId = await getBusinessIdClient(supabase);
  if (!businessId) {
    throw new Error(`No se encontró negocio para el usuario ${user.email}`);
  }

  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.ready;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!('Notification' in window)) {
    throw new Error('Error en requestPermission: Notifications API no disponible');
  }

  if (Notification.permission !== 'granted') {
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Error en requestPermission: ${msg}`);
    }
    const result = permission;
    if (result !== 'granted') {
      throw new Error(
        'Error en requestPermission: permiso denegado o ignorado (resultado: ' + result + ')'
      );
    }
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublic || !('PushManager' in window)) return;

  let sub: PushSubscription;
  try {
    const existing = await reg.pushManager.getSubscription();
    sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Error en pushManager.subscribe: ${msg}`);
  }

  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        business_id: businessId,
        subscription: sub.toJSON(),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Error en POST')) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Error en POST /api/push/subscribe: ${msg}`);
  }
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
