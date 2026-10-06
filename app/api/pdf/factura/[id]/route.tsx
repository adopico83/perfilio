import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import {
  FACTURA_PDF_COLUMNS,
  nombreArchivoFacturaPdf,
  renderFacturaPdf,
  type FacturaPdfRow,
} from '@/lib/pdf/factura-render';
import type { EmpresaLoaderClient } from '@/lib/pdf/empresa';

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
    const { data: fac, error: facErr } = await supabase
      .from('facturas')
      .select(FACTURA_PDF_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (facErr) {
      return NextResponse.json({ error: facErr.message }, { status: 500 });
    }
    if (!fac) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const row = fac as unknown as FacturaPdfRow & { business_id: string };
    const businessId = row.business_id;
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) {
      return NextResponse.json({ error: 'No tienes acceso' }, { status: 403 });
    }

    const rendered = await renderFacturaPdf(supabase as unknown as EmpresaLoaderClient, businessId, row);
    if (!rendered.ok) {
      return NextResponse.json({ error: rendered.error }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivoFacturaPdf(rendered.fecha, rendered.numero_factura)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[api/pdf/factura]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
