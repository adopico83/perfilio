/**
 * Prueba la migración de RLS contra un Postgres de verdad (PGlite, en memoria):
 * cada usuario solo ve y modifica lo de su negocio.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261005090000_notificaciones_insights_rls.sql'),
  'utf8'
);

const ANA = '00000000-0000-4000-8000-0000000000a1'; // dueña del negocio A
const BEA = '00000000-0000-4000-8000-0000000000b1'; // dueña del negocio B
const EMPLEADO = '00000000-0000-4000-8000-0000000000c1'; // miembro del negocio A vía business_users
const NEGOCIO_A = '10000000-0000-4000-8000-00000000000a';
const NEGOCIO_B = '10000000-0000-4000-8000-00000000000b';

let db: PGlite;

/**
 * En la tabla de prueba perfilio_insights.business_id ya existe como TEXT (así puede estar en
 * producción), así que se quita el `add column ... uuid` de esa tabla para no cambiar su tipo.
 * Todo lo demás de la migración se ejecuta tal cual.
 */
const sinColumnaInsights = (sql: string) =>
  sql.replace(/alter table public\.perfilio_insights\s+add column if not exists[^;]*;/, '');

/** Ejecuta `fn` como un usuario de la app (rol authenticated con ese auth.uid()). */
async function como<T>(userId: string | null, rol: 'authenticated' | 'anon', fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${rol}`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.business_profiles (id uuid primary key, user_id uuid);
    create table public.business_users (business_id uuid, user_id uuid);

    -- Estado "de partida" inseguro: abierto a cualquiera, como estaba en producción.
    -- perfilio_insights con business_id TEXT para comprobar que la policy vale con ambos tipos.
    create table public.bicho_notifications (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      type text not null, slug text not null, urgency text not null default 'baja',
      message text not null, is_read boolean not null default false, user_feedback text
    );
    create table public.perfilio_insights (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      business_id text, status text not null default 'pendiente', insight_text text
    );
    alter table public.bicho_notifications enable row level security;
    create policy abierta on public.bicho_notifications for all using (true) with check (true);
    grant all on public.bicho_notifications, public.perfilio_insights to anon, authenticated, service_role;

    insert into public.business_profiles values ('${NEGOCIO_A}', '${ANA}'), ('${NEGOCIO_B}', '${BEA}');
    insert into public.business_users values ('${NEGOCIO_A}', '${EMPLEADO}');
  `);

  await db.exec(sinColumnaInsights(MIGRATION));

  await db.exec(`
    insert into public.bicho_notifications (business_id, type, slug, message) values
      ('${NEGOCIO_A}', 'resumen_diario', 'resumen-diario-2026-10-05', 'aviso de A'),
      ('${NEGOCIO_B}', 'resumen_diario', 'resumen-diario-2026-10-05', 'aviso de B'),
      (null, 'legacy', 'sin-negocio', 'huérfano');
    insert into public.perfilio_insights (business_id, insight_text) values
      ('${NEGOCIO_A}', 'insight de A'), ('${NEGOCIO_B}', 'insight de B'), (null, 'huérfano');
  `);
});

afterAll(async () => {
  await db.close();
});

const mensajes = async (tabla: 'bicho_notifications' | 'perfilio_insights') => {
  const col = tabla === 'bicho_notifications' ? 'message' : 'insight_text';
  const r = await db.query<{ v: string }>(`select ${col} as v from public.${tabla} order by 1`);
  return r.rows.map((x) => x.v);
};

