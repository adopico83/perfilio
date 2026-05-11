import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let _adminClient: ReturnType<typeof createSupabaseClient> | undefined;

/**
 * Cliente admin de Supabase para operaciones de servidor con permisos completos.
 *
 * Usa la service role key, por lo que no debe importarse desde componentes cliente.
 */
export function createAdminClient() {
  if (_adminClient) return _adminClient;

  _adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return _adminClient;
}
