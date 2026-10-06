/** La migración que rellena numero_presupuesto se ejecuta de verdad con PGlite. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const FICHERO = '20261007090000_presupuestos_rellenar_numero.sql';
const SQL = readFileSync(join(process.cwd(), 'supabase/migrations', FICHERO), 'utf8');
const UNICO = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260930100000_presupuestos_numero_unico.sql'),
  'utf8'
);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let db: PGlite;

async function numeros(biz: string) {
  const r = await db.query<{ cliente: string; numero: number | null }>(
    `select cliente_nombre as cliente, numero_presupuesto as numero
       from public.presupuestos where business_id = $1 order by created_at, id`,
    [biz]
  );
  return r.rows.map((x) => [x.cliente, x.numero]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.presupuestos (
      id uuid primary key default gen_random_uuid(),
      business_id uuid,
      cliente_nombre text,
      numero_presupuesto int,
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(UNICO);
  await db.exec(`
    -- Negocio A: números 1..3 ya puestos y tres sin número (el más antiguo es 'a-vieja').
    insert into public.presupuestos (business_id, cliente_nombre, numero_presupuesto, created_at) values
      ('${A}', 'a-1', 1, '2026-01-01'),
      ('${A}', 'a-2', 2, '2026-02-01'),
      ('${A}', 'a-3', 3, '2026-09-01');
    insert into public.presupuestos (business_id, cliente_nombre, numero_presupuesto, created_at) values
      ('${A}', 'a-nueva', null, '2026-08-01'),
      ('${A}', 'a-vieja', null, '2026-03-01'),
      ('${A}', 'a-media', null, '2026-05-01');
    -- Negocio B: ningún número todavía.
    insert into public.presupuestos (business_id, cliente_nombre, numero_presupuesto, created_at) values
      ('${B}', 'b-segunda', null, '2026-04-01'),
      ('${B}', 'b-primera', null, '2026-03-01');
    -- Sin negocio: no se toca.
    insert into public.presupuestos (business_id, cliente_nombre, numero_presupuesto, created_at) values
      (null, 'huérfano', null, '2026-03-01');
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

it('rellena a partir del máximo de cada negocio, en orden de created_at', async () => {
  expect(await numeros(A)).toEqual([
    ['a-1', 1],
    ['a-2', 2],
    ['a-vieja', 4],
    ['a-media', 5],
    ['a-nueva', 6],
    ['a-3', 3],
  ]);
  expect(await numeros(B)).toEqual([
    ['b-primera', 1],
    ['b-segunda', 2],
  ]);
});

it('no toca los que ya tenían número ni los que no tienen negocio', async () => {
  const r = await db.query<{ numero: number | null }>(
    `select numero_presupuesto as numero from public.presupuestos where cliente_nombre in ('a-1','a-2','a-3','huérfano') order by cliente_nombre`
  );
  expect(r.rows.map((x) => x.numero)).toEqual([1, 2, 3, null]);
});

it('no repite números dentro de un negocio (respeta el índice único)', async () => {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from (
       select business_id, numero_presupuesto from public.presupuestos
       where numero_presupuesto is not null group by 1, 2 having count(*) > 1) d`
  );
  expect(r.rows[0].n).toBe(0);
});

it('es idempotente: aplicarla otra vez no cambia nada', async () => {
  const antes = JSON.stringify([await numeros(A), await numeros(B)]);
  await db.exec(SQL);
  expect(JSON.stringify([await numeros(A), await numeros(B)])).toBe(antes);
});

it('está marcada como NO ADITIVA en la cabecera', () => {
  expect(SQL.split('\n')[0]).toBe(
    '-- ⚠️ MIGRACIÓN NO ADITIVA: actualiza datos (rellena numero_presupuesto NULL). Revisar antes de aplicar.'
  );
});

it('solo hace un UPDATE sobre presupuestos (sin delete, drop ni alter)', () => {
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  expect(sinComentarios).not.toMatch(/\b(delete|drop|alter|truncate)\b/i);
  expect(sinComentarios.match(/\bupdate\b/gi)).toHaveLength(1);
});
