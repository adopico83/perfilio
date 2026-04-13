import type { SupabaseClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';

type JsPdfInstance = InstanceType<typeof jsPDF>;

export type DiarioObraRow = {
  id: string;
  business_id: string;
  cliente_id?: string | null;
  obra_id?: string | null;
  obra_nombre: string;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
  created_at?: string;
};

/** Bucket de fotos/vídeos/PDF del diario (Supabase Storage). */
export const DIARIO_OBRA_STORAGE_BUCKET = 'diario-obra';

/** Duración de URLs firmadas al servir al cliente o al generar PDF (evita enlaces caducados guardados en BD). */
const SIGNED_MEDIA_TTL_SEC = 60 * 60 * 24 * 365;

/**
 * Obtiene la ruta relativa al bucket a partir de una URL de Storage o de un path ya relativo.
 * Así podemos volver a firmar aunque el token de la URL guardada haya caducado.
 */
export function extractDiarioObraObjectPath(raw: string): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;

  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-f0-9-]{8,}\/.+/i.test(s)) return s;
    return null;
  }

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  const p = u.pathname;
  const pub = `/storage/v1/object/public/${DIARIO_OBRA_STORAGE_BUCKET}/`;
  const sign = `/storage/v1/object/sign/${DIARIO_OBRA_STORAGE_BUCKET}/`;
  const auth = `/storage/v1/object/authenticated/${DIARIO_OBRA_STORAGE_BUCKET}/`;
  if (p.startsWith(pub)) return decodeURIComponent(p.slice(pub.length));
  if (p.startsWith(sign)) return decodeURIComponent(p.slice(sign.length));
  if (p.startsWith(auth)) return decodeURIComponent(p.slice(auth.length));
  return null;
}

function normalizeDiarioObraMediaListForStorage(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const p = extractDiarioObraObjectPath(item);
    if (p) out.push(p);
  }
  return out;
}

/** Al insertar entradas: guarda solo rutas en el bucket (no URLs firmadas que caducan). */
export function normalizeDiarioObraRowMediaForInsert(params: {
  fotos?: string[] | null;
  videos?: string[] | null;
}): { fotos: string[] | null; videos: string[] | null } {
  const fotos = normalizeDiarioObraMediaListForStorage(params.fotos);
  const videos = normalizeDiarioObraMediaListForStorage(params.videos);
  return {
    fotos: fotos.length ? fotos : null,
    videos: videos.length ? videos : null,
  };
}

async function signOneDiarioObraMediaUrl(
  supabase: SupabaseClient,
  raw: string
): Promise<string> {
  const path = extractDiarioObraObjectPath(raw);
  if (!path) return raw;
  const { data, error } = await supabase.storage
    .from(DIARIO_OBRA_STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_MEDIA_TTL_SEC);
  if (error || !data?.signedUrl) return raw;
  return data.signedUrl;
}

type DiarioObraMediaFields = {
  fotos?: string[] | null;
  videos?: string[] | null;
};

/** Devuelve filas con fotos/vídeos listos para <img>/<video> o fetch (URLs firmadas renovadas). */
export async function signDiarioObraEntriesMedia<T extends DiarioObraMediaFields>(
  supabase: SupabaseClient,
  entries: T[]
): Promise<T[]> {
  const out: T[] = [];
  for (const e of entries) {
    const fotosIn = e.fotos ?? [];
    const videosIn = e.videos ?? [];
    const fotos =
      fotosIn.length > 0
        ? await Promise.all(fotosIn.map((u) => signOneDiarioObraMediaUrl(supabase, u)))
        : null;
    const videos =
      videosIn.length > 0
        ? await Promise.all(videosIn.map((u) => signOneDiarioObraMediaUrl(supabase, u)))
        : null;
    out.push({
      ...e,
      fotos,
      videos,
    });
  }
  return out;
}

