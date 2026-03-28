-- Gastos registrados desde tickets/facturas (p. ej. vía agente OCR)
create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  proveedor text not null,
  importe numeric not null,
  iva numeric not null,
  importe_total numeric not null,
  fecha date not null,
  descripcion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_gastos_business_fecha on public.gastos (business_id, fecha desc);

alter table public.gastos enable row level security;

create policy "gastos_select_own_business"
  on public.gastos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = gastos.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "gastos_insert_own_business"
  on public.gastos
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = gastos.business_id
        and bp.user_id = auth.uid()
    )
  );
