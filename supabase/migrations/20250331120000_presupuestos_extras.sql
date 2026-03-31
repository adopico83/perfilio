-- Extras / modificados: presupuesto hijo vinculado al original
alter table public.presupuestos
  add column if not exists parent_id uuid references public.presupuestos (id) on delete set null;

alter table public.presupuestos
  add column if not exists es_extra boolean not null default false;

create index if not exists idx_presupuestos_parent on public.presupuestos (parent_id);
create index if not exists idx_presupuestos_business_extra on public.presupuestos (business_id, es_extra);
