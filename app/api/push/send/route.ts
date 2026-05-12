import { NextRequest, NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { createClient, createServiceClient } from '@/lib/supabase/server';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const businessUsersQuery = supabaseAuth.from('business_users');
  if ('select' in businessUsersQuery && typeof businessUsersQuery.select === 'function') {
    const { data } = await businessUsersQuery
      .select('business_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data?.business_id);
  }

  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_MAILTO ?? 'mailto:hello@perfilio.app';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys no configuradas');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await request.json()) as {
      business_id?: string;
      titulo?: string;
      mensaje?: string;
    };
    const business_id = body.business_id?.trim() ?? '';
    const titulo = body.titulo?.trim() ?? '';
    const mensaje = body.mensaje?.trim() ?? '';

    if (!business_id || !titulo || !mensaje) {
      return NextResponse.json(
        { error: 'business_id, titulo y mensaje son obligatorios' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    configureWebPush();

    const supabase = createServiceClient();
    const { data: rows, error } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('business_id', business_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = JSON.stringify({
      title: titulo,
      body: mensaje,
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
