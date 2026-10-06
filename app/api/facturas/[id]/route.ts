import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { actualizarFactura } from '@/lib/facturas/editar';

/**
 * Edita una factura (cliente, líneas e IVA). `facturas` solo tiene policy de lectura, así que la
 * escritura pasa por aquí (service role) tras comprobar que el usuario es del negocio de la
 * factura. Los importes los calcula el servidor; los que mande el cliente se ignoran.
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo de la petición inválido' }, { status: 400 });
    }

    // El negocio sale de la factura (no del cuerpo): se lee y se comprueba que es del usuario.
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

    const r = await actualizarFactura(supabase, businessId, id, body);
    if (!r.ok) {
      const status =
        r.code === 'validacion' ? 400 : r.code === 'no_encontrada' ? 404 : r.code === 'no_editable' ? 409 : 500;
      return NextResponse.json({ error: r.error, code: r.code }, { status });
    }
    return NextResponse.json({ ok: true, factura: r.factura });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
