'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { subscribeToPush } from '@/components/pwa/pwa-register';

export default function NotificationButton() {
  const [perm, setPerm] = useState<'default' | 'granted' | 'denied' | 'hidden'>('hidden');
  const [busy, setBusy] = useState(false);
  const [permissionBefore, setPermissionBefore] = useState<string | null>(null);
  const [permissionAfter, setPermissionAfter] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    setErrorMessage(null);
    setPermissionBefore(null);
    setPermissionAfter(null);

    const before =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : '—';
    setPermissionBefore(before);

    try {
      await subscribeToPush();
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPerm(Notification.permission);
      }
    } catch (e) {
      console.log('subscribeToPush error', e);
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    } finally {
      const after =
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : '—';
      setPermissionAfter(after);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPerm(Notification.permission);
      }
      setBusy(false);
    }
  }, [busy]);

  const onTestPush = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setErrorMessage('No hay sesión para enviar la prueba.');
        return;
      }
      const { data: profile } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      const businessId = profile?.id;
      if (!businessId) {
        setErrorMessage('No hay negocio asociado.');
        return;
      }
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: businessId,
          titulo: 'Test Perfilio',
          mensaje: 'Notificación de prueba',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? `Error ${res.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (perm === 'hidden' || perm === 'denied') return null;

  return (
    <div className="flex flex-col items-end gap-1 max-w-full">
      {perm === 'default' ? (
        <>
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy}
            className="shrink-0 inline-flex items-center justify-center rounded-lg border border-[#ed8936]/45 bg-[#1a365d] px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#1e3a5f] hover:border-[#ed8936]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/60 disabled:cursor-wait disabled:opacity-70"
          >
            🔔 Activar notificaciones
          </button>
          {(permissionBefore || permissionAfter || errorMessage) && (
            <div className="text-[10px] sm:text-[11px] text-right leading-snug space-y-0.5 max-w-[min(100%,20rem)]">
              {permissionBefore !== null ? (
                <p className="text-white/50">
                  Permiso antes: <span className="text-white/80">{permissionBefore}</span>
                </p>
              ) : null}
              {permissionAfter !== null ? (
                <p className="text-white/50">
                  Permiso después: <span className="text-white/80">{permissionAfter}</span>
                </p>
              ) : null}
              {errorMessage ? (
                <p className="text-red-400 break-words">{errorMessage}</p>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {perm === 'granted' ? (
        <>
          <button
            type="button"
            onClick={() => void onTestPush()}
            disabled={busy}
            className="shrink-0 inline-flex items-center justify-center rounded-md border border-white/15 bg-[#1a365d]/90 px-2 py-1 text-[11px] font-medium text-white/90 shadow-sm transition-colors hover:bg-[#1e3a5f] hover:border-[#ed8936]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/50 disabled:cursor-wait disabled:opacity-70"
          >
            Probar notificación
          </button>
          {errorMessage ? (
            <p className="text-[10px] sm:text-[11px] text-right text-red-400 break-words max-w-[min(100%,20rem)]">
              {errorMessage}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
