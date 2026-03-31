/**
 * Detección heurística de direcciones y enlaces a Google Maps (markdown).
 */

const STOP_EN_LUGAR = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'eso',
  'mi',
  'tu',
  'su',
  'casa',
  'obra',
]);

type Span = { start: number; end: number; str: string };

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last || s.start >= last.end) {
      out.push({ ...s });
      continue;
    }
    const lenA = last.end - last.start;
    const lenB = s.end - s.start;
    if (lenB > lenA) {
      out[out.length - 1] = { ...s };
    }
  }
  return out;
}

function recolectarSpansDireccion(texto: string): Span[] {
  const spans: Span[] = [];

  const finCalle = '(?=\\s|[.,;]|$|\\n)';
  const patronesVia: RegExp[] = [
    new RegExp(
      `\\b(?:Calle|C\\/)\\s+[^\\n,]{2,80}?\\s+n?[º°]?\\s*\\d{1,4}[A-Za-z]?${finCalle}`,
      'giu'
    ),
    new RegExp(
      `\\b(?:Avenida|Av\\.)\\s+[^\\n,]{2,80}?\\s+n?[º°]?\\s*\\d{1,4}[A-Za-z]?${finCalle}`,
      'giu'
    ),
    new RegExp(
      `\\b(?:Plaza|Pz\\.)\\s+[^\\n,]{2,80}?\\s+n?[º°]?\\s*\\d{1,4}[A-Za-z]?${finCalle}`,
      'giu'
    ),
    new RegExp(
      `\\bPaseo\\s+(?:de\\s+)?[^\\n,]{2,80}?\\s+n?[º°]?\\s*\\d{1,4}[A-Za-z]?${finCalle}`,
      'giu'
    ),
    new RegExp(
      `\\bCamino\\s+(?:de\\s+)?[^\\n,]{2,80}?\\s+n?[º°]?\\s*\\d{1,4}[A-Za-z]?${finCalle}`,
      'giu'
    ),
  ];

  for (const re of patronesVia) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(texto)) !== null) {
      const str = m[0].trim();
      if (str.length < 4) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, str });
    }
  }

  const reCp = /\b(\d{5})\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/gu;
  let m: RegExpExecArray | null;
  while ((m = reCp.exec(texto)) !== null) {
    const full = `${m[1]} ${m[2]}`.trim();
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      str: full,
    });
  }

  const reEn = /\ben\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[a-záéíóúñA-ZÁÉÍÓÚÑ]+){0,4})\b/gu;
  while ((m = reEn.exec(texto)) !== null) {
    const lugar = m[1].trim();
    const first = lugar.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (STOP_EN_LUGAR.has(first)) continue;
    if (lugar.length < 3) continue;
    const relStart = m[0].indexOf(m[1]);
    spans.push({
      start: m.index + relStart,
      end: m.index + relStart + m[1].length,
      str: lugar,
    });
  }

  const reSoloCp = /\b(?<![\d])([0-9]{5})(?![\d])/g;
  while ((m = reSoloCp.exec(texto)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1900 && n <= 2099) continue;
    spans.push({
      start: m.index,
      end: m.index + 5,
      str: m[1],
    });
  }

  return mergeSpans(spans);
}

/** El cursor está dentro del texto de un enlace markdown [texto](url) */
function estaEnTextoDeEnlaceMarkdown(texto: string, start: number): boolean {
  const antes = texto.slice(0, start);
  const cierreEtiqueta = antes.lastIndexOf('](');
  if (cierreEtiqueta === -1) return false;
  const apertura = antes.lastIndexOf('[', cierreEtiqueta);
  if (apertura === -1) return false;
  return start > apertura && start < cierreEtiqueta;
}

/**
 * Detecta fragmentos que parecen direcciones o ubicaciones en español.
 */
export function detectarDirecciones(texto: string): string[] {
  if (!texto || typeof texto !== 'string') return [];
  const merged = recolectarSpansDireccion(texto);
  const seen = new Set<string>();
  const orden: string[] = [];
  for (const s of merged) {
    const key = s.str.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    orden.push(s.str);
  }
  return orden;
}

export function generarLinkMaps(direccion: string): string {
  const q = encodeURIComponent(direccion.trim());
  return `https://maps.google.com/?q=${q}`;
}

/**
 * Sustituye direcciones detectadas por enlaces markdown a Google Maps.
 */
export function enriquecerTextoConMaps(texto: string): string {
  if (!texto || typeof texto !== 'string') return texto;

  const merged = recolectarSpansDireccion(texto);
  const toReplace = merged.filter((s) => !estaEnTextoDeEnlaceMarkdown(texto, s.start));

  let result = texto;
  for (let i = toReplace.length - 1; i >= 0; i--) {
    const { start, end, str } = toReplace[i];
    const url = generarLinkMaps(str);
    const md = `[${str}](${url})`;
    result = result.slice(0, start) + md + result.slice(end);
  }

  return result;
}
