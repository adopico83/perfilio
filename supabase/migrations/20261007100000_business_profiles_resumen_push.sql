-- Aviso push opcional del «Resumen del día». Solo cambios aditivos: una columna nueva con
-- default false (nadie recibe el aviso hasta que se active a mano). No toca datos existentes.
--
-- Para activarlo en un negocio (ejemplo, no se ejecuta aquí):
--   update public.business_profiles set resumen_push = true where id = '<uuid del negocio>';

alter table if exists public.business_profiles
  add column if not exists resumen_push boolean not null default false;

comment on column public.business_profiles.resumen_push is
  'true = el cron del resumen diario manda además un aviso push (Pushover y/o web push). Por defecto false.';

-- RLS de business_profiles es por fila: la columna nueva queda cubierta por las policies
-- existentes. No se añaden policies. Si hay GRANT por columna, se copian los de `nombre` (mismo
-- bloque que 20260924120000_business_profiles_emisor.sql); un GRANT de tabla ya incluye las
-- columnas futuras y repetirlo es inocuo.
do $$
declare
  r record;
  col text;
  cols text[] := array['resumen_push'];
  destino text;
begin
  if to_regclass('public.business_profiles') is null then
    raise notice 'business_profiles no existe; grants de resumen_push omitidos';
    return;
  end if;

  for r in
    select grantee, privilege_type
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'business_profiles'
      and column_name = 'nombre'
  loop
    if r.grantee = 'PUBLIC' then
      destino := 'public';
    else
      destino := format('%I', r.grantee);
    end if;

    foreach col in array cols loop
      begin
        execute format(
          'grant %s (%I) on table public.business_profiles to %s',
          r.privilege_type,
          col,
          destino
        );
      exception
        when insufficient_privilege or undefined_object then
          raise notice 'grant % en % omitido: %', r.privilege_type, col, sqlerrm;
      end;
    end loop;
  end loop;
end $$;
