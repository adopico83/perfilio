import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DIARIO_OBRA_STORAGE_BUCKET,
  buildDiarioObraObjectPath,
  isSafeDiarioBusinessId,
  readDiarioObraStoredObject,
  removeDiarioObraStorageObjects,
  resolveDiarioObraBusinessPath,
  uploadDiarioObraMediaToBucket,
} from '@/lib/diario-obra';

/** Máximo de fotos por llamada (un lote típico de obra son 5–6). */
export const DIARIO_FOTO_INGEST_MAX_ITEMS = 8;
/** Mismo tope que POST /api/diario/upload. */
export const DIARIO_FOTO_INGEST_MAX_BYTES = 10 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 20_000;
/**
 * Presupuesto de la tanda, por debajo de `maxDuration` (60s) de `/api/mcp`.
 * Una URL colgada falla ese ítem; el resto sigue mientras quede margen.
 */
const INGEST_BUDGET_MS = 45_000;
const MAX_REDIRECTS = 3;
const DNS_TIMEOUT_MS = 5_000;
const SIGNED_TTL_SEC = 60 * 60 * 24 * 7;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

/**
 * Misma familia de imagen que el upload del diario (jpeg/png/webp/gif/heic).
 * El vídeo sigue solo en POST /api/diario/upload; esta ingesta es de fotos.
 */
const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);

export type DiarioObraFotoSource =
  | { type: 'url'; url: string }
  | { type: 'buffer'; buffer: Buffer; contentType?: string; fileName?: string }
  | { type: 'storage_path'; path: string };

export type DiarioObraFotoIngestItem = {
  url?: string;
  path: string;
  signedUrl?: string;
};

export type DiarioObraFotoIngestError = {
  url?: string;
  path?: string;
  error: string;
};

export type DiarioObraSignedUpload = {
  upload_url: string;
  path: string;
  token: string;
  headers: { 'content-type': string; 'x-upsert': 'false' };
  max_bytes: number;
};

export type DiarioObraFotoIngestResult = {
  ok: boolean;
  entrada_id: string;
  items: DiarioObraFotoIngestItem[];
  errors?: DiarioObraFotoIngestError[];
};

class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new IngestError(message)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isIpv4Literal(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function isIpLiteral(host: string): boolean {
  return isIpv4Literal(host) || host.includes(':');
}

/** Octetos con cero a la izquierda son ambiguos (p. ej. 0177 → 127 en algunos clientes). */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return true;
  const nums: number[] = [];
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) return true;
    if (!/^\d{1,3}$/.test(part)) return true;
    const n = Number(part);
    if (!Number.isInteger(n) || n > 255) return true;
    nums.push(n);
  }
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) {
    const mapped = v.slice('::ffff:'.length);
    return isIpv4Literal(mapped) ? isBlockedIpv4(mapped) : true;
  }
  if (v === '::1' || v === '::' || v === '0:0:0:0:0:0:0:1' || v === '0:0:0:0:0:0:0:0') {
    return true;
  }
  const head = v.split(':').find((part) => part.length > 0) ?? '';
  const n = Number.parseInt(head, 16);
  if (!Number.isFinite(n)) return true;
  if (n >= 0xfe80 && n <= 0xfebf) return true;
  if (n >= 0xfc00 && n <= 0xfdff) return true;
  return false;
}

function isBlockedIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  if (ip.includes(':')) return isBlockedIpv6(ip);
  if (isIpv4Literal(ip)) return isBlockedIpv4(ip);
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === 'localhost.localdomain' ||
    h === 'metadata' ||
    h === 'metadata.google.internal'
  ) {
    return true;
  }
  return h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
}

