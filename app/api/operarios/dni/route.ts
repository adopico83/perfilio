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

export async function PATCH(request: NextRequest) {
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
    const businessId = typeof b.business_id === 'string' ? b.business_id.trim() : '';
    const operarioId = typeof b.operario_id === 'string' ? b.operario_id.trim() : '';
    const dniRaw = typeof b.dni === 'string' ? b.dni.trim() : '';

    if (!businessId || !operarioId) {
      return NextResponse.json(
        { error: 'business_id y operario_id son obligatorios' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: existingOperario, error: opErr } = await supabase
      .from('operarios')
      .select('id, business_id')
      .eq('id', operarioId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (opErr || !existingOperario?.id) {
      return NextResponse.json({ error: 'Operario no encontrado' }, { status: 404 });
    }

    const updatePayload: Record<string, unknown> = {
      dni: dniRaw || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updErr } = await supabase
      .from('operarios')
      .update(updatePayload)
      .eq('id', operarioId)
      .eq('business_id', businessId)
      .select('id, nombre, dni')
      .maybeSingle();

    if (updErr || !updated) {
      return NextResponse.json({ error: updErr?.message ?? 'No se pudo actualizar el DNI' }, { status: 500 });
    }

    return NextResponse.json({
      operario: {
        id: String(updated.id),
        nombre: String(updated.nombre ?? '').trim() || 'Sin nombre',
        dni: typeof updated.dni === 'string' && updated.dni.trim() ? updated.dni.trim() : null,
      },
    });
  } catch (e) {
    console.error('[api/operarios/dni PATCH]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
