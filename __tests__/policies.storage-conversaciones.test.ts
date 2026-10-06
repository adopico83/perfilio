/** Las dos migraciones de policies (PDF por negocio y conversaciones por negocio) se aplican de verdad con PGlite. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8');
const SQL_PDF = leer('20261008100000_storage_pdf_por_negocio.sql');
const SQL_CONV = leer('20261008110000_conversaciones_por_negocio.sql');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const U_A = '00000000-0000-4000-8000-0000000000a1'; // miembro de A (business_users)
const U_B = '00000000-0000-4000-8000-0000000000b1'; // dueño de B
const U_DUENO_A = '00000000-0000-4000-8000-0000000000a2'; // dueño de A solo en business_profiles

let db: PGlite;

async function como<T>(uid: string, sql: string): Promise<T[]> {
  await db.exec(`select set_config('test.uid', '${uid}', false); set role authenticated;`);
  try {
    const r = await db.query<T>(sql);
    return r.rows;
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create table public.business_profiles (id uuid primary key, user_id uuid);
    create table public.business_users (business_id uuid, user_id uuid);
    create function public.perfilio_user_in_business(p_business_id text) returns boolean language sql stable security definer set search_path = public as $$
      select p_business_id is not null and auth.uid() is not null and (
        exists (select 1 from public.business_profiles bp where bp.id::text = p_business_id and bp.user_id = auth.uid())
        or exists (select 1 from public.business_users bu where bu.business_id::text = p_business_id and bu.user_id = auth.uid()));
    $$;
    grant usage on schema public, storage, auth to authenticated;
    grant execute on function public.perfilio_user_in_business(text) to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select on storage.objects, public.business_users to authenticated;

    insert into public.business_profiles values ('${A}', '${U_DUENO_A}'), ('${B}', '${U_B}');
    insert into public.business_users values ('${A}', '${U_A}');
    insert into storage.objects (bucket_id, name) values
      ('presupuestos-pdf', '${A}/p1.pdf'), ('presupuestos-pdf', '${B}/p2.pdf'),
      ('facturas-pdf', '${A}/f1.pdf'), ('facturas-pdf', '${B}/f2.pdf');

    -- Policies «de antes», copiadas tal cual de la base real.
    create policy presupuestos_pdf_select_own_business on storage.objects for select to authenticated
      using (bucket_id = 'presupuestos-pdf' and exists (select 1 from business_users bu where bu.user_id = auth.uid() and bu.business_id::text = (storage.foldername(name))[1]));
    create policy facturas_pdf_select_own_business on storage.objects for select to authenticated
      using (bucket_id = 'facturas-pdf' and exists (select 1 from business_users bu where bu.user_id = auth.uid() and bu.business_id::text = (storage.foldername(name))[1]));

    create table public.conversation_history (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, content text);
    create table public.conversations (id uuid primary key default gen_random_uuid(), business_id uuid);
    create table public.ai_responses (id uuid primary key default gen_random_uuid(), conversation_id uuid);
    alter table public.conversation_history enable row level security;
    alter table public.conversations enable row level security;
    alter table public.ai_responses enable row level security;
    grant select, insert, update, delete on public.conversation_history, public.conversations, public.ai_responses to authenticated;
    create policy "Acceso autenticado conversation_history" on public.conversation_history for all to public using (auth.uid() is not null);
    create policy "usuarios ven su historial" on public.conversation_history for select to authenticated
      using (exists (select 1 from business_users bu where bu.user_id = auth.uid() and bu.business_id = conversation_history.business_id));
    create policy "Acceso autenticado conversations" on public.conversations for all to public using (auth.uid() is not null);
    create policy "Acceso autenticado ai_responses" on public.ai_responses for all to public using (auth.uid() is not null);

    insert into public.conversation_history (business_id, user_id, content) values ('${A}', '${U_A}', 'de A'), ('${B}', '${U_B}', 'de B');
    insert into public.conversations (id, business_id) values ('00000000-0000-4000-8000-0000000000c1', '${A}'), ('00000000-0000-4000-8000-0000000000c2', '${B}');
    insert into public.ai_responses (conversation_id) values ('00000000-0000-4000-8000-0000000000c1'), ('00000000-0000-4000-8000-0000000000c2');
  `);
});
afterAll(async () => db.close());

describe('antes de aplicar (demuestra el fallo)', () => {
  it('un usuario de B lee el historial de A por la policy abierta', async () => {
    const r = await como<{ content: string }>(U_B, `select content from public.conversation_history order by 1`);
    expect(r.map((x) => x.content)).toEqual(['de A', 'de B']);
  });
});

describe('20261008100000_storage_pdf_por_negocio', () => {
  beforeAll(async () => { await db.exec(SQL_PDF); });

  it('el miembro de A lee sus PDF y no los de B', async () => {
    const r = await como<{ name: string }>(U_A, `select name from storage.objects order by 1`);
    expect(r.map((x) => x.name)).toEqual([`${A}/f1.pdf`, `${A}/p1.pdf`]);
  });
  it('el dueño sin fila en business_users también lee los suyos', async () => {
    const r = await como<{ name: string }>(U_DUENO_A, `select name from storage.objects order by 1`);
    expect(r.map((x) => x.name)).toEqual([`${A}/f1.pdf`, `${A}/p1.pdf`]);
  });
  it('deja solo las policies nuevas y ninguna de escritura', async () => {
    const r = await db.query<{ policyname: string; cmd: string }>(`select policyname, cmd from pg_policies where tablename = 'objects' order by 1`);
    expect(r.rows).toEqual([
      { policyname: 'facturas_pdf_select_negocio', cmd: 'SELECT' },
      { policyname: 'presupuestos_pdf_select_negocio', cmd: 'SELECT' },
    ]);
  });
  it('es re-ejecutable y marca NO ADITIVA en la cabecera', async () => {
    await db.exec(SQL_PDF);
    expect(SQL_PDF.split('\n')[0]).toMatch(/^-- ⚠️ MIGRACIÓN NO ADITIVA/);
  });
});

describe('20261008110000_conversaciones_por_negocio', () => {
  beforeAll(async () => { await db.exec(SQL_CONV); });

  it('un usuario de B ya no ve el historial de A ni lo borra', async () => {
    const r = await como<{ content: string }>(U_B, `select content from public.conversation_history`);
    expect(r.map((x) => x.content)).toEqual(['de B']);
    await db.exec(`select set_config('test.uid', '${U_B}', false); set role authenticated;`);
    const del = await db.query(`delete from public.conversation_history where business_id = '${A}' returning id`);
    await db.exec('reset role');
    expect(del.rows).toHaveLength(0);
  });
  it('un usuario de B no puede insertar en el negocio de A', async () => {
    await db.exec(`select set_config('test.uid', '${U_B}', false); set role authenticated;`);
    await expect(db.exec(`insert into public.conversation_history (business_id, user_id, content) values ('${A}', '${U_B}', 'intruso')`)).rejects.toThrow(/row-level security/);
    await db.exec('reset role');
  });
  it('el borrado del propio historial sigue funcionando', async () => {
    await db.exec(`select set_config('test.uid', '${U_A}', false); set role authenticated;`);
    await db.exec(`insert into public.conversation_history (business_id, user_id, content) values ('${A}', '${U_A}', 'nuevo')`);
    const del = await db.query(`delete from public.conversation_history where business_id = '${A}' and user_id = '${U_A}' returning id`);
    await db.exec('reset role');
    expect(del.rows.length).toBeGreaterThanOrEqual(2);
  });
  it('conversations y ai_responses quedan limitadas por negocio', async () => {
    expect((await como(U_B, `select id from public.conversations`))).toHaveLength(1);
    expect((await como(U_B, `select id from public.ai_responses`))).toHaveLength(1);
    expect((await como(U_A, `select id from public.ai_responses`))).toHaveLength(1);
  });
  it('no queda ninguna policy abierta y es re-ejecutable', async () => {
    await db.exec(SQL_CONV);
    const r = await db.query(`select policyname from pg_policies where schemaname = 'public' and qual like '%auth.uid() IS NOT NULL%'`);
    expect(r.rows).toHaveLength(0);
    expect(SQL_CONV.split('\n')[0]).toMatch(/^-- ⚠️ MIGRACIÓN NO ADITIVA/);
  });
});
