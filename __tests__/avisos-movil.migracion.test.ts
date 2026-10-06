import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261008120000_avisos_movil_por_negocio.sql'), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create table public.business_profiles (id uuid primary key);
    insert into public.business_profiles values ('${A}');
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

it('RLS activada, sin policies y sin permisos para anon/authenticated', async () => {
  const r = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'business_avisos_movil'`);
  expect(r.rows[0].relrowsecurity).toBe(true);
  const p = await db.query(`select 1 from pg_policies where tablename = 'business_avisos_movil'`);
  expect(p.rows).toHaveLength(0);
  await db.exec(`set role authenticated`);
  await expect(db.query(`select * from public.business_avisos_movil`)).rejects.toThrow(/permission denied/);
  await db.exec(`reset role`);
});

it('acepta una clave de 30 caracteres y rechaza otras', async () => {
  await db.exec(`insert into public.business_avisos_movil (business_id, pushover_user_key) values ('${A}', '${'a'.repeat(30)}')`);
  await expect(db.exec(`update public.business_avisos_movil set pushover_user_key = 'corta'`)).rejects.toThrow(/check/i);
  await db.exec(`update public.business_avisos_movil set pushover_user_key = null`);
});

it('es aditiva y re-ejecutable', async () => {
  await db.exec(SQL);
  expect(SQL.replace(/--.*$/gm, '')).not.toMatch(/\b(drop|truncate)\b|\bdelete\s+from|\bupdate\s+public/i);
});
