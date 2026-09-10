-- =============================================================================
-- Correctivo PROD: acceso del tenant demo de reformas
-- =============================================================================
--
-- SÍNTOMA
--   User Auth demo-reformas@perfilio.app
--   UUID c848c42d-cd40-48c3-a07b-35e06e844e5b
--   Login OK, cabecera «Reformas Demo Errenteria».
--   Clientes/Obras: «No tienes acceso a este negocio». Presupuestos vacío.
--
-- CAUSA
--   El seed original solo insertó business_profiles. Las API
--   (assertUserOwnsBusiness) miran business_users y, si la tabla existe,
--   NO caían a business_profiles. getBusinessId* sí usa perfiles → header OK.
--
-- QUÉ HACE ESTE SCRIPT
--   1. Localiza el business_profiles de ESE UUID con marcador [seed:demo-reformas].
--   2. Si el perfil parece Pino / no es demo → ABORTA. No toca otros tenants.
--   3. Si existe public.business_users, inserta membership (user_id + business_id).
--      Idempotente: no duplica si ya hay fila.
--
-- NO borra ni actualiza filas de Pino ni perfiles sin el marcador demo.
--
-- CÓMO EJECUTAR
--   Supabase Dashboard (prod) → SQL Editor → pegar todo → Run.
--   Mirar Notices + la SELECT de verificación al final (Results).
-- =============================================================================

-- Schema real de business_users (vacío = la tabla no está en este proyecto).
select
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'business_users'
order by c.ordinal_position;

do $$
declare
  demo_user_id  constant uuid := 'c848c42d-cd40-48c3-a07b-35e06e844e5b';
  seed_marker   constant text := '[seed:demo-reformas]';
  v_email                text;
  v_business_id          uuid;
  v_nombre               text;
  v_contexto             text;
  v_bu_has_role          boolean := false;
  v_already              boolean := false;
begin
  select u.email
    into v_email
  from auth.users u
  where u.id = demo_user_id;

  if v_email is null then
    raise exception
      'No existe auth.users %. Este correctivo es solo para el user demo ya creado.',
      demo_user_id;
  end if;

  select bp.id, bp.nombre, bp.contexto_adicional
    into v_business_id, v_nombre, v_contexto
  from public.business_profiles bp
  where bp.user_id = demo_user_id
  limit 1;

  if v_business_id is null then
    raise exception
      'El user % (%) no tiene business_profiles. Ejecuta antes scripts/seed-demo-reformas.sql. No se toca nada.',
      demo_user_id, v_email;
  end if;

  if coalesce(v_contexto, '') not like '%' || seed_marker || '%' then
    raise exception
      'El perfil «%» (%) de este user NO tiene marcador %. Abortado: no se tocan perfiles sin marcador demo / Pino.',
      coalesce(v_nombre, '(sin nombre)'), v_business_id, seed_marker;
  end if;

  if v_nombre ilike '%pino%' or v_nombre ilike '%aluminio%' then
    raise exception
      'Abortado: el perfil «%» parece Pino/aluminio. Este script solo liga el tenant demo de reformas.',
      v_nombre;
  end if;

  if to_regclass('public.business_users') is null then
    raise notice
      'Tabla public.business_users no existe. No hay membership que insertar. El 403 se corrige desplegando lib/supabase/assert-user-owns-business.ts (cae a business_profiles).';
    raise notice 'Auth user: % (%)', demo_user_id, v_email;
    raise notice 'business_id demo: % (%)', v_business_id, v_nombre;
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'business_users'
      and c.column_name = 'role'
  ) into v_bu_has_role;

  select exists (
    select 1
    from public.business_users bu
    where bu.user_id = demo_user_id
      and bu.business_id = v_business_id
  ) into v_already;

  if v_already then
    raise notice 'business_users YA tenía fila para user % y business %. Nada que insertar.', demo_user_id, v_business_id;
  else
    begin
      if v_bu_has_role then
        execute 'insert into public.business_users (business_id, user_id, role) values ($1, $2, $3)'
          using v_business_id, demo_user_id, 'owner';
      else
        execute 'insert into public.business_users (business_id, user_id) values ($1, $2)'
          using v_business_id, demo_user_id;
      end if;
      raise notice 'business_users INSERT OK: user % → business % (%)', demo_user_id, v_business_id, v_nombre;
    exception
      when unique_violation then
        raise notice 'business_users ya existía (unique). OK.';
      when others then
        begin
          execute 'insert into public.business_users (business_id, user_id) values ($1, $2)'
            using v_business_id, demo_user_id;
          raise notice 'business_users INSERT OK sin role: user % → business %', demo_user_id, v_business_id;
        exception
          when unique_violation then
            raise notice 'business_users ya existía (unique). OK.';
          when others then
            raise exception
              'No se pudo insertar business_users (%). Revisa las columnas de la SELECT de schema arriba. No se ha tocado Pino.',
              SQLERRM;
        end;
    end;
  end if;

  raise notice '---';
  raise notice 'Correctivo demo reformas OK';
  raise notice 'Auth user: % (%)', demo_user_id, v_email;
  raise notice 'business_id: % (%)', v_business_id, v_nombre;
end $$;

-- =============================================================================
-- Verificación (Ander / El bicho). Pegar el resultado si algo sigue en 403.
-- =============================================================================

-- A) Perfil demo (siempre). 1 fila, nombre Reformas Demo Errenteria, es_demo_reformas = true.
select
  u.id                         as auth_user_id,
  u.email                      as auth_email,
  bp.id                        as business_id,
  bp.nombre                    as business_nombre,
  bp.sector,
  (coalesce(bp.contexto_adicional, '') like '%[seed:demo-reformas]%') as es_demo_reformas,
  to_regclass('public.business_users')                               as business_users_regclass
from auth.users u
join public.business_profiles bp
  on bp.user_id = u.id
where u.id = 'c848c42d-cd40-48c3-a07b-35e06e844e5b';

-- B) Membership. En prod debe devolver 1 fila (el 403 venía de no tenerla).
--    Si (A) muestra business_users_regclass NULL, esta SELECT puede fallar: ignoradla.
select
  bu.user_id,
  bu.business_id
from public.business_users bu
where bu.user_id = 'c848c42d-cd40-48c3-a07b-35e06e844e5b'
  and bu.business_id in (
    select bp.id
    from public.business_profiles bp
    where bp.user_id = 'c848c42d-cd40-48c3-a07b-35e06e844e5b'
      and coalesce(bp.contexto_adicional, '') like '%[seed:demo-reformas]%'
  );
