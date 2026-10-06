import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261008090000_facturas_albaran_unico.sql'), 'utf8');
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.facturas (id uuid primary key default gen_random_uuid(), albaran_id uuid, numero_factura int);`);
  await db.exec(SQL);
});
afterAll(async () => db.close());

it('permite varias facturas sin albarán pero solo una por albarán', async () => {
  const a = '00000000-0000-4000-8000-000000000001';
  await db.exec(`insert into public.facturas (numero_factura) values (1), (2)`);
  await db.exec(`insert into public.facturas (albaran_id, numero_factura) values ('${a}', 3)`);
  await expect(db.exec(`insert into public.facturas (albaran_id, numero_factura) values ('${a}', 4)`)).rejects.toThrow(/uq_facturas_albaran_id/);
});
it('es aditiva e idempotente', async () => {
  await db.exec(SQL);
  expect(SQL.replace(/--.*$/gm, '')).not.toMatch(/\b(drop|delete|truncate|update)\b/i);
});
