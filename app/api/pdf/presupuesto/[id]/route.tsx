import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import {
  PRESUPUESTO_PDF_COLUMNS,
  nombreArchivoPresupuestoPdf,
  renderPresupuestoPdf,
} from '@/lib/pdf/presupuesto-render';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: pres, error: presErr } = await supabase
      .from('presupuestos')
      .select(PRESUPUESTO_PDF_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (presErr) {
      return NextResponse.json({ error: presErr.message }, { status: 500 });
    }
    if (!pres?.id) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const businessId = pres.business_id as string;
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) {
      return NextResponse.json({ error: 'No tienes acceso' }, { status: 403 });
    }

    const rendered = await renderPresupuestoPdf(supabase, businessId, pres);
    if (!rendered.ok) {
      return NextResponse.json({ error: rendered.error }, { status: 500 });
    }

    const safeName = nombreArchivoPresupuestoPdf(rendered.fecha);

    return new NextResponse(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[api/pdf/presupuesto]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
