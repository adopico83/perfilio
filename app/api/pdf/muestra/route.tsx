import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverAccesoNegocio } from '@/lib/negocio/acceso';
import { presupuestoMuestra } from '@/lib/pdf/muestra';
import { renderPresupuestoPdf } from '@/lib/pdf/presupuesto-render';
import type { EmpresaLoaderClient } from '@/lib/pdf/empresa';

export const runtime = 'nodejs';

/** PDF de muestra con la marca guardada del negocio. Presupuesto inventado: no lee ni escribe datos reales. */
export async function GET(request: NextRequest) {
  try {
    const acceso = await resolverAccesoNegocio(request);
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const supabase = createServiceClient();
    const rendered = await renderPresupuestoPdf(
      supabase as unknown as EmpresaLoaderClient,
      acceso.businessId,
      presupuestoMuestra()
    );
    if (!rendered.ok) return NextResponse.json({ error: rendered.error }, { status: 500 });

    return new NextResponse(new Uint8Array(rendered.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="presupuesto-muestra.pdf"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[api/pdf/muestra]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
