import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverAccesoNegocio } from '@/lib/negocio/acceso';
import { LOGO_MAX_BYTES, detectarFormatoLogo } from '@/lib/negocio/ajustes';

export const runtime = 'nodejs';

const BUCKET = 'business-assets';

/** Sube el logo del negocio (png/jpeg/webp, máx. 2 MB) y guarda su ruta en `business_profiles.logo_url`. */
export async function POST(request: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
    }
    const bid = form.get('business_id');
    const acceso = await resolverAccesoNegocio(request, typeof bid === 'string' ? bid : null);
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const file = form.get('file');
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: 'Falta el archivo (campo file)' }, { status: 400 });
    }
    const blob = file as Blob;
    if (blob.size > LOGO_MAX_BYTES) {
      return NextResponse.json({ error: 'El logo pesa demasiado (máximo 2 MB)' }, { status: 413 });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Se mira el contenido real del archivo, no lo que diga el navegador.
    const formato = detectarFormatoLogo(bytes);
    if (!formato) {
      return NextResponse.json({ error: 'Formato no admitido: usa PNG, JPEG o WebP' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Logo vigente (para borrarlo después de guardar el nuevo y que no se acumulen en Storage).
    const { data: perfil } = await supabase
      .from('business_profiles')
      .select('logo_url')
      .eq('id', acceso.businessId)
      .maybeSingle();
    const anterior = String((perfil as { logo_url?: string | null } | null)?.logo_url ?? '').trim();

    const path = `${acceso.businessId}/logo-${Date.now()}.${formato.ext}`;
    const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: formato.mime, upsert: false });
    if (up.error) return NextResponse.json({ error: `No se pudo subir el logo: ${up.error.message}` }, { status: 500 });

    const { error } = await supabase.from('business_profiles').update({ logo_url: path }).eq('id', acceso.businessId);
    if (error) {
      // No se pudo guardar la ruta: el fichero recién subido quedaría huérfano, se borra.
      await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Borrar el anterior solo si es distinto y es de la carpeta de ESTE negocio (nunca URLs externas
    // ni rutas de otro negocio). Si falla, la petición sigue siendo correcta: solo se avisa.
    let aviso: string | undefined;
    if (anterior && anterior !== path && anterior.startsWith(`${acceso.businessId}/`)) {
      try {
        const rm = await supabase.storage.from(BUCKET).remove([anterior]);
        if (rm.error) throw new Error(rm.error.message);
      } catch (e) {
        console.warn('[negocio/logo] no se pudo borrar el logo anterior:', e instanceof Error ? e.message : e);
        aviso = 'El logo nuevo está guardado, pero no se pudo borrar el anterior.';
      }
    }

    const firmada = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({
      ok: true,
      logo_url: path,
      logo_url_firmada: firmada.data?.signedUrl ?? null,
      ...(aviso ? { aviso } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
