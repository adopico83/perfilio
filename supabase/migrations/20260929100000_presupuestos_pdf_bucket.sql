-- Fase 3 MCP: bucket privado para el PDF oficial de presupuestos.
-- La tool obtener_enlace_pdf_presupuesto sube {business_id}/{presupuesto_id}.pdf
-- con el service role (salta RLS) y devuelve una URL firmada que caduca.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('presupuestos-pdf', 'presupuestos-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Solo lectura para usuarios autenticados, limitada a la carpeta de su negocio
-- (primer segmento del path = business_id) vía membresía en business_users,
-- igual criterio que presupuesto_previews. No hay políticas de insert/update/
-- delete: solo escribe el service role.
drop policy if exists "presupuestos_pdf_select_own_business" on storage.objects;
drop policy if exists "presupuestos_pdf_insert_own_business" on storage.objects;
drop policy if exists "presupuestos_pdf_update_own_business" on storage.objects;
drop policy if exists "presupuestos_pdf_delete_own_business" on storage.objects;

create policy "presupuestos_pdf_select_own_business"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'presupuestos-pdf'
    and exists (
      select 1
      from public.business_users bu
      where bu.user_id = auth.uid()
        and bu.business_id::text = (storage.foldername(name))[1]
    )
  );
