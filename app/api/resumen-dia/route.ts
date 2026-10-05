import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { cargarResumenDia } from '@/lib/resumen-diario/datos';

/** Resumen del día en vivo para la tarjeta «Hoy» de la pantalla de inicio. */
export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const businessId = request.nextUrl.searchParams.get('business_id')?.trim() ?? '';
    if (!businessId) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const resumen = await cargarResumenDia(createServiceClient(), businessId);
    return NextResponse.json({ resumen });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error calculando el resumen' },
      { status: 500 }
    );
  }
}
