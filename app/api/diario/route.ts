import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  fetchDiarioObraEntries,
  groupDiarioEntriesByObra,
  insertDiarioObraEntry,
} from '@/lib/diario-obra';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const business_id = typeof b.business_id === 'string' ? b.business_id.trim() : '';
    const obra_nombre = typeof b.obra_nombre === 'string' ? b.obra_nombre.trim() : '';
    const obra_direccion =
      typeof b.obra_direccion === 'string' ? b.obra_direccion.trim() : undefined;
    const texto = typeof b.texto === 'string' ? b.texto.trim() : undefined;
    const fotos = Array.isArray(b.fotos)
      ? b.fotos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : undefined;
    const videos = Array.isArray(b.videos)
      ? b.videos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : undefined;

    if (!business_id || !obra_nombre) {
      return NextResponse.json(
        { error: 'business_id y obra_nombre son obligatorios' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data, error } = await insertDiarioObraEntry(supabase, {
      business_id,
      obra_nombre,
      obra_direccion: obra_direccion || null,
      texto: texto || null,
      fotos: fotos ?? null,
      videos: videos ?? null,
    });

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudo crear la entrada' },
        { status: 500 }
      );
    }

    return NextResponse.json({ entrada: data });
  } catch (e) {
    console.error('POST /api/diario:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id')?.trim() ?? '';
    const obra_nombre = searchParams.get('obra_nombre')?.trim() ?? '';

    if (!business_id) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data, error } = await fetchDiarioObraEntries(
      supabase,
      business_id,
      obra_nombre || null
    );

    if (error || data === null) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudieron listar las entradas' },
        { status: 500 }
      );
    }

    if (obra_nombre) {
      return NextResponse.json({ entradas: data });
    }

    return NextResponse.json({
      agrupado_por_obra: groupDiarioEntriesByObra(data),
    });
  } catch (e) {
    console.error('GET /api/diario:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
