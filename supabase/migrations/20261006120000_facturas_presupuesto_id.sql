-- Facturas desde presupuesto: vínculo factura -> presupuesto, una factura por presupuesto,
-- y bucket privado para el PDF oficial de facturas (tool MCP obtener_enlace_pdf_factura).
-- Solo cambios aditivos: no borra ni modifica filas existentes.

alter table public.facturas
  add column if not exists presupuesto_id uuid references public.presupuestos (id) on delete set null;

-- Una sola factura por presupuesto (los NULL, p. ej. facturas de albarán, no cuentan).
create unique index if not exists uq_facturas_presupuesto_id
  on public.facturas (presupuesto_id)
  where presupuesto_id is not null;

-- Bucket privado: el servidor (service role) sube {business_id}/{factura_id}.pdf y entrega una
-- URL firmada que caduca.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas-pdf', 'facturas-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Solo lectura para usuarios autenticados, limitada a la carpeta de su negocio (primer segmento
-- del path = business_id). Sin políticas de insert/update/delete: solo escribe el service role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'facturas_pdf_select_own_business'
  ) then
    create policy "facturas_pdf_select_own_business"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'facturas-pdf'
        and exists (
          select 1
          from public.business_users bu
          where bu.user_id = auth.uid()
            and bu.business_id::text = (storage.foldername(name))[1]
        )
      );
  end if;
end
$$;
