import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';

const ESTADOS_EDITABLES = ['pendiente', 'entregado'] as const;

/**
 * Cambia el estado de un albarán a pendiente o entregado. `albaranes` solo tiene policy de lectura
 * (un UPDATE desde el navegador no cambiaría ninguna fila), así que se hace aquí con service role.
 * Para «facturado» hay que pasar por POST /api/albaranes/[id]/facturar.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    if (estado === 'facturado') {
      return NextResponse.json(
        { error: 'Para marcar un albarán como facturado hay que crear su factura (POST /api/albaranes/[id]/facturar).' },
        { status: 400 }
      );
    }
    if (!(ESTADOS_EDITABLES as readonly string[]).includes(estado)) {
      return NextResponse.json({ error: `estado debe ser uno de: ${ESTADOS_EDITABLES.join(', ')}` }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: alb, error: albErr } = await supabase
      .from('albaranes')
      .select('id, business_id, estado')
      .eq('id', id)
      .maybeSingle();
    if (albErr) return NextResponse.json({ error: albErr.message }, { status: 500 });
    if (!alb?.id) return NextResponse.json({ error: 'Albarán no encontrado' }, { status: 404 });

    const businessId = String((alb as { business_id?: string }).business_id ?? '');
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });

    if (String((alb as { estado?: string }).estado ?? '').toLowerCase() === 'facturado') {
      return NextResponse.json({ error: 'Un albarán facturado ya no cambia de estado.' }, { status: 409 });
    }

    const { data: filas, error: updErr } = await supabase
      .from('albaranes')
      .update({ estado })
      .eq('id', id)
      .eq('business_id', businessId)
      .select('id');
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    if (!filas || filas.length === 0) {
      return NextResponse.json({ error: 'Albarán no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id, estado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
