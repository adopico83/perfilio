-- Enlaza cada presupuesto con la previsualización que lo originó (si la hubo)
-- para poder recuperar una confirmación que se quedó a medias: si el insert en
-- presupuestos tuvo éxito pero marcar la preview como confirmada falló o el
-- proceso se cayó justo ahí, confirmar_presupuesto puede volver a llamarse y
-- encontrar el presupuesto ya creado por preview_id en vez de duplicarlo.
alter table public.presupuestos
  add column if not exists preview_id uuid references public.presupuesto_previews (id) on delete set null;

create unique index if not exists idx_presupuestos_preview_id_unique
  on public.presupuestos (preview_id)
  where preview_id is not null;
