import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { isDemoReformasTenant } from '@/lib/demo-tenant';
import { DEMO_EMPRESA_EMISOR, DEMO_MOCK_ENABLED, getDemoFacturas, getDemoPresupuestos } from '@/lib/demo-data';
import { FacturaPdfDocument, type FacturaPdfProps } from '@/lib/pdf/factura';
import { nombreArchivoPresupuestoPdf, renderPresupuestoPdfConEmisor } from '@/lib/pdf/presupuesto-render';

export const runtime = 'nodejs';

/** Logo del emisor demo como data URI; si el fichero no está disponible, el PDF sale con el hueco habitual. */
async function logoDemoDataUri(): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'demo', 'orbegozo-logo.png'));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * PDF de presupuestos y facturas del mock demo, con el mismo render oficial que los PDF reales.
 * Solo sesión + tenant demo: nunca lee ni escribe datos en Supabase (el documento sale de lib/demo-data).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ tipo: string; id: string }> }
) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!DEMO_MOCK_ENABLED || !isDemoReformasTenant({ email: user.email })) {
      return NextResponse.json({ error: 'Solo disponible en la demo' }, { status: 403 });
    }

    const { tipo, id } = await context.params;

    if (tipo === 'presupuesto') {
      const pres = getDemoPresupuestos().find((p) => p.id === id);
      if (!pres) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      const res = await renderPresupuestoPdfConEmisor({ empresa: DEMO_EMPRESA_EMISOR, logoUrl: await logoDemoDataUri() }, pres);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
      return pdfResponse(res.buffer, nombreArchivoPresupuestoPdf(res.fecha));
    }

    if (tipo === 'factura') {
      const fac = getDemoFacturas().find((f) => f.id === id);
      if (!fac) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      const fecha = fac.fecha ?? fac.created_at.slice(0, 10);
      const base = fac.base_imponible ?? 0;
      const iva = fac.iva ?? 0;
      const numero = fac.numero_factura ?? fac.id;
      const factura: FacturaPdfProps['factura'] = {
        id: fac.id,
        numero_factura: numero,
        fecha,
        fecha_operacion: null,
        cliente_nombre: fac.cliente_nombre ?? '—',
        cliente_nif: fac.cliente_nif ?? undefined,
        cliente_direccion: fac.cliente_direccion ?? undefined,
        lineas: fac.lineas.map((l) => ({
          descripcion: l.concepto,
          cantidad: l.cantidad,
          precio_unitario: l.precio,
          importe: l.importe,
        })),
        base_imponible: base,
        iva,
        total: fac.total ?? Math.round((base + iva) * 100) / 100,
        observaciones: fac.observaciones ?? undefined,
      };
      const porcentajeIva = base > 0 ? Math.round((iva / base) * 1000) / 10 : 21;
      const buffer = await renderToBuffer(
        <FacturaPdfDocument
          factura={factura}
          logoUrl={await logoDemoDataUri()}
          empresa={DEMO_EMPRESA_EMISOR}
          porcentajeIva={porcentajeIva}
        />
      );
      return pdfResponse(buffer, `factura-${fecha.replace(/[^0-9-]/g, '')}-${numero}.pdf`);
    }

    return NextResponse.json({ error: 'Tipo no soportado' }, { status: 404 });
  } catch (e) {
    console.error('[api/demo/pdf]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

function pdfResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
