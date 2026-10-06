-- ⚠️ MIGRACIÓN NO ADITIVA: sustituye 2 policies de storage. Revisar antes de aplicar.
--
-- Buckets privados `presupuestos-pdf` y `facturas-pdf`. Sus policies de lectura
-- (`presupuestos_pdf_select_own_business` y `facturas_pdf_select_own_business`) ya miran la carpeta
-- (primer segmento de la ruta = business_id) pero solo aceptan a quien está en `business_users`.
-- Se homogeneizan con el resto (diario-obra, PR #35) usando perfilio_user_in_business(), que además
-- cubre al dueño que figura en business_profiles.user_id y no en business_users.
-- NO se tapa ningún agujero: es unificar criterio. Las rutas no cambian ({business_id}/{id}.pdf).
--
-- No se crean policies de INSERT/UPDATE/DELETE: solo escribe el servidor con service role.
-- Orden: primero se crean las nuevas y después se borran las viejas (nunca hay un instante sin acceso).
-- Re-ejecutable: cada create va precedido de su drop policy if exists.
-- No toca `business-assets` (solo deja al dueño, no a los miembros) ni `diario-obra`.

do $$
begin
  if to_regprocedure('public.perfilio_user_in_business(text)') is null then
    raise exception 'Falta public.perfilio_user_in_business(text): aplica antes 20261005090000_notificaciones_insights_rls.sql';
  end if;
end
$$;

drop policy if exists "presupuestos_pdf_select_negocio" on storage.objects;
create policy "presupuestos_pdf_select_negocio"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'presupuestos-pdf'
    and public.perfilio_user_in_business((storage.foldername(name))[1])
  );

drop policy if exists "facturas_pdf_select_negocio" on storage.objects;
create policy "facturas_pdf_select_negocio"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'facturas-pdf'
    and public.perfilio_user_in_business((storage.foldername(name))[1])
  );

drop policy if exists "presupuestos_pdf_select_own_business" on storage.objects;
drop policy if exists "facturas_pdf_select_own_business" on storage.objects;