/** Mismos MIME que `app/api/diario/upload` (imagen y vídeo). */
const DIARIO_UPLOAD_ALLOWED_MIME = new Set([
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

function extFromMimeDiarioUpload(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('mp4')) return 'mp4';
  return 'jpg';
}

function sanitizeDiarioUploadStem(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'archivo';
}

/**
 * Sube un archivo al bucket `diario-obra` (misma convención que POST /api/diario/upload).
 * Devuelve la ruta relativa al bucket para guardar en `diario_obra.fotos` / `videos`.
 */
export async function uploadDiarioObraMediaToBucket(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    buffer: Buffer;
    contentType: string;
    /** Nombre base sin extensión (ej. stem del archivo o `diario_adjunto`). */
    stem: string;
  }
): Promise<{ path: string } | { error: string }> {
  let ct = params.contentType.trim().toLowerCase();
  if (!ct) ct = 'image/jpeg';
  if (ct === 'image/jpg') ct = 'image/jpeg';
  if (!DIARIO_UPLOAD_ALLOWED_MIME.has(ct)) {
    return { error: 'Tipo de archivo no permitido para el diario de obra.' };
  }

  const ext = extFromMimeDiarioUpload(ct);
  const base = sanitizeDiarioUploadStem(params.stem);
  const ts = Date.now();
  const path = `${params.businessId}/${ts}_${base}.${ext === 'jpeg' ? 'jpg' : ext}`;

  const uploadContentType =
    ct === 'image/png'
      ? 'image/png'
      : ct === 'image/webp'
        ? 'image/webp'
        : ct === 'image/gif'
          ? 'image/gif'
          : ct === 'image/heic' || ct === 'image/heif'
            ? 'image/heic'
            : ct === 'video/mp4'
              ? 'video/mp4'
              : ct === 'video/quicktime' || ct === 'video/mov'
                ? 'video/quicktime'
                : 'image/jpeg';

  const { error: upErr } = await supabase.storage.from(DIARIO_OBRA_STORAGE_BUCKET).upload(path, params.buffer, {
    contentType: uploadContentType,
    upsert: false,
  });
  if (upErr) return { error: upErr.message };
  return { path };
}

const MAX_DATA_URL_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Decodifica una data URL `data:image/...;base64,...` (p. ej. la enviada al agente).
 * Formatos alineados con la visión del agente: jpeg, png, gif, webp.
 */
export function decodeDataUrlImageForDiarioUpload(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const marker = ';base64,';
  if (!dataUrl.startsWith('data:image/')) return null;
  const mi = dataUrl.indexOf(marker);
  if (mi === -1) return null;
  let mime = dataUrl.slice('data:'.length, mi).toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  if (!allowed.has(mime)) return null;
  const b64 = dataUrl.slice(mi + marker.length).replace(/\s/g, '');
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0 || buf.length > MAX_DATA_URL_IMAGE_BYTES) return null;
    return { buffer: buf, contentType: mime };
  } catch {
    return null;
  }
}

export async function insertDiarioObraEntry(
  supabase: SupabaseClient,
  params: {
    business_id: string;
    cliente_id?: string | null;
    obra_id?: string | null;
    obra_nombre: string;
    obra_direccion?: string | null;
    texto?: string | null;
    fotos?: string[] | null;
    videos?: string[] | null;
  }
): Promise<{ data: DiarioObraRow | null; error: { message: string } | null }> {
  const { fotos: fotosNorm, videos: videosNorm } = normalizeDiarioObraRowMediaForInsert({
    fotos: params.fotos,
    videos: params.videos,
  });

  const { data, error } = await supabase
    .from('diario_obra')
    .insert({
      business_id: params.business_id,
      cliente_id: params.cliente_id ?? null,
      obra_id: params.obra_id ?? null,
      obra_nombre: params.obra_nombre.trim(),
      obra_direccion: params.obra_direccion?.trim() || null,
      texto: params.texto?.trim() || null,
      fotos: fotosNorm,
      videos: videosNorm,
    })
    .select('*')
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data: data as DiarioObraRow, error: null };
}

export async function fetchDiarioObraEntries(
  supabase: SupabaseClient,
  businessId: string,
  obraNombre?: string | null,
  obraId?: string | null
): Promise<{ data: DiarioObraRow[] | null; error: { message: string } | null }> {
  let q = supabase
    .from('diario_obra')
    .select('*')
    .eq('business_id', businessId)
    .order('fecha', { ascending: false });

  if (obraNombre?.trim()) {
    q = q.eq('obra_nombre', obraNombre.trim());
  }

  if (obraId?.trim()) {
    q = q.eq('obra_id', obraId.trim());
  }

  const { data, error } = await q;
  if (error) return { data: null, error: { message: error.message } };
  return { data: (data ?? []) as DiarioObraRow[], error: null };
}

