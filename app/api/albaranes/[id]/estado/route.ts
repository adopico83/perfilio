import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { cambiarEstadoAlbaran, ESTADOS_ALBARAN_EDITABLES } from '@/lib/albaranes/estado';

const ESTADOS_EDITABLES = ESTADOS_ALBARAN_EDITABLES;

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

    // Misma regla que usa el agente (lib/albaranes/estado.ts): un albarán facturado no se toca y la
    // condición va en el propio UPDATE para que dos peticiones a la vez no se pisen.
    const r = await cambiarEstadoAlbaran(supabase, businessId, id, estado);
    if (!r.ok) {
      const status = r.code === 'validacion' ? 400 : r.code === 'no_encontrado' ? 404 : r.code === 'conflicto' ? 409 : 500;
      return NextResponse.json({ error: r.error }, { status });
    }
    return NextResponse.json({ ok: true, id, estado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
