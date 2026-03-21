-- Tabla agenda: recordatorios y eventos por negocio
create table if not exists public.agenda (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  titulo text not null,
  fecha date not null,
  hora text,
  completado boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_agenda_business_fecha on public.agenda (business_id, fecha);

alter table public.agenda enable row level security;

create policy "agenda_select_own_business"
  on public.agenda
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = agenda.business_id
        and bp.user_id = auth.uid()
    )
  );
