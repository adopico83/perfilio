import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverAccesoNegocio } from '@/lib/negocio/acceso';
import { COLUMNAS_AJUSTES, validarAjustesNegocio } from '@/lib/negocio/ajustes';

export const runtime = 'nodejs';

const SELECT = COLUMNAS_AJUSTES.join(', ');

/** Datos fiscales + marca del negocio (para el formulario de Ajustes). */
export async function GET(request: NextRequest) {
  try {
    const acceso = await resolverAccesoNegocio(request);
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('business_profiles')
      .select(SELECT)
      .eq('id', acceso.businessId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const perfil = (data ?? {}) as unknown as Record<string, string | null>;
    let logoUrl: string | null = null;
    const ruta = perfil.logo_url?.replace(/^\/+/, '');
    if (ruta) {
      const firmada = await supabase.storage.from('business-assets').createSignedUrl(ruta, 3600);
      logoUrl = firmada.data?.signedUrl ?? null;
    }
    const { logo_url: _logo, ...resto } = perfil;
    void _logo;
    return NextResponse.json({ business_id: acceso.businessId, ajustes: resto, logo_url_firmada: logoUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}

/** Guarda datos fiscales y marca. Solo se aceptan las columnas de la lista blanca. */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const acceso = await resolverAccesoNegocio(
      request,
      typeof body?.business_id === 'string' ? body.business_id : null
    );
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const v = validarAjustesNegocio(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    if (Object.keys(v.valores).length === 0) {
      return NextResponse.json({ error: 'No hay nada que guardar' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from('business_profiles').update(v.valores).eq('id', acceso.businessId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, guardado: Object.keys(v.valores) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
