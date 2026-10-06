-- Marca de cada negocio en sus PDF de presupuesto y factura.
-- Solo cambios aditivos: columnas nuevas y nullable (NULL = el aspecto de siempre), CHECKs que
-- toleran NULL y el bucket de logos si aún no existiera. No toca ni rellena datos existentes.

alter table if exists public.business_profiles
  add column if not exists marca_color_primario text,
  add column if not exists marca_color_secundario text,
  add column if not exists marca_tipografia text,
  add column if not exists marca_observaciones_presupuesto text;

-- CHECKs: mismas reglas que valida la API (lib/pdf/marca.ts). Se crean solo si no existen.
do $$
begin
  if to_regclass('public.business_profiles') is null then
    raise notice 'business_profiles no existe; CHECKs de marca omitidos';
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'business_profiles_marca_color_primario_hex') then
    alter table public.business_profiles
      add constraint business_profiles_marca_color_primario_hex
      check (marca_color_primario is null or marca_color_primario ~ '^#[0-9A-Fa-f]{6}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'business_profiles_marca_color_secundario_hex') then
    alter table public.business_profiles
      add constraint business_profiles_marca_color_secundario_hex
      check (marca_color_secundario is null or marca_color_secundario ~ '^#[0-9A-Fa-f]{6}$');
  end if;

  -- Fuentes estándar de PDF: no hace falta descargar ni incrustar nada.
  if not exists (select 1 from pg_constraint where conname = 'business_profiles_marca_tipografia_estandar') then
    alter table public.business_profiles
      add constraint business_profiles_marca_tipografia_estandar
      check (marca_tipografia is null or marca_tipografia in ('Helvetica', 'Times-Roman', 'Courier'));
  end if;
end
$$;

comment on column public.business_profiles.marca_color_primario is
  'Color (#RRGGBB) de cabeceras de tabla y títulos en PDF. NULL = el de siempre.';
comment on column public.business_profiles.marca_color_secundario is
  'Color (#RRGGBB) de fondos de cajas y filas alternas en PDF. NULL = el de siempre.';
comment on column public.business_profiles.marca_tipografia is
  'Fuente estándar de PDF: Helvetica, Times-Roman o Courier. NULL = Helvetica.';
comment on column public.business_profiles.marca_observaciones_presupuesto is
  'Texto de OBSERVACIONES de los presupuestos. NULL = el texto estándar.';

-- Bucket privado de logos (ya existe en producción: no cambia nada si está). El servidor sube con el
-- service role y firma la URL al generar el PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-assets', 'business-assets', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- RLS de business_profiles es por fila: las columnas nuevas quedan cubiertas por las policies
-- existentes. No se añaden policies. Si hay GRANT por columna, se copian los de `nombre` (mismo
-- bloque que 20260924120000_business_profiles_emisor.sql); un GRANT de tabla ya incluye las
-- columnas futuras y repetirlo es inocuo.
do $$
declare
  r record;
  col text;
  cols text[] := array[
    'marca_color_primario',
    'marca_color_secundario',
    'marca_tipografia',
    'marca_observaciones_presupuesto'
  ];
  destino text;
begin
  if to_regclass('public.business_profiles') is null then
    raise notice 'business_profiles no existe; grants de marca omitidos';
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