export function groupDiarioEntriesByObra(entries: DiarioObraRow[]): Record<string, DiarioObraRow[]> {
  const grouped: Record<string, DiarioObraRow[]> = {};
  for (const e of entries) {
    const key = e.obra_nombre;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }
  return grouped;
}

/** Nombre de archivo seguro para storage */
export function sanitizeDiarioFilePart(raw: string, maxLen = 50): string {
  const s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (s || 'obra').slice(0, maxLen);
}

function guessImageFormat(contentType: string, url: string): 'JPEG' | 'PNG' {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'PNG';
  if (url.toLowerCase().includes('.png')) return 'PNG';
  return 'JPEG';
}

function addImageToPdf(
  doc: JsPdfInstance,
  b64: string,
  fmt: 'JPEG' | 'PNG',
  x: number,
  y: number,
  w: number,
  h: number
) {
  doc.addImage(b64, fmt, x, y, w, h, undefined, 'FAST');
}

/**
 * PDF cronológico (fecha ascendente). Incluye texto, fotos en rejilla 2 columnas y listado de URLs de vídeo.
 */
export async function buildDiarioObraPdf(entries: DiarioObraRow[]): Promise<Uint8Array> {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
  );

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const ensureSpace = (mm: number) => {
    if (y + mm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Diario de obra', margin, y);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  for (const entry of sorted) {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const fechaStr = new Date(entry.fecha).toLocaleString('es-ES', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    doc.text(`Entrada — ${fechaStr}`, margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Obra: ${entry.obra_nombre}`, margin, y);
    y += 5;
    if (entry.obra_direccion) {
      const dirLines = doc.splitTextToSize(`Dirección: ${entry.obra_direccion}`, pageW - 2 * margin);
      for (const line of dirLines) {
        ensureSpace(5);
        doc.text(line, margin, y);
        y += 4;
      }
    }
    if (entry.texto) {
      const lines = doc.splitTextToSize(entry.texto, pageW - 2 * margin);
      for (const line of lines) {
        ensureSpace(5);
        doc.text(line, margin, y);
        y += 4;
      }
    }

    const fotos = entry.fotos ?? [];
    const colW = (pageW - 2 * margin - 4) / 2;
    const imgH = 42;
    let col = 0;
    for (let i = 0; i < fotos.length; i++) {
      ensureSpace(imgH + 6);
      const x = margin + col * (colW + 4);
      try {
        const res = await fetch(fotos[i], {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error('fetch');
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const fmt = guessImageFormat(res.headers.get('content-type') ?? '', fotos[i]);
        try {
          addImageToPdf(doc, b64, fmt, x, y, colW, imgH);
        } catch {
          try {
            addImageToPdf(doc, b64, fmt === 'JPEG' ? 'PNG' : 'JPEG', x, y, colW, imgH);
          } catch {
            throw new Error('image');
          }
        }
      } catch {
        doc.setFont('helvetica', 'italic');
        doc.text('(Imagen no disponible)', x, y + 6);
        doc.setFont('helvetica', 'normal');
      }
      col++;
      if (col >= 2) {
        col = 0;
        y += imgH + 6;
      }
    }
    if (col === 1) y += imgH + 6;

    const vids = entry.videos ?? [];
    if (vids.length > 0) {
      ensureSpace(8);
      doc.setFont('helvetica', 'italic');
      doc.text('Vídeos adjuntos (enlaces, no incrustados):', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      for (const v of vids) {
        const vl = doc.splitTextToSize(v, pageW - 2 * margin);
        for (const line of vl) {
          ensureSpace(5);
          doc.text(line, margin, y);
          y += 4;
        }
      }
    }

    y += 6;
    ensureSpace(4);
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 8;
  }

  const out = doc.output('arraybuffer');
  return new Uint8Array(out);
}
