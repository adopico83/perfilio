import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { uploadDiarioObraMediaToBucket } from '@/lib/diario-obra';

const BUCKET = 'diario-obra';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/x-quicktime',
  'video/mov',
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('mp4')) return 'mp4';
  return 'jpg';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'archivo';
}

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const businessUsersQuery = supabaseAuth.from('business_users');
  if ('select' in businessUsersQuery && typeof businessUsersQuery.select === 'function') {
    const { data } = await businessUsersQuery
      .select('business_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data?.business_id);
  }

  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
    }

    const file = form.get('file');
    const businessIdRaw = form.get('business_id');
    const business_id =
      typeof businessIdRaw === 'string' ? businessIdRaw.trim() : '';

    if (!business_id) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Falta el archivo (campo file)' }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'El archivo supera el tamaño máximo permitido (10 MB).' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const mime = (file.type || '').toLowerCase();
    const extByName = /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov)$/i.exec(file.name);
    const allowed =
      ALLOWED_MIME.has(mime) || Boolean(extByName);

    if (!allowed) {
      return NextResponse.json(
        {
          error:
            'Tipo de archivo no permitido. Usa imagen (jpg, png, webp, heic) o vídeo (mp4, mov).',
        },
        { status: 400 }
      );
    }

    let ext: string;
    if (extByName) {
      ext = extByName[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
    } else {
      ext = extFromMime(mime || 'image/jpeg');
    }
    const stem = file.name.replace(/\.[^.]+$/, '');
    const base = sanitizeFilename(stem || 'archivo');
    const buf = Buffer.from(await file.arrayBuffer());

    const contentType =
      file.type && file.type.length > 0
        ? file.type
        : ext === 'png'
          ? 'image/png'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'heic' || ext === 'heif'
                ? 'image/heic'
                : ext === 'mp4'
                  ? 'video/mp4'
                  : ext === 'mov'
                    ? 'video/quicktime'
                    : 'image/jpeg';

    const supabase = createServiceClient();
    const up = await uploadDiarioObraMediaToBucket(supabase, {
      businessId: business_id,
      buffer: buf,
      contentType,
      stem: base,
    });

    if ('error' in up) {
      console.error('Storage upload diario:', up.error);
      return NextResponse.json(
        { error: `No se pudo subir el archivo: ${up.error}` },
        { status: 500 }
      );
    }

    const path = up.path;

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: signErr?.message ?? 'No se pudo generar URL del archivo' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: signed.signedUrl,
      path,
    });
  } catch (e) {
    console.error('POST /api/diario/upload:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
