import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261011090000_agenda_cliente_obra.sql'), 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.clientes (id uuid primary key default gen_random_uuid(), nombre text);
    create table public.obras (id uuid primary key default gen_random_uuid(), nombre text);
    create table public.agenda (id uuid primary key default gen_random_uuid(), business_id uuid, titulo text, fecha date);
    insert into public.agenda (business_id, titulo, fecha) values (gen_random_uuid(), 'Cita antigua', '2026-10-06');
  `);
  await db.exec(SQL);
  await db.exec(SQL); // dos veces: re-ejecutable
});
afterAll(async () => db.close());

it('es aditiva: sin DROP/DELETE/UPDATE ni NOT NULL', () => {
  const sinComentarios = SQL.replace(/--.*$/gm, '').toLowerCase();
  expect(sinComentarios).not.toMatch(/\bdrop\b|\bdelete\s+from\b|\bupdate\b|not null/);
});

it('las citas existentes siguen y las columnas nuevas son nulas', async () => {
  const r = await db.query<{ cliente_id: string | null; obra_id: string | null }>(`select cliente_id, obra_id from public.agenda`);
  expect(r.rows).toEqual([{ cliente_id: null, obra_id: null }]);
});

it('on delete set null: borrar el cliente o la obra no borra la cita', async () => {
  const c = await db.query<{ id: string }>(`insert into public.clientes (nombre) values ('Mikel') returning id`);
  const o = await db.query<{ id: string }>(`insert into public.obras (nombre) values ('Baño') returning id`);
  await db.query(`insert into public.agenda (titulo, fecha, cliente_id, obra_id) values ('Cita Mikel', '2026-10-08', $1, $2)`, [c.rows[0].id, o.rows[0].id]);
  await db.query(`delete from public.clientes where id = $1`, [c.rows[0].id]);
  await db.query(`delete from public.obras where id = $1`, [o.rows[0].id]);
  const r = await db.query<{ cliente_id: string | null; obra_id: string | null }>(`select cliente_id, obra_id from public.agenda where titulo = 'Cita Mikel'`);
  expect(r.rows).toEqual([{ cliente_id: null, obra_id: null }]);
});

it('no admite un cliente que no existe (FK)', async () => {
  await expect(
    db.query(`insert into public.agenda (titulo, fecha, cliente_id) values ('x', '2026-10-09', gen_random_uuid())`)
  ).rejects.toThrow();
});
