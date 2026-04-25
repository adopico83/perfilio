import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

type ConversationSummary = {
  conversation_id: string;
  titulo: string;
  created_at: string;
  total_mensajes: number;
};

function truncarTitulo(text: string, max = 60) {
  const t = text.trim();
  if (!t) return 'Nueva conversación';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const businessId = (url.searchParams.get('business_id') ?? '').trim();

    if (!businessId) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('conversation_history')
      .select('conversation_id, role, content, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byId = new Map<string, ConversationSummary>();
    const rows = (data ?? []) as Array<{
      conversation_id?: string | null;
      role?: string | null;
      content?: string | null;
      created_at?: string | null;
    }>;

    for (const r of rows) {
      const cid = String(r.conversation_id ?? '').trim();
      if (!cid) continue;
      const createdAt = String(r.created_at ?? '').trim() || new Date(0).toISOString();
      const existing = byId.get(cid);

      if (!existing) {
        byId.set(cid, {
          conversation_id: cid,
          titulo: r.role === 'user' ? truncarTitulo(String(r.content ?? '')) : 'Nueva conversación',
          created_at: createdAt,
          total_mensajes: 1,
        });
        continue;
      }

      existing.total_mensajes += 1;
      // El primer mensaje cronológico tendrá created_at más antiguo.
      if (createdAt < existing.created_at) {
        existing.created_at = createdAt;
      }
      if (r.role === 'user' && existing.titulo === 'Nueva conversación') {
        existing.titulo = truncarTitulo(String(r.content ?? ''));
      }
    }

    const conversaciones = [...byId.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20);

    return NextResponse.json({ conversaciones });
  } catch (e) {
    console.error('GET /api/agente/conversaciones:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

