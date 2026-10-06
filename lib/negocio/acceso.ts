import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import { getBusinessIdServer } from '@/lib/supabase/get-business-id';

export type AccesoNegocio =
  | { ok: true; businessId: string; userId: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * Patrón de seguridad de las APIs de ajustes: usuario → negocio → comprobar que es suyo.
 * El negocio sale de `business_id` (si llega) o del perfil del propio usuario; en los dos casos se
 * comprueba con `assertUserOwnsBusiness` antes de tocar nada.
 */
export async function resolverAccesoNegocio(
  request: NextRequest,
  businessIdPedido?: string | null
): Promise<AccesoNegocio> {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user?.id) return { ok: false, status: 401, error: 'No autorizado' };

  const pedido = (businessIdPedido ?? request.nextUrl.searchParams.get('business_id') ?? '').trim();
  const businessId = pedido || (await getBusinessIdServer(supabaseAuth)) || '';
  if (!businessId) return { ok: false, status: 400, error: 'No hay un negocio asociado' };

  const owns = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
  if (!owns) return { ok: false, status: 403, error: 'No tienes acceso a este negocio' };
  return { ok: true, businessId, userId: user.id };
}
