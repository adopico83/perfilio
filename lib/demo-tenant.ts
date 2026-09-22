/** Tenant comercial de reformas (seed), aislado de Pino. */

export const DEMO_REFORMAS_NOMBRE = 'Reformas Demo Errenteria';
export const DEMO_REFORMAS_EMAIL = 'demo-reformas@perfilio.app';
export const DEMO_REFORMAS_SEED_MARKER = '[seed:demo-reformas]';

export function isDemoReformasTenant(opts: {
  businessName?: string | null;
  email?: string | null;
  contextoAdicional?: string | null;
}): boolean {
  const email = (opts.email ?? '').trim().toLowerCase();
  if (email === DEMO_REFORMAS_EMAIL) return true;

  const name = (opts.businessName ?? '').trim();
  if (name === DEMO_REFORMAS_NOMBRE) return true;

  const ctx = opts.contextoAdicional ?? '';
  return ctx.includes(DEMO_REFORMAS_SEED_MARKER);
}
