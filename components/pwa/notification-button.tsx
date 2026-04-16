'use client';

import { useCallback, useEffect, useState } from 'react';
import { subscribeToPush } from '@/components/pwa/pwa-register';

export default function NotificationButton() {
  const [perm, setPerm] = useState<'default' | 'granted' | 'denied' | 'hidden'>('hidden');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPerm('hidden');
      return;
    }
    setPerm(Notification.permission === 'default' ? 'default' : Notification.permission);
  }, []);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await subscribeToPush();
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPerm(Notification.permission);
      }
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (perm !== 'default') return null;

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      className="shrink-0 inline-flex items-center justify-center rounded-lg border border-[#ed8936]/45 bg-[#1a365d] px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#1e3a5f] hover:border-[#ed8936]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/60 disabled:cursor-wait disabled:opacity-70"
    >
      🔔 Activar notificaciones
    </button>
  );
}
