-- Clientes por negocio y vínculo opcional en documentos y diario
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  nombre text not null,
  telefono text,
  email text,
  direccion text,
  nif text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_business_nombre on public.clientes (business_id, nombre);
create index if not exists idx_clientes_business_created on public.clientes (business_id, created_at desc);

alter table public.presupuestos
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

alter table public.facturas
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

alter table public.albaranes
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

alter table public.diario_obra
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;

create index if not exists idx_presupuestos_cliente on public.presupuestos (cliente_id);
create index if not exists idx_facturas_cliente on public.facturas (cliente_id);
create index if not exists idx_albaranes_cliente on public.albaranes (cliente_id);
create index if not exists idx_diario_obra_cliente on public.diario_obra (cliente_id);

alter table public.clientes enable row level security;

create policy "clientes_select_own_business"
  on public.clientes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = clientes.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "clientes_insert_own_business"
  on public.clientes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = clientes.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "clientes_update_own_business"
  on public.clientes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = clientes.business_id
        and bp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = clientes.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "clientes_delete_own_business"
  on public.clientes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = clientes.business_id
        and bp.user_id = auth.uid()
    )
  );
