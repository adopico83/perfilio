import { readFileSync } from 'fs';
import { join } from 'path';

const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');

describe('ficheros espejo de migraciones ya aplicadas', () => {
  it('el trigger de remapeo de Pino lleva su SQL literal y la marca de espejo', () => {
    const sql = leer('20261005231124_remap_pino_business_id_trigger.sql');
    expect(sql.split('\n')[0]).toMatch(/Fichero espejo: NO volver a ejecutar/);
    expect(sql).toContain("new.business_id := '8784450e-08a4-420a-8c37-d30bff8f0d39';");
    expect(sql).toContain('trg_remap_pino_bicho_notifications');
    expect(sql).toContain('trg_remap_pino_perfilio_insights');
  });
  it('el revoke de perfilio_user_in_business deja execute solo para authenticated y service_role', () => {
    const sql = leer('20261005231333_revoke_anon_perfilio_user_in_business.sql');
    expect(sql).toContain('from anon;');
    expect(sql).toContain('to authenticated, service_role;');
  });
  it('el esquema de referencia no contiene SQL ejecutable', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/schema-referencia.sql'), 'utf8');
    expect(sql).toMatch(/NO EJECUTAR NUNCA/);
    expect(sql.replace(/--.*$/gm, '').trim()).toBe('');
  });
});
