import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { crearFacturaDesdePresupuesto } from '@/lib/facturas/desde-presupuesto';

/** Botón «Generar factura» de la pantalla de presupuestos. */
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

    // Primero averiguamos de qué negocio es el presupuesto y comprobamos que el usuario es de ese
    // negocio; a partir de ahí todo se filtra por ese business_id.
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

    const r = await crearFacturaDesdePresupuesto(supabase, businessId, presupuestoId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, code: r.code, cliente_id: r.cliente_id ?? null },
        { status: r.code === 'error' ? 500 : 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      factura_id: r.factura_id,
      numero_factura: r.numero_factura,
      total: r.total,
      cliente_nombre: r.cliente_nombre,
      ya_existia: r.ya_existia,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