/**
 * SSRF: solo https, sin userinfo. Se bloquean localhost, `*.local`, `*.internal`,
 * `metadata.google.internal` y direcciones no públicas:
 * 0.0.0.0/8, 10/8, 127/8, 169.254/16 (metadatos), 172.16/12, 192.168/16,
 * CGNAT 100.64/10, multicast/reservado (≥224), loopback y link-local/ULA IPv6.
 * El nombre se resuelve y se rechaza si alguna dirección cae en esos rangos.
 * Cada redirección se vuelve a comprobar (máximo 3).
 */
async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IngestError('URL inválida.');
  }
  if (url.protocol !== 'https:') {
    throw new IngestError('Solo se admiten URLs https.');
  }
  if (url.username || url.password) {
    throw new IngestError('URL con credenciales no permitida.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || isBlockedHostname(host) || isBlockedIp(host)) {
    throw new IngestError('Host no permitido (red privada, local o de metadatos).');
  }
  if (!isIpLiteral(host)) {
    let addresses: string[] = [];
    try {
      const records = await withTimeout(
        lookup(host, { all: true }),
        DNS_TIMEOUT_MS,
        'No se pudo resolver el host de la imagen.'
      );
      addresses = records.map((record) => record.address);
    } catch (error) {
      if (error instanceof IngestError) throw error;
      throw new IngestError('No se pudo resolver el host de la imagen.');
    }
    if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
      throw new IngestError('Host no permitido (red privada, local o de metadatos).');
    }
  }
  return url;
}

function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 6) {
    const sig = buf.toString('ascii', 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
  }
  return null;
}

function normalizeAllowedImageMime(contentType: string | null | undefined): string | null {
  const declared = declaredImageMime(contentType);
  if (!declared || !IMAGE_MIME.has(declared)) return null;
  return declared;
}

function declaredImageMime(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base || base === 'application/octet-stream' || base === 'binary/octet-stream') {
    return null;
  }
  if (base === 'image/jpg' || base === 'image/pjpeg') return 'image/jpeg';
  if (base === 'image/heif') return 'image/heic';
  return base;
}

