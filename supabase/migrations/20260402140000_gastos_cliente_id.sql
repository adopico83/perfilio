-- Cliente asociado al gasto (p. ej. heredado de la obra)
alter table if exists public.gastos
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

create index if not exists idx_gastos_cliente_id on public.gastos (cliente_id);
