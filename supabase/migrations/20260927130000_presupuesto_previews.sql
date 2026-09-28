-- Previsualizaciones de presupuesto (Fase 2 MCP): guardan el cálculo del
-- servidor antes de confirmar, para que confirmar_presupuesto nunca dependa
-- de un total que aporte el modelo.
create table if not exists public.presupuesto_previews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  -- Texto libre, no uuid: en MCP no hay usuario real (ver lib/mcp/auth.ts).
  creado_por text,
  cliente_nombre text not null,
  obra_id uuid references public.obras (id) on delete set null,
  iva_porcentaje int not null,
  partidas jsonb not null,
  texto_canonico text not null,
  base_imponible numeric(14, 2),
  iva_importe numeric(14, 2),
  total numeric(14, 2) not null,
  avisos jsonb,
  observaciones text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmando', 'confirmado')),
  presupuesto_id uuid references public.presupuestos (id) on delete set null,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists idx_presupuesto_previews_business_expires
  on public.presupuesto_previews (business_id, expires_at);

alter table public.presupuesto_previews enable row level security;

-- Solo lectura para usuarios autenticados, vía membresía (business_users),
-- igual que el resto de tablas de negocio (ver lib/supabase/assert-user-owns-business.ts).
-- No hay políticas de insert/update/delete: esta tabla solo la escribe el
-- cliente de service role del MCP (lib/mcp/auth.ts), que salta RLS; no hace
-- falta ampliar la superficie de escritura a usuarios autenticados.
drop policy if exists "presupuesto_previews_select_own_business" on public.presupuesto_previews;
drop policy if exists "presupuesto_previews_insert_own_business" on public.presupuesto_previews;
drop policy if exists "presupuesto_previews_update_own_business" on public.presupuesto_previews;
drop policy if exists "presupuesto_previews_delete_own_business" on public.presupuesto_previews;

create policy "presupuesto_previews_select_own_business"
  on public.presupuesto_previews
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_users bu
      where bu.business_id = presupuesto_previews.business_id
        and bu.user_id = auth.uid()
    )
  );
