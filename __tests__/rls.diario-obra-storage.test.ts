/**
 * Prueba la migración de aislamiento del bucket `diario-obra` contra un Postgres de verdad (PGlite):
 * parte del estado inseguro (policies abiertas), aplica la migración y comprueba quién puede qué.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
// La función REAL de la migración anterior (no una copia): desde `create or replace function` hasta su `grant`.
const SQL_NOTIFICACIONES = leer('20261005090000_notificaciones_insights_rls.sql');
const FUNCION_PERTENENCIA = SQL_NOTIFICACIONES.slice(
  SQL_NOTIFICACIONES.indexOf('create or replace function public.perfilio_user_in_business'),
  SQL_NOTIFICACIONES.indexOf('to authenticated, service_role;', SQL_NOTIFICACIONES.indexOf('grant execute on function')) + 'to authenticated, service_role;'.length
);
const MIGRACION = leer('20261006140000_diario_obra_storage_por_negocio.sql');

const ANA = '00000000-0000-4000-8000-0000000000a1'; // dueña de A (business_profiles.user_id)
const BEA = '00000000-0000-4000-8000-0000000000b1'; // dueña de B
const EMPLEADO = '00000000-0000-4000-8000-0000000000c1'; // miembro de A (business_users)
const A = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const B = '900ed462-7640-4893-9030-a41163219f7a';

let db: PGlite;

async function como<T>(user: string | null, rol: 'authenticated' | 'anon', fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${rol}`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ''}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const ver = async () =>
  (await db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'diario-obra' order by name`)).rows.map(
    (r) => r.name
  );
const subir = (name: string, bucket = 'diario-obra') =>
  db.exec(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`);

async function montar(extra = ''): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage; grant usage on schema storage to anon, authenticated, service_role;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    alter table storage.objects enable row level security;
    grant all on storage.objects to anon, authenticated, service_role;
    create table public.business_profiles (id uuid primary key, user_id uuid);
    create table public.business_users (business_id uuid, user_id uuid);
    insert into public.business_profiles values ('${A}', '${ANA}'), ('${B}', '${BEA}');
    insert into public.business_users values ('${A}', '${EMPLEADO}');
    -- Estado de producción ANTES del arreglo: solo comprueban el bucket.
    create policy read_diario_obra on storage.objects for select to authenticated using (bucket_id = 'diario-obra');
    create policy upload_diario_obra on storage.objects for insert to authenticated with check (bucket_id = 'diario-obra');
    -- Otra policy de otro bucket que NO se debe tocar.
    create policy read_presupuestos on storage.objects for select to authenticated using (bucket_id = 'presupuestos-pdf');
    ${extra}
  `);
  await d.exec(FUNCION_PERTENENCIA);
  return d;
}

beforeAll(async () => {
  db = await montar();
  await db.exec(`
    insert into storage.objects (bucket_id, name) values
      ('diario-obra', '${A}/1700_a.jpg'), ('diario-obra', '${A}/entrada-1/1701_b.jpg'),
      ('diario-obra', '${B}/1702_c.jpg'), ('presupuestos-pdf', '${B}/p.pdf');
  `);
});
afterAll(async () => db.close());

describe('ANTES de la migración (el fallo)', () => {
  it('cualquier usuario autenticado ve y sube en la carpeta de otro negocio', async () => {
    expect(await como(BEA, 'authenticated', ver)).toHaveLength(3);
    await como(BEA, 'authenticated', () => subir(`${A}/colada.jpg`));
    await db.exec(`delete from storage.objects where name = '${A}/colada.jpg'`);
  });
});

describe('DESPUÉS de la migración', () => {
  beforeAll(async () => {
    await db.exec(MIGRACION);
  });

  it('la dueña de A (business_profiles.user_id) solo ve su carpeta', async () => {
    expect(await como(ANA, 'authenticated', ver)).toEqual([`${A}/1700_a.jpg`, `${A}/entrada-1/1701_b.jpg`]);
  });
  it('un miembro de business_users también (y solo la de su negocio)', async () => {
    expect(await como(EMPLEADO, 'authenticated', ver)).toEqual([`${A}/1700_a.jpg`, `${A}/entrada-1/1701_b.jpg`]);
  });
  it('la dueña de B solo ve la suya y no la de A', async () => {
    expect(await como(BEA, 'authenticated', ver)).toEqual([`${B}/1702_c.jpg`]);
  });
  it('un usuario sin negocio no ve nada', async () => {
    expect(await como('00000000-0000-4000-8000-0000000000ff', 'authenticated', ver)).toEqual([]);
  });
  it('anon no ve nada', async () => {
    await expect(como(null, 'anon', ver)).resolves.toEqual([]);
  });

  it('puede subir en la carpeta de SU negocio (también en subcarpeta de entrada)', async () => {
    await como(ANA, 'authenticated', () => subir(`${A}/entrada-2/1800_x.jpg`));
    await como(EMPLEADO, 'authenticated', () => subir(`${A}/1801_y.jpg`));
  });
  it('NO puede subir en la carpeta de otro negocio', async () => {
    await expect(como(BEA, 'authenticated', () => subir(`${A}/colada.jpg`))).rejects.toThrow(/row-level security/);
    await expect(como(ANA, 'authenticated', () => subir(`${B}/colada.jpg`))).rejects.toThrow(/row-level security/);
  });
  it('NO puede subir con una carpeta inventada ni en la raíz del bucket', async () => {
    await expect(como(ANA, 'authenticated', () => subir('pino/x.jpg'))).rejects.toThrow(/row-level security/);
    await expect(como(ANA, 'authenticated', () => subir('x.jpg'))).rejects.toThrow(/row-level security/);
  });
  it('NO puede subir a otro bucket con la policy del diario', async () => {
    await expect(como(ANA, 'authenticated', () => subir(`${A}/x.pdf`, 'otro-bucket'))).rejects.toThrow(/row-level security/);
  });

  it('no toca la policy de otro bucket', async () => {
    const r = await db.query<{ qual: string }>(`select qual from pg_policies where policyname = 'read_presupuestos'`);
    expect(r.rows[0].qual).toContain('presupuestos-pdf');
    expect(r.rows[0].qual).not.toContain('perfilio_user_in_business');
  });
  it('deja exactamente dos policies para diario-obra (select e insert) y ninguna de update/delete nueva', async () => {
    const r = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual ilike '%diario-obra%' or with_check ilike '%diario-obra%') order by cmd`
    );
    expect(r.rows).toEqual([
      { policyname: 'upload_diario_obra', cmd: 'INSERT' },
      { policyname: 'read_diario_obra', cmd: 'SELECT' },
    ]);
  });
  it('no modifica ficheros ni datos existentes', async () => {
    expect((await ver()).length).toBeGreaterThanOrEqual(3);
  });
  it('es idempotente (se puede aplicar dos veces)', async () => {
    await db.exec(MIGRACION);
    expect(await como(BEA, 'authenticated', ver)).toEqual([`${B}/1702_c.jpg`]);
  });
});

describe('UPDATE / DELETE abiertos sobre el mismo bucket', () => {
  it('se sustituyen por otros limitados por negocio (mismo nombre, mismo tipo)', async () => {
    const d = await montar(`
      create policy update_diario_obra on storage.objects for update to authenticated using (bucket_id = 'diario-obra');
      create policy delete_diario_obra on storage.objects for delete to authenticated using (bucket_id = 'diario-obra');
      create policy delete_otro on storage.objects for delete to authenticated using (bucket_id = 'otro');
    `);
    await d.exec(`insert into storage.objects (bucket_id, name) values ('diario-obra', '${A}/1.jpg'), ('diario-obra', '${B}/2.jpg')`);
    await d.exec(MIGRACION);

    const pol = await d.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where tablename = 'objects' and policyname in ('update_diario_obra','delete_diario_obra','delete_otro') order by 1`
    );
    expect(pol.rows).toEqual([
      { policyname: 'delete_diario_obra', cmd: 'DELETE' },
      { policyname: 'delete_otro', cmd: 'DELETE' },
      { policyname: 'update_diario_obra', cmd: 'UPDATE' },
    ]);
    const otro = await d.query<{ qual: string }>(`select qual from pg_policies where policyname = 'delete_otro'`);
    expect(otro.rows[0].qual).not.toContain('perfilio_user_in_business'); // la de otro bucket, intacta

    await d.exec(`set role authenticated`);
    await d.exec(`select set_config('request.jwt.claim.sub', '${BEA}', false)`);
    // B no puede borrar ni modificar lo de A, sí lo suyo.
    await d.exec(`delete from storage.objects where name = '${A}/1.jpg'`);
    await d.exec(`update storage.objects set name = name where name = '${A}/1.jpg'`);
    await d.exec(`delete from storage.objects where name = '${B}/2.jpg'`);
    await d.exec('reset role');
    expect((await d.query(`select name from storage.objects where bucket_id = 'diario-obra'`)).rows).toEqual([{ name: `${A}/1.jpg` }]);
    await d.close();
  });

  it('si no había policies de update/delete no crea ninguna (no da permisos nuevos)', async () => {
    const r = await db.query(`select 1 from pg_policies where cmd in ('UPDATE','DELETE') and policyname like '%diario%'`);
    expect(r.rows).toHaveLength(0);
  });
});

it('falla con un mensaje claro si falta la función de pertenencia', async () => {
  const d = new PGlite();
  await d.exec(`create schema storage; create table storage.objects (id uuid, bucket_id text, name text);`);
  await expect(d.exec(MIGRACION)).rejects.toThrow(/Falta public\.perfilio_user_in_business/);
  await d.close();
});

it('es la única migración con drop policy de este bloque y no toca datos', () => {
  expect(MIGRACION).not.toMatch(/\bdelete\s+from\b|\bdrop\s+(table|column)\b|\bupdate\s+storage\.objects\b|\btruncate\b/i);
  expect(MIGRACION.match(/drop policy/gi)?.length).toBeGreaterThan(0);
});
