import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261012090000_proveedores.sql'), 'utf8');
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
    create table public.business_users (business_id uuid, user_id uuid);
    insert into public.business_profiles values ('${A}', '${USER_A}'), ('${B}', null);
    create function public.perfilio_user_in_business(p_business_id text) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and exists (select 1 from public.business_profiles bp where bp.id::text = p_business_id and bp.user_id = auth.uid()) $$;
    create table public.gastos (id uuid primary key default gen_random_uuid(), business_id uuid, proveedor text);
    insert into public.gastos (business_id, proveedor) values ('${A}', 'Saltoki');
    grant usage on schema public to authenticated; grant select on public.business_profiles to authenticated;
  `);
  await db.exec(SQL);
  await db.exec(SQL); // dos veces: re-ejecutable
});
afterAll(async () => db.close());

it('es aditiva: sin DROP/DELETE/UPDATE de datos ni NOT NULL en columnas viejas', () => {
  const limpio = SQL.replace(/--.*$/gm, '').toLowerCase();
  expect(limpio).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+public/);
});

it('los gastos viejos siguen y proveedor_id es nulo', async () => {
  const r = await db.query<{ proveedor_id: string | null }>(`select proveedor_id from public.gastos`);
  expect(r.rows).toEqual([{ proveedor_id: null }]);
});

it('RLS: cada usuario solo ve y crea proveedores de su negocio; anon no accede', async () => {
  await db.exec(`insert into public.proveedores (business_id, nombre) values ('${A}', 'Saltoki'), ('${B}', 'Ajeno')`);
  await db.exec(`set role authenticated; set test.uid = '${USER_A}'`);
  const vistos = await db.query<{ nombre: string }>(`select nombre from public.proveedores`);
  expect(vistos.rows.map((r) => r.nombre)).toEqual(['Saltoki']);
  await expect(db.exec(`insert into public.proveedores (business_id, nombre) values ('${B}', 'Colado')`)).rejects.toThrow();
  await db.exec(`insert into public.proveedores (business_id, nombre) values ('${A}', 'Bricomart')`);
  await db.exec(`reset role; set role anon`);
  await expect(db.query(`select * from public.proveedores`)).rejects.toThrow(/permission denied/);
  await db.exec(`reset role`);
});

it('on delete set null: borrar el proveedor no borra el gasto', async () => {
  const p = await db.query<{ id: string }>(`select id from public.proveedores where nombre = 'Saltoki'`);
  await db.query(`update public.gastos set proveedor_id = $1`, [p.rows[0].id]);
  await db.query(`delete from public.proveedores where id = $1`, [p.rows[0].id]);
  const r = await db.query<{ proveedor_id: string | null }>(`select proveedor_id from public.gastos`);
  expect(r.rows).toEqual([{ proveedor_id: null }]);
});
