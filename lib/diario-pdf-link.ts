/** Enlaces de descarga de PDF del diario (markdown / chat del agente). */
export function isDiarioPdfDownloadLink(href: string): boolean {
  if (!href || typeof href !== 'string') return false;
  const u = href.trim().toLowerCase();
  const pathPart = u.split('?')[0];
  const mentionsPdf = pathPart.includes('.pdf') || u.includes('.pdf');
  if (!mentionsPdf) return false;
  if (u.includes('diario')) return true;
  const isSupabaseStorageSigned =
    u.includes('supabase') &&
    (u.includes('/storage/v1/object/sign/') || u.includes('/storage/v1/object/public/'));
  if (isSupabaseStorageSigned) return true;
  return false;
}
