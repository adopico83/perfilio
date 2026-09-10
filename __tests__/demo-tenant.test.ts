import { DEMO_REFORMAS_EMAIL, DEMO_REFORMAS_NOMBRE, isDemoReformasTenant } from '@/lib/demo-tenant';

describe('isDemoReformasTenant', () => {
  it('true por email demo', () => {
    expect(isDemoReformasTenant({ email: DEMO_REFORMAS_EMAIL })).toBe(true);
    expect(isDemoReformasTenant({ email: '  Demo-Reformas@perfilio.app  ' })).toBe(true);
  });

  it('true por nombre de negocio seed', () => {
    expect(isDemoReformasTenant({ businessName: DEMO_REFORMAS_NOMBRE })).toBe(true);
  });

  it('true por marcador de seed en contexto', () => {
    expect(
      isDemoReformasTenant({ contextoAdicional: 'foo [seed:demo-reformas] bar' })
    ).toBe(true);
  });

  it('false para Pino / otros tenants', () => {
    expect(
      isDemoReformasTenant({
        businessName: 'Pino Albañilería',
        email: 'pino@example.com',
      })
    ).toBe(false);
    expect(isDemoReformasTenant({})).toBe(false);
  });
});
