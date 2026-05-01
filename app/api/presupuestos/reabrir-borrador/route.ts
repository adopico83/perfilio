import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { presupuesto_id?: unknown };
    const presupuestoId = String(body.presupuesto_id ?? '').trim();
    if (!presupuestoId) {
      return NextResponse.json({ error: 'presupuesto_id es obligatorio' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: pres, error: pErr } = await supabase
      .from('presupuestos')
      .select('id, business_id')
      .eq('id', presupuestoId)
      .maybeSingle();
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!pres?.id) return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });

    const businessId = String((pres as { business_id?: string }).business_id ?? '').trim();
    if (!businessId) return NextResponse.json({ error: 'Negocio inválido' }, { status: 400 });
    const canAccess = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!canAccess) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const { data: borrador, error: bErr } = await supabase
      .from('presupuesto_borrador')
      .select('id')
      .eq('business_id', businessId)
      .eq('presupuesto_id', presupuestoId)
      .maybeSingle();
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
    if (!borrador?.id) {
      return NextResponse.json(
        { error: 'No existe borrador vinculado a este presupuesto' },
        { status: 404 }
      );
    }

    const { error: cancelErr } = await supabase
      .from('presupuesto_borrador')
      .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('estado', 'en_construccion')
      .neq('id', borrador.id);
    if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });

    const { data: reopened, error: upErr } = await supabase
      .from('presupuesto_borrador')
      .update({ estado: 'en_construccion', user_id: user.id, updated_at: new Date().toISOString() })
      .eq('id', borrador.id)
      .eq('business_id', businessId)
      .select('id')
      .maybeSingle();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!reopened?.id) return NextResponse.json({ error: 'No se pudo reabrir el borrador' }, { status: 500 });

    return NextResponse.json({ ok: true, borrador_id: reopened.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