describe.each(['bicho_notifications', 'perfilio_insights'] as const)('RLS de %s', (tabla) => {
  const col = tabla === 'bicho_notifications' ? 'message' : 'insight_text';
  const propio = (negocio: string) => (negocio === NEGOCIO_A ? /de A/ : /de B/);

  it('la dueña de A solo ve lo de A', async () => {
    const vistos = await como(ANA, 'authenticated', () => mensajes(tabla));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatch(propio(NEGOCIO_A));
  });
  it('la dueña de B solo ve lo de B', async () => {
    const vistos = await como(BEA, 'authenticated', () => mensajes(tabla));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatch(propio(NEGOCIO_B));
  });
  it('un miembro de business_users ve lo de su negocio', async () => {
    const vistos = await como(EMPLEADO, 'authenticated', () => mensajes(tabla));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatch(propio(NEGOCIO_A));
  });
  it('un usuario sin negocio no ve nada, ni los huérfanos', async () => {
    const extraño = '00000000-0000-4000-8000-0000000000ff';
    expect(await como(extraño, 'authenticated', () => mensajes(tabla))).toEqual([]);
  });
  it('anon no puede leer', async () => {
    await expect(como(null, 'anon', () => mensajes(tabla))).rejects.toThrow(/permission denied/);
  });
  it('un usuario no puede insertar (solo el servidor)', async () => {
    const insertar = () =>
      tabla === 'bicho_notifications'
        ? db.exec(`insert into public.bicho_notifications (business_id, type, slug, message) values ('${NEGOCIO_A}', 't', 's', 'falso')`)
        : db.exec(`insert into public.perfilio_insights (business_id, insight_text) values ('${NEGOCIO_A}', 'falso')`);
    await expect(como(ANA, 'authenticated', insertar)).rejects.toThrow(/permission denied/);
  });
  it('un usuario no puede borrar', async () => {
    await expect(
      como(ANA, 'authenticated', () => db.exec(`delete from public.${tabla}`))
    ).rejects.toThrow(/permission denied/);
  });
  it('puede actualizar lo suyo pero no lo de otro negocio', async () => {
    const marca = tabla === 'bicho_notifications' ? 'is_read = true' : "status = 'resuelto'";
    const r = await como(ANA, 'authenticated', () =>
      db.query(`update public.${tabla} set ${marca} where true returning ${col}`)
    );
    expect(r.rows).toHaveLength(1); // solo la fila de A; B y el huérfano no se tocan
  });
  it('no puede pasar una fila suya a otro negocio', async () => {
    await expect(
      como(ANA, 'authenticated', () =>
        db.query(`update public.${tabla} set business_id = '${NEGOCIO_B}' where ${col} like '%de A'`)
      )
    ).rejects.toThrow(/row-level security/);
  });
  it('el servidor (service_role) lo ve todo', async () => {
    await db.exec('set role service_role');
    const todo = await mensajes(tabla);
    await db.exec('reset role');
    expect(todo).toHaveLength(3);
  });
});

describe('índice único del resumen diario', () => {
  it('impide dos resúmenes del mismo negocio el mismo día', async () => {
    await expect(
      db.exec(`insert into public.bicho_notifications (business_id, type, slug, message)
               values ('${NEGOCIO_A}', 'resumen_diario', 'resumen-diario-2026-10-05', 'duplicado')`)
    ).rejects.toThrow(/duplicate key/);
  });
  it('permite el mismo slug en otro negocio y otros tipos repetidos', async () => {
    await db.exec(`insert into public.bicho_notifications (business_id, type, slug, message)
                   values ('${NEGOCIO_A}', 'otro', 'x', '1'), ('${NEGOCIO_A}', 'otro', 'x', '2')`);
  });
});

describe('la migración', () => {
  it('es idempotente (se puede aplicar dos veces)', async () => {
    await db.exec(sinColumnaInsights(MIGRATION));
  });
  it('no deja policies abiertas', async () => {
    const r = await db.query<{ roles: string; cmd: string }>(
      `select roles::text as roles, cmd from pg_policies where tablename in ('bicho_notifications','perfilio_insights')`
    );
    expect(r.rows.map((p) => p.cmd).sort()).toEqual(['SELECT', 'SELECT', 'UPDATE', 'UPDATE']);
    expect(r.rows.every((p) => p.roles === '{authenticated}')).toBe(true);
  });
});
