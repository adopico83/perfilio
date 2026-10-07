import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261013090000_jev_ordenes_pendientes.sql'), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const USER_A = '00000000-0000-4000-8000-0000000000a1';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.business_profiles (id uuid primary key, user_id uuid);
    insert into public.business_profiles values ('${A}', '${USER_A}'), ('${B}', null);
    create function public.perfilio_user_in_business(p_business_id text) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and exists (select 1 from public.business_profiles bp where bp.id::text = p_business_id and bp.user_id = auth.uid()) $$;
    grant usage on schema public to authenticated; grant select on public.business_profiles to authenticated;
  `);
  await db.exec(SQL);
  await db.exec(SQL); // re-ejecutable
});
afterAll(async () => db.close());

it('es aditiva', () => {
  expect(SQL.replace(/--.*$/gm, '').toLowerCase()).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+public/);
});

it('RLS: el usuario solo VE las órdenes de su negocio y no puede escribir; anon no accede', async () => {
  await db.exec(`insert into public.jev_ordenes_pendientes (business_id, user_id, orden, resumen) values
    ('${A}', '${USER_A}', '{"accion":"GASTO"}', 'mío'), ('${B}', '${USER_A}', '{"accion":"GASTO"}', 'ajeno')`);
  await db.exec(`set role authenticated; set test.uid = '${USER_A}'`);
  const r = await db.query<{ resumen: string }>(`select resumen from public.jev_ordenes_pendientes`);
  expect(r.rows.map((x) => x.resumen)).toEqual(['mío']);
  await expect(db.exec(`insert into public.jev_ordenes_pendientes (business_id, user_id, orden) values ('${A}', '${USER_A}', '{}')`)).rejects.toThrow(/permission denied/);
  await expect(db.exec(`update public.jev_ordenes_pendientes set estado = 'confirmada'`)).rejects.toThrow(/permission denied/);
  await db.exec(`reset role; set role anon`);
  await expect(db.query(`select * from public.jev_ordenes_pendientes`)).rejects.toThrow(/permission denied/);
  await db.exec(`reset role`);
});

it('estado válido y caducidad por defecto', async () => {
  await expect(db.exec(`insert into public.jev_ordenes_pendientes (business_id, user_id, orden, estado) values ('${A}', '${USER_A}', '{}', 'inventado')`)).rejects.toThrow(/check/i);
  const r = await db.query<{ dentro: boolean }>(`select (expires_at > now() and expires_at <= now() + interval '31 minutes') as dentro from public.jev_ordenes_pendientes limit 1`);
  expect(r.rows[0].dentro).toBe(true);
});
