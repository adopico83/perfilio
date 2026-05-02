import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const result = await handlePresupuestos(
      'convertir_presupuesto_a_factura',
      { presupuesto_id: presupuestoId },
      businessId,
      user.id,
      supabase,
      openai,
      {}
    );

    if (result && typeof result === 'object' && 'error' in result && result.error != null) {
      return NextResponse.json(
        { error: String(result.error) },
        { status: 400 }
      );
    }

    if (
      result &&
      typeof result === 'object' &&
      'ok' in result &&
      result.ok === true &&
      'numero_factura' in result
    ) {
      return NextResponse.json({
        ok: true,
        numero_factura: result.numero_factura as number,
        total: result.total as number,
        cliente_nombre: (result.cliente_nombre as string | null) ?? null,
      });
    }

    return NextResponse.json({ error: 'Respuesta inesperada al generar la factura' }, { status: 500 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
