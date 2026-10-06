/** La migración de facturas (columna, índice único, bucket) se aplica de verdad con PGlite. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261006120000_facturas_presupuesto_id.sql'), 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create table public.business_users (business_id uuid, user_id uuid);
    create table public.presupuestos (id uuid primary key);
    create table public.facturas (id uuid primary key default gen_random_uuid(), business_id uuid, numero_factura int);
    insert into public.facturas (business_id, numero_factura) values (gen_random_uuid(), 1);
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

it('añade presupuesto_id sin tocar las filas existentes', async () => {
  const r = await db.query<{ n: number; con_pres: number }>(
    'select count(*)::int as n, count(presupuesto_id)::int as con_pres from public.facturas'
  );
  expect(r.rows[0]).toEqual({ n: 1, con_pres: 0 });
});

it('permite varias facturas sin presupuesto pero solo una por presupuesto', async () => {
  await db.exec(`insert into public.presupuestos values ('00000000-0000-4000-8000-000000000001')`);
  await db.exec(`insert into public.facturas (business_id, numero_factura) values (gen_random_uuid(), 2), (gen_random_uuid(), 3)`);
  await db.exec(`insert into public.facturas (presupuesto_id, numero_factura) values ('00000000-0000-4000-8000-000000000001', 4)`);
  await expect(
    db.exec(`insert into public.facturas (presupuesto_id, numero_factura) values ('00000000-0000-4000-8000-000000000001', 5)`)
  ).rejects.toThrow(/uq_facturas_presupuesto_id/);
});

it('crea el bucket privado facturas-pdf y una única policy de lectura', async () => {
  const b = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'facturas-pdf'`);
  expect(b.rows).toEqual([{ public: false }]);
  const p = await db.query<{ cmd: string }>(
    `select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'`
  );
  expect(p.rows).toEqual([{ cmd: 'SELECT' }]);
});

it('es aditiva e idempotente: se puede aplicar otra vez', async () => {
  await db.exec(SQL);
  const b = await db.query(`select 1 from storage.buckets where id = 'facturas-pdf'`);
  expect(b.rows).toHaveLength(1);
});

it('no contiene sentencias destructivas', () => {
  expect(SQL).not.toMatch(/\bdrop\s+(table|column|policy)\b|\bdelete\s+from\b|\balter\s+column\b|\bupdate\s+public\./i);
});
