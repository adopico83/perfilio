import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

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

export async function GET(
  _request: NextRequest,
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

    const { id: clienteId } = await context.params;
    const id = clienteId?.trim() ?? '';
    if (!id) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: cliente, error: cErr } = await supabase
      .from('clientes')
      .select('id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (cErr || !cliente) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    }

    const businessId = cliente.business_id as string;
    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const [presRes, facRes, albRes, dioRes] = await Promise.all([
      supabase
        .from('presupuestos')
        .select('id, estado, importe_total, fecha, created_at')
        .eq('cliente_id', id)
        .eq('business_id', businessId)
        .order('fecha', { ascending: false }),
      supabase
        .from('facturas')
        .select('id, estado, total, fecha, numero_factura, created_at')
        .eq('cliente_id', id)
        .eq('business_id', businessId)
        .order('fecha', { ascending: false }),
      supabase
        .from('albaranes')
        .select('id, estado, fecha, total, numero_albaran, created_at')
        .eq('cliente_id', id)
        .eq('business_id', businessId)
        .order('fecha', { ascending: false }),
      supabase
        .from('diario_obra')
        .select('id, obra_nombre, obra_direccion, texto, fecha, fotos, videos, created_at')
        .eq('cliente_id', id)
        .eq('business_id', businessId)
        .order('fecha', { ascending: false }),
    ]);

    return NextResponse.json({
      cliente,
      presupuestos: presRes.data ?? [],
      facturas: facRes.data ?? [],
      albaranes: albRes.data ?? [],
      diario_obra: dioRes.data ?? [],
    });
  } catch (e) {
    console.error('[api/clientes/[id] GET]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
