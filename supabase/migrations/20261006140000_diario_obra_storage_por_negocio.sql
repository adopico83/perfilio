-- Aísla el bucket privado `diario-obra` por negocio.
--
-- Problema: las policies de storage.objects `read_diario_obra` (SELECT) y `upload_diario_obra`
-- (INSERT) solo comprobaban `bucket_id = 'diario-obra'`. Cualquier usuario autenticado podía leer
-- o subir ficheros en la carpeta de OTRO negocio hablando directamente con Storage (anon key).
--
-- Arreglo: el primer segmento de cada ruta del bucket es el business_id
-- (`{business_id}/[{entrada}/]{ts}_{nombre}.{ext}`, ver buildDiarioObraObjectPath), así que se limita
-- por carpeta con perfilio_user_in_business(), que cubre al dueño (business_profiles.user_id) y a los
-- miembros (business_users). Mismo patrón que el bucket presupuestos-pdf.
--
-- Esta es la ÚNICA migración "no aditiva" del bloque: hace `drop policy` de las dos policies abiertas
-- (y de las de UPDATE/DELETE del mismo bucket si tuvieran el mismo fallo, que se recrean ya limitadas).
-- No toca ninguna otra policy, ni datos, ni ficheros del bucket. El servidor (service role) no
-- depende de estas policies: sigue subiendo, firmando y borrando igual.

-- Depende de public.perfilio_user_in_business(text) (migración 20261005090000).
do $$
begin
  if to_regprocedure('public.perfilio_user_in_business(text)') is null then
    raise exception 'Falta public.perfilio_user_in_business(text): aplica antes 20261005090000_notificaciones_insights_rls.sql';
  end if;
end
$$;

-- 1. Las dos policies conocidas: fuera las abiertas, dentro las limitadas por carpeta de negocio.
drop policy if exists "read_diario_obra" on storage.objects;
drop policy if exists "upload_diario_obra" on storage.objects;

create policy "read_diario_obra"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'diario-obra'
    and public.perfilio_user_in_business((storage.foldername(name))[1])
  );

create policy "upload_diario_obra"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'diario-obra'
    and public.perfilio_user_in_business((storage.foldername(name))[1])
  );

-- 2. UPDATE / DELETE (y ALL) sobre este bucket con el mismo fallo: se detectan las que mencionan
--    'diario-obra' y NO comprueban la carpeta ni la pertenencia al negocio. Cada una se sustituye por
--    otra del mismo nombre y del mismo tipo, ya limitada. Si no existía ninguna, no se crea nada
--    (no se da a nadie un permiso que no tenía).
do $$
declare
  pol record;
  condicion constant text := $c$bucket_id = 'diario-obra' and public.perfilio_user_in_business((storage.foldername(name))[1])$c$;
begin
  for pol in
    select policyname, cmd
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') ilike '%diario-obra%' or coalesce(with_check, '') ilike '%diario-obra%')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') not ilike '%foldername%'
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') not ilike '%perfilio_user_in_business%'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);

    if pol.cmd = 'UPDATE' then
      execute format(
        'create policy %I on storage.objects for update to authenticated using (%s) with check (%s)',
        pol.policyname, condicion, condicion);
    elsif pol.cmd = 'DELETE' then
      execute format(
        'create policy %I on storage.objects for delete to authenticated using (%s)',
        pol.policyname, condicion);
    else
      execute format(
        'create policy %I on storage.objects for all to authenticated using (%s) with check (%s)',
        pol.policyname, condicion, condicion);
    end if;
    raise notice 'policy % (%) de diario-obra limitada por negocio', pol.policyname, pol.cmd;
  end loop;
end
$$;
