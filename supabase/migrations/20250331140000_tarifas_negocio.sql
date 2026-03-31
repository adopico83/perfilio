-- Tarifas por negocio para presupuestos por dictado
create table if not exists public.tarifas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  nombre text not null,
  unidad text not null,
  precio numeric(12, 2) not null,
  categoria text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tarifas_business on public.tarifas (business_id);

alter table public.tarifas enable row level security;

create policy "tarifas_select_own_business"
  on public.tarifas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = tarifas.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "tarifas_insert_own_business"
  on public.tarifas
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = tarifas.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "tarifas_update_own_business"
  on public.tarifas
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = tarifas.business_id
        and bp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = tarifas.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "tarifas_delete_own_business"
  on public.tarifas
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = tarifas.business_id
        and bp.user_id = auth.uid()
    )
  );
