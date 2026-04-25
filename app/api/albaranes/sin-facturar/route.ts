import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { listarAlbaranesSinFacturar } from '@/lib/albaranes-sin-facturar';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  try {
    const { data } = await supabaseAuth
      .from('business_users')
      .select('business_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data?.business_id);
  } catch {
    // Compatibilidad con mocks/tests que todavía no exponen business_users.
  }

  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
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

    const business_id = request.nextUrl.searchParams.get('business_id')?.trim() ?? '';
    if (!business_id) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { albaranes, total } = await listarAlbaranesSinFacturar(supabase, business_id);

    return NextResponse.json({ albaranes, total });
  } catch (e) {
    console.error('[api/albaranes/sin-facturar GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
