/// <reference path="../../../../types/web-push.d.ts" />
import { NextRequest, NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/server';

const TZ = 'Europe/Madrid';

function formatYmdInTimeZone(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  const da = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${mo}-${da}`;
}

function minutesSinceMidnightInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** Misma lógica que en `crear_recordatorio` (route agente) para interpretar hora guardada. */
function normalizeHora(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  m = s.match(/^(\d{1,2})\s*h$/i);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  const low = s.toLowerCase();
  const mañana = low.includes('mañana') || low.includes('manana');
  const tarde = low.includes('tarde');
  const noche = low.includes('noche');

  m = s.match(/(?:a\s+las|^las)\s+(\d{1,2})(?::(\d{2}))?/i);
  if (!m) {
    m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  }
  if (!m) {
    m = s.match(/(\d{1,2})\s*(?:de\s+la\s+)?(?:mañana|manana)/i);
  }
  if (m) {
    let h = Number(m[1]);
    const min = m[2] != null && m[2] !== '' ? Number(m[2]) : 0;
    if (Number.isNaN(min) || min < 0 || min > 59) return null;
    if (tarde && h >= 1 && h <= 11) {
      h += 12;
    } else if (noche && h >= 1 && h <= 11) {
      h += 12;
    } else if (mañana && h >= 1 && h <= 11) {
      /* mañana */
    }
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseHmToMinutes(hm: string): number {
  const [a, b] = hm.split(':').map((x) => Number(x));
  return a * 60 + b;
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

async function sendPushToBusiness(
  businessId: string,
  title: string,
  body: string
): Promise<{ sent: number; errors: string[] }> {
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('business_id', businessId);

  if (error) {
    return { sent: 0, errors: [error.message] };
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: '/icons/icon-192x192.png',
  });

  let sent = 0;
  const errors: string[] = [];
  for (const row of rows ?? []) {
    const sub = row.subscription as import('web-push').PushSubscription | null;
    if (!sub?.endpoint) continue;
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60 });
      sent += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'send failed');
    }
  }
  return { sent, errors };
}

type AgendaRow = {
  id: string;
  business_id: string;
  titulo: string | null;
  fecha: string | null;
  hora: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    const auth = request.headers.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!secret || bearer !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    configureWebPush();

    const now = new Date();
    const hoyYmd = formatYmdInTimeZone(now, TZ);
    const nowMinutes = minutesSinceMidnightInTimeZone(now, TZ);
    const partsHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hourM = Number(partsHm.find((p) => p.type === 'hour')?.value ?? '0');
    const minuteM = Number(partsHm.find((p) => p.type === 'minute')?.value ?? '0');
    const isSummaryWindow = hourM === 8 && minuteM >= 0 && minuteM < 10;

    const supabase = createServiceClient();
    const { data: agendaRows, error: agendaErr } = await supabase
      .from('agenda')
      .select('id, business_id, titulo, fecha, hora')
      .eq('fecha', hoyYmd)
      .eq('completado', false);

    if (agendaErr) {
      return NextResponse.json({ error: agendaErr.message }, { status: 500 });
    }

    const rows = (agendaRows ?? []) as AgendaRow[];
    const punctual: AgendaRow[] = [];
    const summary: AgendaRow[] = [];

    for (const row of rows) {
      const horaRaw = row.hora != null ? String(row.hora).trim() : '';
      const normalized = horaRaw ? normalizeHora(horaRaw) : null;
      if (!horaRaw || normalized === null) {
        summary.push(row);
      } else {
        punctual.push(row);
      }
    }

    let punctualSent = 0;
    const punctualErrors: string[] = [];

    for (const row of punctual) {
      const horaRaw = String(row.hora ?? '').trim();
      const normalized = normalizeHora(horaRaw);
      if (!normalized) continue;
      const eventMinutes = parseHmToMinutes(normalized);
      if (eventMinutes >= nowMinutes && eventMinutes < nowMinutes + 10) {
        const titulo = String(row.titulo ?? '').trim() || 'Recordatorio';
        const r = await sendPushToBusiness(
          row.business_id,
          'Perfilio — Recordatorio',
          titulo
        );
        punctualSent += r.sent;
        punctualErrors.push(...r.errors);
      }
    }

    let summarySent = 0;
    const summaryErrors: string[] = [];

    if (isSummaryWindow && summary.length > 0) {
      const byBusiness = new Map<string, string[]>();
      for (const row of summary) {
        const t = String(row.titulo ?? '').trim() || '(sin título)';
        const list = byBusiness.get(row.business_id) ?? [];
        list.push(t);
        byBusiness.set(row.business_id, list);
      }
      for (const [businessId, titulos] of byBusiness) {
        const x = titulos.length;
        const body = `Tienes ${x} recordatorio(s) hoy: ${titulos.join(', ')}`;
        const r = await sendPushToBusiness(
          businessId,
          'Perfilio — Recordatorio',
          body
        );
        summarySent += r.sent;
        summaryErrors.push(...r.errors);
      }
    }

    return NextResponse.json({
      ok: true,
      fecha: hoyYmd,
      nowMinutes,
      isSummaryWindow,
      punctualCandidates: punctual.length,
      summaryCandidates: summary.length,
      punctualSent,
      summarySent,
      errores:
        [...punctualErrors, ...summaryErrors].length > 0
          ? [...punctualErrors, ...summaryErrors]
          : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error cron agenda-push' },
      { status: 500 }
    );
  }
}
