import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { loadEmpresaEmisor } from '@/lib/pdf/empresa';
import {
  FacturaPdfDocument,
  type FacturaPdfProps,
} from '@/lib/pdf/factura';

export const runtime = 'nodejs';

function parseFacturaLineas(raw: unknown): FacturaPdfProps['factura']['lineas'] {
  if (raw == null) return [];
  let arr: unknown[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      arr = Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }

  return arr.map((row) => {
    const o = row as Record<string, unknown>;
    const descripcion = String(o.descripcion ?? '').trim() || '—';
    const cantidad = Number(o.cantidad ?? 0);
    const precio_unitario = Number(o.precio_unitario ?? o.precio ?? 0);
    const importe =
      o.importe != null && String(o.importe).trim() !== ''
        ? Number(o.importe)
        : Number.isFinite(cantidad) && Number.isFinite(precio_unitario)
          ? Math.round(cantidad * precio_unitario * 100) / 100
          : 0;
    const capitulo =
      o.capitulo != null && String(o.capitulo).trim() ? String(o.capitulo).trim() : undefined;
    return {
      descripcion,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      precio_unitario: Number.isFinite(precio_unitario) ? precio_unitario : 0,
      importe: Number.isFinite(importe) ? importe : 0,
      capitulo,
    };
  });
}

function numFromDb(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

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
      .select(
        'id, business_id, numero_factura, fecha, cliente_nombre, cliente_nif, cliente_direccion, lineas, base_imponible, iva, total, observaciones, created_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (facErr) {
      return NextResponse.json({ error: facErr.message }, { status: 500 });
    }
    if (!fac?.id) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const businessId = fac.business_id as string;
    const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!owns) {
      return NextResponse.json({ error: 'No tienes acceso' }, { status: 403 });
    }

    const emisor = await loadEmpresaEmisor(supabase, businessId);
    if (!emisor.ok) {
      return NextResponse.json({ error: emisor.error }, { status: 500 });
    }

    const fechaRaw = (fac as { fecha?: string | null }).fecha;
    const createdAt = (fac as { created_at?: string }).created_at;
    const fechaFallback =
      createdAt && createdAt.length >= 10 ? createdAt.slice(0, 10) : new Date().toISOString().split('T')[0];
    const fecha =
      fechaRaw && String(fechaRaw).trim().length > 0 ? String(fechaRaw).trim() : fechaFallback;

    const baseImponible = numFromDb((fac as { base_imponible?: unknown }).base_imponible);
    const ivaImporte = numFromDb((fac as { iva?: unknown }).iva);
    const total = numFromDb((fac as { total?: unknown }).total);
    const porcentajeIva =
      baseImponible > 0 ? Math.round((ivaImporte / baseImponible) * 1000) / 10 : 21;

    const nRaw = (fac as { numero_factura?: number | string | null }).numero_factura;
    const numero_factura =
      nRaw != null && Number.isFinite(Number(nRaw)) ? Number(nRaw) : 0;

    const facturaPayload: FacturaPdfProps['factura'] = {
      id: fac.id as string,
      numero_factura,
      fecha,
      fecha_operacion: null,
      cliente_nombre: String((fac as { cliente_nombre?: string | null }).cliente_nombre ?? '—'),
      cliente_nif: (fac as { cliente_nif?: string | null }).cliente_nif ?? undefined,
      cliente_direccion: (fac as { cliente_direccion?: string | null }).cliente_direccion ?? undefined,
      lineas: parseFacturaLineas((fac as { lineas?: unknown }).lineas),
      base_imponible: baseImponible,
      iva: ivaImporte,
      total: total > 0 ? total : Math.round((baseImponible + ivaImporte) * 100) / 100,
      observaciones: (fac as { observaciones?: string | null }).observaciones ?? undefined,
    };

    const buffer = await renderToBuffer(
      <FacturaPdfDocument
        factura={facturaPayload}
        logoUrl={emisor.logoUrl}
        empresa={emisor.empresa}
        porcentajeIva={porcentajeIva}
      />
    );

    const safeName = `factura-${fecha.replace(/[^0-9-]/g, '')}-${numero_factura}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[api/pdf/factura]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
