/// <reference path="../../../../types/web-push.d.ts" />
import { NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/server';

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_MAILTO ?? 'mailto:hello@perfilio.app';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys no configuradas');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function POST() {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'No disponible en producción' }, { status: 403 });
    }

    configureWebPush();

    const supabase = createServiceClient();
    const { data: rows, error } = await supabase.from('push_subscriptions').select('subscription');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = JSON.stringify({
      title: 'Test Perfilio',
      body: 'Notificación de prueba',
      icon: '/icons/icon-192x192.png',
    });

    const list = rows ?? [];
    let sent = 0;
    const errors: string[] = [];

    for (const row of list) {
      const sub = row.subscription as import('web-push').PushSubscription | null;
      if (!sub?.endpoint) continue;
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 60 * 60,
        });
        sent += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'send failed');
      }
    }

    return NextResponse.json({
      ok: true,
      enviados: sent,
      total: list.length,
      errores: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error enviando push' },
      { status: 500 }
    );
  }
}
