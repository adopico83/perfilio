import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';

const ESTADOS_FACTURA = ['pendiente', 'pagada', 'vencida'] as const;

/**
 * Cambia el estado de una factura. `facturas` solo tiene policy de lectura, así que las
 * escrituras pasan por aquí (service role) tras comprobar que el usuario es del negocio.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id?.trim()) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { estado?: unknown };
    const estado = typeof body.estado === 'string' ? body.estado.trim().toLowerCase() : '';
    if (!(ESTADOS_FACTURA as readonly string[]).includes(estado)) {
      return NextResponse.json(
        { error: `estado debe ser uno de: ${ESTADOS_FACTURA.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: fac, error: facErr } = await supabase
      .from('facturas')
      .select('id, business_id')
      .eq('id', id)
      .maybeSingle();
    if (facErr) return NextResponse.json({ error: facErr.message }, { status: 500 });
    if (!fac?.id) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });

    const businessId = String((fac as { business_id?: string }).business_id ?? '');
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });

    const { error: updErr } = await supabase
      .from('facturas')
      .update({ estado })
      .eq('id', id)
      .eq('business_id', businessId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, id, estado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
