import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  collectDiarioObraStoragePathsFromEntry,
  removeDiarioObraStorageObjects,
} from '@/lib/diario-obra';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = rawId?.trim() ?? '';
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id')?.trim() ?? '';
    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id es obligatorio en la query' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: row, error: fetchErr } = await supabase
      .from('diario_obra')
      .select('id, business_id, fotos, videos')
      .eq('id', id)
      .eq('business_id', business_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!row?.id) {
      return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 });
    }

    const paths = collectDiarioObraStoragePathsFromEntry({
      fotos: row.fotos as string[] | null,
      videos: row.videos as string[] | null,
    });
    await removeDiarioObraStorageObjects(supabase, paths);

    const { error: delErr } = await supabase
      .from('diario_obra')
      .delete()
      .eq('id', id)
      .eq('business_id', business_id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/diario/[id]:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
