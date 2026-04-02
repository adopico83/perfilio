-- Memoria persistente del negocio para el agente
create table if not exists public.memoria_negocio (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  categoria text not null,
  clave text not null,
  valor_texto text not null,
  created_at timestamptz not null default now(),
  unique (business_id, clave)
);

create index if not exists idx_memoria_negocio_business on public.memoria_negocio (business_id);

alter table public.memoria_negocio enable row level security;

create policy "memoria_negocio_select_own"
  on public.memoria_negocio
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = memoria_negocio.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "memoria_negocio_insert_own"
  on public.memoria_negocio
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = memoria_negocio.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "memoria_negocio_update_own"
  on public.memoria_negocio
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = memoria_negocio.business_id
        and bp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = memoria_negocio.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "memoria_negocio_delete_own"
  on public.memoria_negocio
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = memoria_negocio.business_id
        and bp.user_id = auth.uid()
    )
  );
