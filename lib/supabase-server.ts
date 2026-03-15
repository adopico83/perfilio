import { createClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para uso en API routes (server-side).
 * Usar SUPABASE_SERVICE_ROLE_KEY para poder leer/escribir sin RLS.
 */
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}
