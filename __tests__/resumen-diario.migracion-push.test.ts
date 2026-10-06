/** La migración de resumen_push se aplica de verdad con PGlite: aditiva, default false e idempotente. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261007100000_business_profiles_resumen_push.sql'), 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role app_user nologin;
    create table public.business_profiles (id uuid primary key default gen_random_uuid(), nombre text);
    grant select (nombre), update (nombre) on public.business_profiles to app_user;
    insert into public.business_profiles (nombre) values ('Pino'), ('Otro');
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

it('añade resumen_push apagado para todos los negocios existentes', async () => {
  const r = await db.query<{ n: number; activos: number }>(
    `select count(*)::int n, count(*) filter (where resumen_push)::int activos from public.business_profiles`
  );
  expect(r.rows[0]).toEqual({ n: 2, activos: 0 });
});

it('el rol con GRANT por columna recibe también la columna nueva', async () => {
  const r = await db.query<{ column_name: string }>(
    `select column_name from information_schema.column_privileges
      where table_name = 'business_profiles' and grantee = 'app_user' and privilege_type = 'UPDATE' order by 1`
  );
  expect(r.rows.map((x) => x.column_name)).toEqual(expect.arrayContaining(['nombre', 'resumen_push']));
});

it('es idempotente y no contiene sentencias destructivas ni de datos', async () => {
  await db.exec(SQL);
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  expect(sinComentarios).not.toMatch(/\b(drop|delete|truncate)\b|\bupdate\s+public\./i);
});
