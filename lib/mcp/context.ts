import type { SupabaseClient } from '@supabase/supabase-js';

export type McpContext = {
  supabase: SupabaseClient;
  businessId: string;
  userId: string;
};
