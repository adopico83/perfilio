-- Proveedores como ficha (antes «proveedor» era solo un texto dentro del gasto).
-- ADITIVA y re-ejecutable: tabla nueva con RLS por negocio (perfilio_user_in_business) y `gastos.proveedor_id`
-- (nulo, FK, `on delete set null`). No toca datos existentes: los gastos antiguos siguen con su texto.
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  nombre text not null,
  nif text,
  telefono text,
  email text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proveedores_business_nombre on public.proveedores (business_id, nombre);

alter table public.proveedores enable row level security;

revoke all on table public.proveedores from anon;
grant select, insert, update, delete on table public.proveedores to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'proveedores_select_propio') then
    create policy proveedores_select_propio on public.proveedores
      for select to authenticated using (public.perfilio_user_in_business(business_id::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'proveedores_insert_propio') then
    create policy proveedores_insert_propio on public.proveedores
      for insert to authenticated with check (public.perfilio_user_in_business(business_id::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'proveedores_update_propio') then
    create policy proveedores_update_propio on public.proveedores
      for update to authenticated
      using (public.perfilio_user_in_business(business_id::text))
      with check (public.perfilio_user_in_business(business_id::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'proveedores_delete_propio') then
    create policy proveedores_delete_propio on public.proveedores
      for delete to authenticated using (public.perfilio_user_in_business(business_id::text));
  end if;
end
$$;

alter table public.gastos
  add column if not exists proveedor_id uuid references public.proveedores (id) on delete set null;

create index if not exists idx_gastos_proveedor_id on public.gastos (proveedor_id);
