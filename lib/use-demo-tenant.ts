'use client';

import { useSession } from '@/components/providers/session-provider';
import { isDemoReformasTenant } from '@/lib/demo-tenant';

/** Tenant demo de reformas. Pino y el resto siguen en el shell actual. */
export function useDemoTenant(): boolean {
  const { user, businessName } = useSession();
  return isDemoReformasTenant({
    businessName,
    email: user?.email,
  });
}
