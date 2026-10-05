import { isUuid, resolveBusinessId } from '../supabase/functions/_shared/business';

const UUID = '8784450e-08a4-420a-8c37-d30bff8f0d39';

function admin(rows: Array<{ id: string; nombre: string | null }>, error: string | null = null) {
  return {
    from: () => ({ select: async () => ({ data: error ? null : rows, error: error ? { message: error } : null }) }),
  } as never;
}

describe('bicho-daily-check: resolveBusinessId', () => {
  it('acepta un UUID de la petición y no consulta la base', async () => {
    const a = { from: jest.fn() } as never;
    expect(await resolveBusinessId(a, `  ${UUID} `)).toBe(UUID);
  });
  it('rechaza el alias antiguo «pino»', async () => {
    await expect(resolveBusinessId(admin([]), 'pino')).rejects.toThrow(/UUID/);
    expect(isUuid('pino')).toBe(false);
  });
  it('sin petición usa el único negocio', async () => {
    expect(await resolveBusinessId(admin([{ id: UUID, nombre: 'Lo que sea' }]), undefined)).toBe(UUID);
  });
  it('con varios negocios elige el que se llama Pino', async () => {
    const rows = [
      { id: 'otro', nombre: 'Orbegozo' },
      { id: UUID, nombre: 'Pino Albañilería' },
    ];
    expect(await resolveBusinessId(admin(rows), null)).toBe(UUID);
  });
  it('si es ambiguo, falla en vez de adivinar', async () => {
    const rows = [
      { id: 'a', nombre: 'X' },
      { id: 'b', nombre: 'Y' },
    ];
    await expect(resolveBusinessId(admin(rows), '')).rejects.toThrow(/business_id/);
  });
  it('propaga el error de base de datos', async () => {
    await expect(resolveBusinessId(admin([], 'caída'), undefined)).rejects.toThrow(/caída/);
  });
});
