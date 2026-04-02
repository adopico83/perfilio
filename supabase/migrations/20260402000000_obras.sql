-- Obras: entidad central que agrupa cliente, presupuestos, facturas, albaranes,
-- entradas de diario y gastos.

create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete set null,
  nombre text not null,
  direccion text,
  estado text not null default 'abierta',
  fecha_inicio date,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_obras_business_created on public.obras (business_id, created_at desc);
create index if not exists idx_obras_business_estado on public.obras (business_id, estado);
create index if not exists idx_obras_cliente_id on public.obras (cliente_id);

alter table public.obras enable row level security;

create policy "obras_select_own_business"
  on public.obras
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = obras.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "obras_insert_own_business"
  on public.obras
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = obras.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "obras_update_own_business"
  on public.obras
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = obras.business_id
        and bp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = obras.business_id
        and bp.user_id = auth.uid()
    )
  );

-- Asociaciones por obra para vincular documentos existentes
alter table if exists public.presupuestos
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

alter table if exists public.facturas
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

alter table if exists public.albaranes
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

alter table if exists public.gastos
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

alter table if exists public.diario_obra
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

-- Índices rápidos por obra
create index if not exists idx_presupuestos_obra_id on public.presupuestos (obra_id);
create index if not exists idx_facturas_obra_id on public.facturas (obra_id);
create index if not exists idx_albaranes_obra_id on public.albaranes (obra_id);
create index if not exists idx_gastos_obra_id on public.gastos (obra_id);
create index if not exists idx_diario_obra_obra_id on public.diario_obra (obra_id);

