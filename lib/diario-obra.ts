import type { SupabaseClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';

type JsPdfInstance = InstanceType<typeof jsPDF>;

export type DiarioObraRow = {
  id: string;
  business_id: string;
  obra_nombre: string;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
  created_at?: string;
};

export async function insertDiarioObraEntry(
  supabase: SupabaseClient,
  params: {
    business_id: string;
    obra_nombre: string;
    obra_direccion?: string | null;
    texto?: string | null;
    fotos?: string[] | null;
    videos?: string[] | null;
  }
): Promise<{ data: DiarioObraRow | null; error: { message: string } | null }> {
  const fotos = Array.isArray(params.fotos) ? params.fotos.filter((u) => typeof u === 'string' && u.trim()) : [];
  const videos = Array.isArray(params.videos)
    ? params.videos.filter((u) => typeof u === 'string' && u.trim())
    : [];

  const { data, error } = await supabase
    .from('diario_obra')
    .insert({
      business_id: params.business_id,
      obra_nombre: params.obra_nombre.trim(),
      obra_direccion: params.obra_direccion?.trim() || null,
      texto: params.texto?.trim() || null,
      fotos,
      videos,
    })
    .select('*')
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data: data as DiarioObraRow, error: null };
}

export async function fetchDiarioObraEntries(
  supabase: SupabaseClient,
  businessId: string,
  obraNombre?: string | null
): Promise<{ data: DiarioObraRow[] | null; error: { message: string } | null }> {
  let q = supabase
    .from('diario_obra')
    .select('*')
    .eq('business_id', businessId)
    .order('fecha', { ascending: false });

  if (obraNombre?.trim()) {
    q = q.eq('obra_nombre', obraNombre.trim());
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
