import { NextRequest, NextResponse } from 'next/server';
import * as z from 'zod/v4';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { crearFacturaDesdeAlbaran } from '@/lib/facturas/desde-albaran';

const cuerpoSchema = z.object({
  iva_porcentaje: z.number().optional(),
  observaciones: z.string().trim().max(1000).nullish(),
});

/**
 * Crea la factura de un albarán. `albaranes` y `facturas` solo tienen policy de lectura, así que
 * la escritura pasa por aquí (service role) tras comprobar que el usuario es del negocio del albarán.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id?.trim()) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = cuerpoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Cuerpo de la petición inválido', code: 'validacion' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: alb, error: albErr } = await supabase
      .from('albaranes')
      .select('id, business_id')
      .eq('id', id)
      .maybeSingle();
    if (albErr) return NextResponse.json({ error: albErr.message }, { status: 500 });
    if (!alb?.id) return NextResponse.json({ error: 'Albarán no encontrado' }, { status: 404 });

    const businessId = String((alb as { business_id?: string }).business_id ?? '');
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });

    const r = await crearFacturaDesdeAlbaran(supabase, businessId, id, {
      iva_porcentaje: parsed.data.iva_porcentaje,
      observaciones: parsed.data.observaciones,
    });
    if (!r.ok) {
      const status =
        r.code === 'validacion' ? 400 : r.code === 'no_encontrado' ? 404 : r.code === 'facturado_sin_factura' ? 409 : 500;
      return NextResponse.json({ error: r.error, code: r.code }, { status });
    }
    return NextResponse.json({
      ok: true,
      factura_id: r.factura_id,
      numero_factura: r.numero_factura,
      total: r.total,
      ya_existia: r.ya_existia,
      ...(r.aviso ? { aviso: r.aviso } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
