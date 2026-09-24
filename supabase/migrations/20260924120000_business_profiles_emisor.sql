-- Datos de emisor para presupuestos y facturas (por negocio).
-- Columnas nullable: si un campo está vacío, el documento omite esa línea.
-- No sustituyen `direccion` / `ciudad` (ubicación del agente y la meteorología).

alter table if exists public.business_profiles
  add column if not exists razon_social text,
  add column if not exists nif text,
  add column if not exists rea text,
  add column if not exists telefono text,
  add column if not exists email text,
  add column if not exists web text,
  add column if not exists instagram text,
  add column if not exists iban text,
  add column if not exists direccion_fiscal text,
  add column if not exists localidad_fiscal text;

comment on column public.business_profiles.razon_social is
  'Razón social del emisor en presupuestos y facturas.';
comment on column public.business_profiles.nif is
  'NIF del emisor.';
comment on column public.business_profiles.rea is
  'Número R.E.A. del emisor, sin la etiqueta.';
comment on column public.business_profiles.telefono is
  'Teléfono del emisor en documentos.';
comment on column public.business_profiles.email is
  'Email del emisor en documentos.';
comment on column public.business_profiles.web is
  'Web del pie de presupuesto y factura.';
comment on column public.business_profiles.instagram is
  'Usuario de Instagram del emisor (con o sin @).';
comment on column public.business_profiles.iban is
  'Cuentas del emisor. Una línea por cuenta, por ejemplo «BANCO: ES00 …».';
comment on column public.business_profiles.direccion_fiscal is
  'Calle del emisor en documentos. Independiente de direccion (meteo).';
comment on column public.business_profiles.localidad_fiscal is
  'Línea de C.P. y localidad del emisor en documentos.';

-- RLS de business_profiles es por fila: estas columnas quedan cubiertas por las
-- policies ya existentes. No se añaden policies nuevas.
-- Si hay GRANT por columna, se copian los de `nombre` para no dejar las nuevas
-- fuera. Un GRANT de tabla ya incluye las columnas futuras; repetirlo es inocuo.
do $$
declare
  r record;
  col text;
  v_filas integer;
  cols text[] := array[
    'razon_social',
    'nif',
    'rea',
    'telefono',
    'email',
    'web',
    'instagram',
    'iban',
    'direccion_fiscal',
    'localidad_fiscal'
  ];
  destino text;
begin
  if to_regclass('public.business_profiles') is null then
    raise notice 'business_profiles no existe; seed de emisor omitido';
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

  -- Valores que antes estaban fijos en las plantillas PDF.
  -- No se adivina el id: cualquier perfil cuyo nombre contiene «pino»,
  -- excepto el tenant demo. Si hay más de una fila, todas reciben los mismos
  -- datos (en producción se espera una sola).
  update public.business_profiles
  set
    razon_social = 'AL&CA Pino Gutiérrez Albañilería en General S.L.',
    nif = 'B-75207308',
    rea = '15/20/0014364',
    telefono = '943 57 49 19',
    email = 'info@pinoalbanileria.com',
    web = 'www.pinoalbanileria.net',
    instagram = '@pinoalbanileria',
    iban = E'KUTXABANK: ES63 2095 5086 1091 2060 8015\nBANCO SABADELL: ES40 0081 4332 4000 0111 1021',
    direccion_fiscal = 'C/ Bartolomé de Urdinso Nº 15 Local 1 Bis',
    localidad_fiscal = 'C.P. 20.301 Irún (Guipúzcoa)'
  where nombre ilike '%pino%'
    and id <> '900ed462-7640-4893-9030-a41163219f7a';

  get diagnostics v_filas = row_count;
  raise notice 'emisor: % fila(s) con nombre ILIKE %%pino%%', v_filas;

  update public.business_profiles
  set
    razon_social = 'Reformas Demo Errenteria S.L.',
    nif = 'B00000000',
    telefono = '600 000 000',
    email = 'demo-reformas@perfilio.app',
    web = null,
    instagram = null,
    iban = 'ES00 0000 0000 0000 0000 0000'
  where id = '900ed462-7640-4893-9030-a41163219f7a';
end $$;
