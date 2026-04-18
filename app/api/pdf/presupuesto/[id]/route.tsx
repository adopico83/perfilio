import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { PresupuestoPdfDocument } from '@/lib/pdf/presupuesto';

export const runtime = 'nodejs';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
}

/** Nº legible desde `mensaje_cliente`: "Pre XX/YY" o "XX/YY"; si no, 8 primeros caracteres del id. */
function numeroPresupuestoDesdeMensaje(mensaje: string | null | undefined, id: string): string {
  const texto = String(mensaje ?? '');
  const conPre = texto.match(/Pre\s+\d{1,4}\/\d{1,4}/i);
  if (conPre) return conPre[0].replace(/\s+/g, ' ').trim();
  const solo = texto.match(/\b\d{1,4}\/\d{1,4}\b/);
  if (solo) return solo[0];
  const rid = String(id ?? '').trim();
  return rid.length > 0 ? rid.slice(0, 8) : '—';
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
    const { data: pres, error: presErr } = await supabase
      .from('presupuestos')
      .select(
        'id, business_id, presupuesto_generado, fecha, cliente_nombre, mensaje_cliente, obra_id, created_at, obras(nombre)'
      )
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

    const { data: profile, error: profErr } = await supabase
      .from('business_profiles')
      .select('logo_url')
      .eq('id', businessId)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    let logoUrl: string | null = null;
    const logoPath = (profile as { logo_url?: string | null } | null)?.logo_url?.trim();
    if (logoPath) {
      const path = logoPath.replace(/^\/+/, '');
      const { data: signed, error: signErr } = await supabase.storage
        .from('business-assets')
        .createSignedUrl(path, 3600);
      if (!signErr && signed?.signedUrl) {
        logoUrl = signed.signedUrl;
      }
    }

    const texto = String((pres as { presupuesto_generado?: string | null }).presupuesto_generado ?? '');
    const parsed = parsePresupuestoGenerado(texto);

    const fechaRaw = (pres as { fecha?: string | null }).fecha;
    const createdAt = (pres as { created_at?: string }).created_at;
    const fechaFallback =
      createdAt && createdAt.length >= 10 ? createdAt.slice(0, 10) : new Date().toISOString().split('T')[0];
    const fecha =
      fechaRaw && fechaRaw.trim().length > 0 ? fechaRaw.trim() : fechaFallback;

    const mensaje = (pres as { mensaje_cliente?: string | null }).mensaje_cliente;
    const numero = numeroPresupuestoDesdeMensaje(mensaje, pres.id as string);

    const obraJoin = (pres as { obras?: { nombre?: string } | { nombre?: string }[] | null }).obras;
    const obraNombre = Array.isArray(obraJoin) ? obraJoin[0]?.nombre : obraJoin?.nombre;
    const clienteNombre = (pres as { cliente_nombre?: string | null }).cliente_nombre;
    const referencia =
      (obraNombre && String(obraNombre).trim()) ||
      (clienteNombre && String(clienteNombre).trim()) ||
      '—';

    const buffer = await renderToBuffer(
      <PresupuestoPdfDocument
        logoUrl={logoUrl}
        numeroPresupuesto={numero}
        referencia={referencia}
        fecha={fecha}
        parsed={parsed}
        textoPlanoFallback={texto.trim() || '—'}
      />
    );

    const safeName = `presupuesto-${fecha.replace(/[^0-9-]/g, '')}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
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
