-- Diario de obra por negocio
create table if not exists public.diario_obra (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  obra_nombre text not null,
  obra_direccion text,
  texto text,
  fotos text[] not null default '{}',
  videos text[] not null default '{}',
  fecha timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_diario_obra_business_fecha on public.diario_obra (business_id, fecha desc);
create index if not exists idx_diario_obra_business_obra_nombre on public.diario_obra (business_id, obra_nombre);

alter table public.diario_obra enable row level security;

create policy "diario_obra_select_own_business"
  on public.diario_obra
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = diario_obra.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "diario_obra_insert_own_business"
  on public.diario_obra
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = diario_obra.business_id
        and bp.user_id = auth.uid()
    )
  );

-- Bucket para fotos, vídeos y PDFs del diario (acceso vía API con service role + URLs firmadas)
insert into storage.buckets (id, name, public)
values ('diario-obra', 'diario-obra', false)
on conflict (id) do nothing;
