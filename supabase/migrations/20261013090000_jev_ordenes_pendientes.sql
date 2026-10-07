-- Órdenes .jev pendientes: lo que el agente PROPONE y el usuario confirma con «Sí, hazlo».
-- El navegador solo conoce el `id`; lo que se ejecuta al confirmar es exactamente `args_resueltos` (lo mismo
-- que se enseñó en `resumen`), cargado aquí por el servidor. También guarda la «tarea en curso» (estado
-- `en_curso`) cuando falta un dato y el agente pregunta.
-- ADITIVA y re-ejecutable: tabla nueva, RLS por negocio con perfilio_user_in_business; solo el servidor
-- (service_role) escribe. No toca datos existentes.
create table if not exists public.jev_ordenes_pendientes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  user_id uuid not null,
  orden jsonb not null,
  args_resueltos jsonb,
  resumen text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'confirmada', 'cancelada', 'caducada')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  usada_at timestamptz
);

create index if not exists idx_jev_ordenes_negocio_usuario
  on public.jev_ordenes_pendientes (business_id, user_id, estado, created_at desc);

alter table public.jev_ordenes_pendientes enable row level security;

revoke all on table public.jev_ordenes_pendientes from anon;
revoke all on table public.jev_ordenes_pendientes from authenticated;
grant select on table public.jev_ordenes_pendientes to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'jev_ordenes_pendientes' and policyname = 'jev_ordenes_select_propio'
  ) then
    create policy jev_ordenes_select_propio on public.jev_ordenes_pendientes
      for select to authenticated
      using (public.perfilio_user_in_business(business_id::text));
  end if;
end
$$;
