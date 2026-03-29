import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'diario-obra';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/x-quicktime',
  'video/mov',
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
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

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const mime = (file.type || '').toLowerCase();
    const extByName = /\.(jpe?g|png|webp|heic|heif|mp4|mov)$/i.exec(file.name);
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
    const ts = Date.now();
    const path = `${business_id}/${ts}_${base}.${ext === 'jpeg' ? 'jpg' : ext}`;

    const supabase = createServiceClient();
    const buf = Buffer.from(await file.arrayBuffer());

    const contentType =
      file.type && file.type.length > 0
        ? file.type
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'heic' || ext === 'heif'
              ? 'image/heic'
              : ext === 'mp4'
                ? 'video/mp4'
                : ext === 'mov'
                  ? 'video/quicktime'
                  : 'image/jpeg';

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: false,
    });

    if (upErr) {
      console.error('Storage upload diario:', upErr);
      return NextResponse.json(
        { error: `No se pudo subir el archivo: ${upErr.message}` },
        { status: 500 }
      );
    }

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