function mimeFromBytes(buf: Buffer, contentType?: string | null): string {
  const detected = detectImageMime(buf);
  if (!detected || !IMAGE_MIME.has(detected)) {
    throw new IngestError('El archivo no es una imagen jpeg, png, webp, gif o heic.');
  }
  const declared = declaredImageMime(contentType);
  if (!declared) return detected;
  if (!declared.startsWith('image/')) {
    throw new IngestError('Content-Type no permitido. Usa jpeg, png, webp, gif o heic.');
  }
  if (declared !== detected) {
    throw new IngestError('El tipo declarado no coincide con el contenido de la imagen.');
  }
  return detected;
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const rawLen = res.headers.get('content-length');
  if (rawLen != null && rawLen.trim() !== '') {
    const n = Number(rawLen);
    if (!Number.isFinite(n) || n < 0) {
      await res.body?.cancel().catch(() => undefined);
      throw new IngestError('Content-Length inválido.');
    }
    if (n === 0) {
      await res.body?.cancel().catch(() => undefined);
      throw new IngestError('La imagen descargada está vacía.');
    }
    if (n > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new IngestError('La foto supera el tamaño máximo permitido (10 MB).');
    }
  }

  const body = res.body;
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new IngestError('La imagen descargada está vacía.');
    if (buf.length > maxBytes) {
      throw new IngestError('La foto supera el tamaño máximo permitido (10 MB).');
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new IngestError('La foto supera el tamaño máximo permitido (10 MB).');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (total === 0) throw new IngestError('La imagen descargada está vacía.');
  return Buffer.concat(chunks);
}

function remainingMs(deadline: number): number {
  return deadline - Date.now();
}

async function fetchPublicImage(
  rawUrl: string,
  deadline: number
): Promise<{ buffer: Buffer; mime: string }> {
  if (remainingMs(deadline) < 1000) {
    throw new IngestError('Sin tiempo restante para descargar más imágenes en esta petición.');
  }
  let current = await assertPublicHttpsUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const timeout = Math.min(FETCH_TIMEOUT_MS, remainingMs(deadline));
    if (timeout < 1000) {
      throw new IngestError('Sin tiempo restante para descargar más imágenes en esta petición.');
    }
    const res = await fetch(current.href, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/*;q=0.5',
        'User-Agent': 'PerfilioDiario/1.0',
      },
    });
    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (hop === MAX_REDIRECTS) throw new IngestError('Demasiadas redirecciones.');
      if (!location) throw new IngestError('Redirección sin destino.');
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new IngestError('Redirección inválida.');
      }
      current = await assertPublicHttpsUrl(next.href);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new IngestError(`No se pudo descargar la imagen (${res.status}).`);
    }
    const buffer = await readBodyLimited(res, DIARIO_FOTO_INGEST_MAX_BYTES);
    return { buffer, mime: mimeFromBytes(buffer, res.headers.get('content-type')) };
  }
  throw new IngestError('Demasiadas redirecciones.');
}

function sanitizeStem(name: string): string {
  const base = name.trim().replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return safe || 'diario_foto';
}

function stemFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return sanitizeStem(last);
  } catch {
    return 'diario_foto';
  }
}

function stemFor(source: DiarioObraFotoSource): string {
  if (source.type === 'buffer' && source.fileName?.trim()) return sanitizeStem(source.fileName);
  if (source.type === 'url') return stemFromUrl(source.url);
  return 'diario_foto';
}

function fotoPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

async function loadOwnedEntry(
  supabase: SupabaseClient,
  businessId: string,
  entradaId: string
): Promise<{ fotos: string[] } | { error: string }> {
  const { data, error } = await supabase
    .from('diario_obra')
    .select('id, fotos')
    .eq('id', entradaId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data?.id) {
    return { error: 'Entrada de diario no encontrada o no pertenece a este negocio' };
  }
  return { fotos: fotoPaths(data.fotos) };
}

async function appendFotoPath(
  supabase: SupabaseClient,
  businessId: string,
  entradaId: string,
  path: string
): Promise<string | null> {
  const loaded = await loadOwnedEntry(supabase, businessId, entradaId);
  if ('error' in loaded) return loaded.error;
  const next = loaded.fotos.includes(path) ? loaded.fotos : [...loaded.fotos, path];
  const { error } = await supabase
    .from('diario_obra')
    .update({ fotos: next })
    .eq('id', entradaId)
    .eq('business_id', businessId);
  return error ? error.message : null;
}

async function commitFotoPath(
  supabase: SupabaseClient,
  businessId: string,
  entradaId: string,
  path: string,
  url: string | undefined,
  items: DiarioObraFotoIngestItem[]
): Promise<void> {
  const appendError = await appendFotoPath(supabase, businessId, entradaId, path);
  if (appendError) {
    await removeDiarioObraStorageObjects(supabase, [path]);
    throw new IngestError(appendError);
  }
  const signedUrl = await signPath(supabase, path);
  items.push({
    ...(url ? { url } : {}),
    path,
    ...(signedUrl ? { signedUrl } : {}),
  });
}

async function attachStoredFoto(
  supabase: SupabaseClient,
  businessId: string,
  entradaId: string,
  rawPath: string,
  items: DiarioObraFotoIngestItem[]
): Promise<void> {
  const resolved = resolveDiarioObraBusinessPath(businessId, rawPath);
  if ('error' in resolved) throw new IngestError(resolved.error);
  const path = resolved.path;

  const meta = await readDiarioObraStoredObject(supabase, path);
  if ('error' in meta) throw new IngestError(meta.error);
  if (meta.size <= 0) throw new IngestError('La imagen está vacía.');
  if (meta.size > DIARIO_FOTO_INGEST_MAX_BYTES) {
    await removeDiarioObraStorageObjects(supabase, [path]);
    throw new IngestError('La foto supera el tamaño máximo permitido (10 MB).');
  }
  if (!normalizeAllowedImageMime(meta.contentType)) {
    await removeDiarioObraStorageObjects(supabase, [path]);
    throw new IngestError('El archivo no es una imagen jpeg, png, webp, gif o heic.');
  }

  await commitFotoPath(supabase, businessId, entradaId, path, undefined, items);
}

async function signPath(
  supabase: SupabaseClient,
  path: string
): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.storage
      .from(DIARIO_OBRA_STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SEC);
    if (error || !data || typeof data.signedUrl !== 'string' || !data.signedUrl) return undefined;
    return data.signedUrl;
  } catch {
    return undefined;
  }
}

async function bytesForSource(
  source: Exclude<DiarioObraFotoSource, { type: 'storage_path' }>,
  deadline: number
): Promise<{ buffer: Buffer; mime: string }> {
  if (source.type === 'url') return fetchPublicImage(source.url, deadline);
  if (!Buffer.isBuffer(source.buffer)) {
    throw new IngestError('Buffer de imagen no válido.');
  }
  if (source.buffer.length === 0) throw new IngestError('La imagen está vacía.');
  if (source.buffer.length > DIARIO_FOTO_INGEST_MAX_BYTES) {
    throw new IngestError('La foto supera el tamaño máximo permitido (10 MB).');
  }
  return { buffer: source.buffer, mime: mimeFromBytes(source.buffer, source.contentType) };
}

function errorMessage(error: unknown, source: DiarioObraFotoSource): string {
  if (error instanceof IngestError) return error.message;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'Tiempo de espera agotado al descargar la imagen.';
  }
  if (source.type === 'storage_path') return 'No se pudo adjuntar la foto.';
  return 'No se pudo descargar la imagen.';
}

function sourceUrl(source: DiarioObraFotoSource): string | undefined {
  return source.type === 'url' ? source.url : undefined;
}

function sourcePath(source: DiarioObraFotoSource): string | undefined {
  return source.type === 'storage_path' ? source.path : undefined;
}

function batchLimitError(sources: DiarioObraFotoSource[]): string {
  if (sources.every((source) => source.type === 'storage_path')) {
    return `storage_paths admite como máximo ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos.`;
  }
  if (sources.every((source) => source.type === 'url')) {
    return `foto_urls admite como máximo ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos.`;
  }
  return `Admite como máximo ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos.`;
}

/**
 * URL firmada de subida (PUT) al bucket `diario-obra`, siempre bajo `{businessId}/`.
 * El cliente envía los bytes a `upload_url`; luego `ingestDiarioObraFotos` adjunta la ruta.
 */
export async function createDiarioObraSignedUpload(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    mimeType: string;
    fileName?: string;
    entradaId?: string;
  }
): Promise<DiarioObraSignedUpload | { error: string }> {
  const businessId = params.businessId.trim();
  if (!businessId) return { error: 'business_id es obligatorio' };
  if (!isSafeDiarioBusinessId(businessId)) return { error: 'business_id no válido' };

  const mime = normalizeAllowedImageMime(params.mimeType);
  if (!mime) {
    return { error: 'Tipo de imagen no permitido. Usa jpeg, png, webp, gif o heic.' };
  }

  let subfolder: string | undefined;
  const entradaId = params.entradaId?.trim() ?? '';
  if (entradaId) {
    if (!UUID_RE.test(entradaId)) return { error: 'entrada_diario_id debe ser un UUID' };
    const owned = await loadOwnedEntry(supabase, businessId, entradaId);
    if ('error' in owned) return { error: owned.error };
    subfolder = entradaId;
  }

  const path = buildDiarioObraObjectPath({
    businessId,
    contentType: mime,
    stem: params.fileName?.trim() ? sanitizeStem(params.fileName) : 'diario_foto',
    subfolder,
    unique: randomBytes(4).toString('hex'),
  });
  const ownedPath = resolveDiarioObraBusinessPath(businessId, path);
  if ('error' in ownedPath) return { error: ownedPath.error };

  const bucket = supabase.storage.from(DIARIO_OBRA_STORAGE_BUCKET);
  const { data, error } = await bucket.createSignedUploadUrl(ownedPath.path, { upsert: false });
  if (error || !data?.signedUrl || !data.token) {
    return { error: error?.message ?? 'No se pudo crear la URL de subida firmada.' };
  }
  if (data.path !== ownedPath.path) {
    return { error: 'La URL firmada no coincide con la ruta del negocio.' };
  }

  return {
    upload_url: data.signedUrl,
    path: ownedPath.path,
    token: data.token,
    headers: {
      'content-type': mime,
      'x-upsert': 'false',
    },
    max_bytes: DIARIO_FOTO_INGEST_MAX_BYTES,
  };
}

/**
 * Único camino para adjuntar fotos a una fila de `diario_obra`.
 * Origen URL o buffer: valida la imagen, sube con `uploadDiarioObraMediaToBucket`
 * al bucket `diario-obra` y añade la ruta a `fotos`.
 * Origen `storage_path`: la foto ya está en el bucket (PUT firmado); comprueba
 * prefijo del negocio, tamaño y MIME, y añade la misma ruta a `fotos`.
 * La fila tiene que existir y pertenecer a `businessId`. El lote es best-effort.
 */
export async function ingestDiarioObraFotos(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    entradaId: string;
    sources: DiarioObraFotoSource[];
  }
): Promise<DiarioObraFotoIngestResult | { error: string }> {
  const businessId = params.businessId.trim();
  const entradaId = params.entradaId.trim();
  if (!businessId) return { error: 'business_id es obligatorio' };
  if (!isSafeDiarioBusinessId(businessId)) return { error: 'business_id no válido' };
  if (!entradaId) return { error: 'entrada_diario_id es obligatorio' };
  if (!UUID_RE.test(entradaId)) return { error: 'entrada_diario_id debe ser un UUID' };
  if (!Array.isArray(params.sources) || params.sources.length === 0) {
    return {
      error: `Indica entre 1 y ${DIARIO_FOTO_INGEST_MAX_ITEMS} fotos.`,
    };
  }
  if (params.sources.length > DIARIO_FOTO_INGEST_MAX_ITEMS) {
    return { error: batchLimitError(params.sources) };
  }

  const owned = await loadOwnedEntry(supabase, businessId, entradaId);
  if ('error' in owned) return { error: owned.error };

  const deadline = Date.now() + INGEST_BUDGET_MS;
  const items: DiarioObraFotoIngestItem[] = [];
  const errors: DiarioObraFotoIngestError[] = [];

  for (const source of params.sources) {
    const url = sourceUrl(source);
    const rawPath = sourcePath(source);
    try {
      if (source.type === 'storage_path') {
        await attachStoredFoto(supabase, businessId, entradaId, source.path, items);
        continue;
      }
      if (source.type !== 'url' && source.type !== 'buffer') {
        throw new IngestError('Origen de imagen no válido.');
      }
      if (source.type === 'url' && !source.url.trim()) {
        throw new IngestError('URL de imagen vacía.');
      }
      const { buffer, mime } = await bytesForSource(source, deadline);
      const up = await uploadDiarioObraMediaToBucket(supabase, {
        businessId,
        buffer,
        contentType: mime,
        stem: stemFor(source),
      });
      if ('error' in up) throw new IngestError(up.error);
      await commitFotoPath(supabase, businessId, entradaId, up.path, url, items);
    } catch (error) {
      errors.push({
        ...(url ? { url } : {}),
        ...(rawPath ? { path: rawPath } : {}),
        error: errorMessage(error, source),
      });
    }
  }

  return {
    ok: items.length > 0,
    entrada_id: entradaId,
    items,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
