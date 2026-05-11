import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

let _adminClient: SupabaseClient<Database> | undefined;

/**
 * Cliente admin de Supabase para operaciones de servidor con permisos completos.
 *
 * Usa la service role key, por lo que no debe importarse desde componentes cliente.
 */
export function createAdminClient() {
  if (_adminClient) return _adminClient;

  _adminClient = createSupabaseClient<Database>(
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
