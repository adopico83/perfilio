/**
 * Lógica pura del script de limpieza de Storage (sin red ni Supabase): decide qué objetos sobran.
 * Va en .cjs para poder importarla tanto desde el script (.mjs) como desde los tests de Jest.
 *
 * Categorías:
 *  - 'vigente' / 'ok'      → se queda.
 *  - 'sobrante'            → logo que ya no es el logo_url de su negocio.
 *  - 'huerfano'            → carpeta de un negocio que no existe, o PDF cuyo documento no existe en ese negocio.
 *  - 'no_reconocido'       → ruta con otro formato: se lista y NUNCA se borra.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_PDF = new RegExp(`^(${UUID})/(${UUID})\\.pdf$`, 'i');
const RE_LOGO = new RegExp(`^(${UUID})/[^/]+$`, 'i');

const quitarBarras = (s) => String(s ?? '').replace(/^\/+/, '');

/** @param perfiles Map<businessId, logo_url|null> */
function clasificarLogo(ruta, perfiles) {
  const m = RE_LOGO.exec(ruta);
  if (!m) return 'no_reconocido';
  const biz = m[1].toLowerCase();
  if (!perfiles.has(biz)) return 'huerfano';
  return quitarBarras(perfiles.get(biz)) === ruta ? 'vigente' : 'sobrante';
}

/** @param idsPorNegocio Map<businessId, Set<documentId>> (solo documentos de ESE negocio) */
function clasificarPdf(ruta, idsPorNegocio) {
  const m = RE_PDF.exec(ruta);
  if (!m) return 'no_reconocido';
  const ids = idsPorNegocio.get(m[1].toLowerCase());
  return ids && ids.has(m[2].toLowerCase()) ? 'ok' : 'huerfano';
}

const BORRABLES = new Set(['sobrante', 'huerfano']);
const esBorrable = (categoria) => BORRABLES.has(categoria);

/**
 * Borra en lotes con storage.from(bucket).remove(rutas), pero SOLO si `borrar` es true.
 * Devuelve { borrados, fallidos }.
 */
async function borrarEnLotes(storage, bucket, rutas, { borrar = false, lote = 100 } = {}) {
  if (!borrar) return { borrados: 0, fallidos: 0 };
  let borrados = 0;
  let fallidos = 0;
  for (let i = 0; i < rutas.length; i += lote) {
    const parte = rutas.slice(i, i + lote);
    const { error } = await storage.from(bucket).remove(parte);
    if (error) fallidos += parte.length;
    else borrados += parte.length;
  }
  return { borrados, fallidos };
}

module.exports = { clasificarLogo, clasificarPdf, esBorrable, borrarEnLotes, quitarBarras };
