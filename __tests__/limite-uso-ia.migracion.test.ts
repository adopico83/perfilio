import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261009090000_limite_uso_ia.sql'), 'utf8');
const U1 = '00000000-0000-4000-8000-0000000000a1';
const U2 = '00000000-0000-4000-8000-0000000000a2';
let db: PGlite;

async function usar(user: string, biz: string, minuto = '2026-10-06T10:15', dia = '2026-10-06', maxMin = 10, maxDia = 100) {
  const r = await db.query<{ r: { permitido: boolean; motivo?: string } }>(
    `select public.ia_registrar_uso($1::uuid, $2, $3, $4, $5, $6) as r`,
    [user, biz, minuto, dia, maxMin, maxDia]
  );
  return r.rows[0].r;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
  await db.exec(SQL);
  await db.exec(SQL); // dos veces: re-ejecutable
});
afterAll(async () => db.close());

it('RLS activada, 0 policies y authenticated no lee la tabla ni ejecuta la función', async () => {
  const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'ia_uso_limite'`);
  expect(rls.rows[0].relrowsecurity).toBe(true);
  expect((await db.query(`select 1 from pg_policies where tablename = 'ia_uso_limite'`)).rows).toHaveLength(0);
  for (const rol of ['authenticated', 'anon']) {
    await db.exec(`set role ${rol}`);
    await expect(db.query(`select * from public.ia_uso_limite`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.ia_registrar_uso('${U1}', 'x', 'm', 'd', 10, 100)`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role`);
  }
  await db.exec(`set role service_role`);
  await expect(db.query(`select public.ia_registrar_uso('${U1}', 'x', 'm0', 'd0', 10, 100)`)).resolves.toBeDefined();
  await db.exec(`reset role`);
});

it('las 10 primeras del minuto pasan y la 11 se rechaza', async () => {
  for (let i = 1; i <= 10; i++) expect((await usar(U1, 'biz-1')).permitido).toBe(true);
  expect(await usar(U1, 'biz-1')).toMatchObject({ permitido: false, motivo: 'minuto' });
});

it('otro minuto, otro usuario u otro negocio tienen su propio cupo', async () => {
  expect((await usar(U1, 'biz-1', '2026-10-06T10:16')).permitido).toBe(true);
  expect((await usar(U2, 'biz-1')).permitido).toBe(true);
  expect((await usar(U1, 'biz-2')).permitido).toBe(true);
});

it('el tope diario se aplica aunque cada minuto vaya bien', async () => {
  let ultimo: { permitido: boolean; motivo?: string } = { permitido: true };
  for (let i = 0; i < 4; i++) ultimo = await usar(U2, 'biz-dia', `2026-10-07T10:${10 + i}`, '2026-10-07', 10, 3);
  expect(ultimo).toMatchObject({ permitido: false, motivo: 'dia' });
});

it('borra las filas de más de 2 días', async () => {
  await db.exec(`insert into public.ia_uso_limite (user_id, business_id, ventana, periodo, contador, updated_at)
                 values ('${U1}', 'viejo', 'dia', '2020-01-01', 5, now() - interval '3 days')`);
  await usar(U1, 'biz-limpieza');
  const r = await db.query(`select 1 from public.ia_uso_limite where business_id = 'viejo'`);
  expect(r.rows).toHaveLength(0);
});

it('es aditiva: solo crea tabla y función', () => {
  expect(SQL.replace(/--.*$/gm, '')).not.toMatch(/\bdrop\b|\btruncate\b|\bupdate\s+public/i);
});
