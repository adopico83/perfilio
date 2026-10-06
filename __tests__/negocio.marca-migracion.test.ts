/** La migración de marca (columnas, CHECKs, bucket, GRANT por columna) se aplica de verdad con PGlite. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261006130000_business_profiles_marca.sql'), 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role app_user nologin;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table public.business_profiles (id uuid primary key default gen_random_uuid(), nombre text, logo_url text);
    -- Como en producción: GRANT por columna de nombre a un rol.
    grant select (nombre), update (nombre) on public.business_profiles to app_user;
    insert into public.business_profiles (nombre) values ('Pino'), ('Otro');
    insert into storage.buckets values ('business-assets', 'business-assets', false, 999, null);
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

const intentar = (sql: string) => db.exec(sql);

it('añade las cuatro columnas sin tocar las filas existentes (todo NULL)', async () => {
  const r = await db.query<{ n: number; con_marca: number }>(
    `select count(*)::int n,
            count(marca_color_primario)::int + count(marca_color_secundario)::int + count(marca_tipografia)::int + count(marca_observaciones_presupuesto)::int as con_marca
       from public.business_profiles`
  );
  expect(r.rows[0]).toEqual({ n: 2, con_marca: 0 });
});

it('acepta valores válidos y NULL', async () => {
  await intentar(`update public.business_profiles set marca_color_primario = '#7A7A1E', marca_color_secundario = '#f3f3dc', marca_tipografia = 'Times-Roman' where nombre = 'Pino'`);
  await intentar(`update public.business_profiles set marca_color_primario = null, marca_tipografia = null where nombre = 'Pino'`);
});

it.each([
  ['color primario sin #', `marca_color_primario = '7A7A1E'`, /business_profiles_marca_color_primario_hex/],
  ['color primario corto', `marca_color_primario = '#fff'`, /business_profiles_marca_color_primario_hex/],
  ['color secundario con letras no hex', `marca_color_secundario = '#GGGGGG'`, /business_profiles_marca_color_secundario_hex/],
  ['tipografía no estándar', `marca_tipografia = 'Arial'`, /business_profiles_marca_tipografia_estandar/],
])('el CHECK rechaza %s', async (_n, set, error) => {
  await expect(intentar(`update public.business_profiles set ${set}`)).rejects.toThrow(error);
});

it('el rol con GRANT por columna recibe también las columnas nuevas', async () => {
  const r = await db.query<{ column_name: string }>(
    `select column_name from information_schema.column_privileges
      where table_name = 'business_profiles' and grantee = 'app_user' and privilege_type = 'UPDATE' order by 1`
  );
  expect(r.rows.map((x) => x.column_name)).toEqual(
    expect.arrayContaining(['marca_color_primario', 'marca_color_secundario', 'marca_observaciones_presupuesto', 'marca_tipografia', 'nombre'])
  );
});

it('no cambia el bucket business-assets si ya existía', async () => {
  const r = await db.query<{ file_size_limit: string }>(`select file_size_limit::text from storage.buckets where id = 'business-assets'`);
  expect(r.rows[0].file_size_limit).toBe('999');
});

it('crea el bucket privado si no existía', async () => {
  const d2 = new PGlite();
  await d2.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table public.business_profiles (id uuid primary key, nombre text);
  `);
  await d2.exec(SQL);
  const r = await d2.query<{ public: boolean; file_size_limit: string }>(`select public, file_size_limit::text from storage.buckets where id = 'business-assets'`);
  expect(r.rows).toEqual([{ public: false, file_size_limit: '2097152' }]);
  await d2.close();
});

it('es idempotente y aditiva', async () => {
  await db.exec(SQL);
  expect(SQL).not.toMatch(/\bdrop\s+(table|column|policy|constraint)\b|\bdelete\s+from\b|\balter\s+column\b|\bupdate\s+public\./i);
});
