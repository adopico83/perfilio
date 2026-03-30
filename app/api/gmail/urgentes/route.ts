import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const GMAIL_LIST = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_RESULTS = 10;

const KEYWORDS = [
  'urgente',
  'importante',
  'presupuesto',
  'factura pendiente',
  'pago',
  'vencimiento',
  'plazo',
  'impago',
  'reclamacion',
  'reclamación',
  'queja',
  'problema',
  'averia',
  'avería',
  'emergencia',
];

type GmailClasificado = {
  remitente: string | null;
  asunto: string | null;
  fechaIso: string | null;
  noLeido: boolean;
  cuerpo: string | null;
  motivoUrgencia: string[];
};

function normalizarTxt(v: string | null | undefined) {
  return (v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function contieneKeyword(texto: string) {
  return KEYWORDS.some((kw) => texto.includes(kw));
}

export async function GET() {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();

    if (!authUser?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: tokenRow, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('access_token, refresh_token, expiry_date')
      .eq('user_id', authUser.id)
      .single();

    if (tokenError || !tokenRow?.access_token) {
      return NextResponse.json({
        urgentes: [] as GmailClasificado[],
        normales: [] as GmailClasificado[],
        total_urgentes: 0,
        error: 'gmail_not_connected',
      });
    }

    const clientesSet = new Set<string>();
    const [presRows, facRows] = await Promise.all([
      supabase
        .from('presupuestos')
        .select('cliente_nombre')
        .limit(300),
      supabase
        .from('facturas')
        .select('cliente_nombre')
        .limit(300),
    ]);
    for (const r of presRows.data ?? []) {
      const n = normalizarTxt((r as { cliente_nombre?: string | null }).cliente_nombre ?? '');
      if (n) clientesSet.add(n);
    }
    for (const r of facRows.data ?? []) {
      const n = normalizarTxt((r as { cliente_nombre?: string | null }).cliente_nombre ?? '');
      if (n) clientesSet.add(n);
    }

    let accessToken: string = tokenRow.access_token;
    const refreshToken: string | null = tokenRow.refresh_token ?? null;
    const expiryDateMs = tokenRow.expiry_date ? new Date(tokenRow.expiry_date).getTime() : 0;

    if (refreshToken && expiryDateMs && expiryDateMs <= Date.now()) {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (refreshRes.ok) {
        const refreshed = (await refreshRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        if (refreshed.access_token) {
          accessToken = refreshed.access_token;
          const newExpiryDate = new Date(
            Date.now() + (refreshed.expires_in ?? 3600) * 1000
          ).toISOString();
          await supabase
            .from('gmail_tokens')
            .update({ access_token: accessToken, expiry_date: newExpiryDate })
            .eq('user_id', authUser.id);
        }
      }
    }

    const listRes = await fetch(
      `${GMAIL_LIST}?maxResults=${MAX_RESULTS}&labelIds=INBOX`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listRes.ok) {
      return NextResponse.json({
        urgentes: [] as GmailClasificado[],
        normales: [] as GmailClasificado[],
        total_urgentes: 0,
        error: 'gmail_fetch_failed',
      });
    }

    const listJson = (await listRes.json()) as { messages?: Array<{ id: string }> };
    const msgIds = listJson.messages ?? [];
    const urgentes: GmailClasificado[] = [];
    const normales: GmailClasificado[] = [];

    for (const msg of msgIds) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgRes.ok) continue;

      const msgJson = (await msgRes.json()) as {
        snippet?: string;
        threadId?: string;
        labelIds?: string[];
        internalDate?: string;
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const headers = msgJson.payload?.headers ?? [];
      const from =
        headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
      const subject =
        headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ?? null;
      const cuerpo = msgJson.snippet ?? null;
      const noLeido = (msgJson.labelIds ?? []).includes('UNREAD');
      const internalMs = msgJson.internalDate ? Number(msgJson.internalDate) : NaN;
      const fechaIso = Number.isFinite(internalMs) ? new Date(internalMs).toISOString() : null;

      const motivoUrgencia: string[] = [];
      const textoAnalisis = normalizarTxt(`${subject ?? ''} ${cuerpo ?? ''}`);
      if (contieneKeyword(textoAnalisis)) motivoUrgencia.push('palabra_clave');
      if (textoAnalisis.includes('re: presupuesto') || textoAnalisis.includes('respuesta presupuesto')) {
        motivoUrgencia.push('respuesta_presupuesto');
      }
      const fromNorm = normalizarTxt(from);
      if ([...clientesSet].some((c) => fromNorm.includes(c))) motivoUrgencia.push('cliente_conocido');
      if (noLeido && Number.isFinite(internalMs)) {
        const horas = (Date.now() - internalMs) / (1000 * 60 * 60);
        if (horas >= 48) motivoUrgencia.push('sin_leer_48h');
      }

      const email: GmailClasificado = {
        remitente: from,
        asunto: subject,
        fechaIso,
        noLeido,
        cuerpo,
        motivoUrgencia,
      };

      if (motivoUrgencia.length > 0) urgentes.push(email);
      else normales.push(email);
    }

    return NextResponse.json({
      urgentes,
      normales,
      total_urgentes: urgentes.length,
      error: null as string | null,
    });
  } catch (e) {
    console.error('GET /api/gmail/urgentes:', e);
    return NextResponse.json(
      {
        urgentes: [],
        normales: [],
        total_urgentes: 0,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
