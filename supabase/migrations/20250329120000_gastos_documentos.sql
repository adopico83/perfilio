-- Relación N:M entre gastos y facturas/albaranes
create table if not exists public.gastos_documentos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  gasto_id uuid not null references public.gastos (id) on delete cascade,
  documento_tipo text not null check (documento_tipo in ('factura', 'albaran')),
  documento_id uuid not null,
  created_at timestamptz not null default now(),
  unique (gasto_id, documento_tipo, documento_id)
);

create index if not exists idx_gastos_documentos_gasto on public.gastos_documentos (gasto_id);
create index if not exists idx_gastos_documentos_documento on public.gastos_documentos (documento_tipo, documento_id);

alter table public.gastos_documentos enable row level security;

create policy "gastos_documentos_select_own_business"
  on public.gastos_documentos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = gastos_documentos.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "gastos_documentos_insert_own_business"
  on public.gastos_documentos
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = gastos_documentos.business_id
        and bp.user_id = auth.uid()
    )
  );
