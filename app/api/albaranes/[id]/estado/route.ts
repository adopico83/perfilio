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

    // La condición va EN el UPDATE (no solo en la lectura de arriba): si otra petición factura el
    // albarán justo entre la lectura y la escritura, este UPDATE no toca ninguna fila.
    // `.or('estado.is.null,…')` y no solo `.neq`: en SQL `NULL <> 'facturado'` no es verdadero, así
    // que un albarán con estado NULL (la columna lo admite) no se actualizaría nunca.
    const { data: filas, error: updErr } = await supabase
      .from('albaranes')
      .update({ estado })
      .eq('id', id)
      .eq('business_id', businessId)
      .or('estado.is.null,estado.neq.facturado')
      .select('id');
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    if (!filas || filas.length === 0) {
      // Ninguna fila cambió: se ha facturado mientras tanto (o ya no existe).
      const { data: ahora } = await supabase
        .from('albaranes')
        .select('id')
        .eq('id', id)
        .eq('business_id', businessId)
        .maybeSingle();
      if (!ahora) return NextResponse.json({ error: 'Albarán no encontrado' }, { status: 404 });
      return NextResponse.json(
        { error: 'El albarán se ha facturado mientras tanto: ya no cambia de estado.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, id, estado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
