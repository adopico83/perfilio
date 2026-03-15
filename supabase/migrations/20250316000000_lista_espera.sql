-- Tabla para lista de espera (landing / agentes IA)
create table if not exists public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellido text not null,
  telefono text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lista_espera_created_at
  on public.lista_espera (created_at desc);

comment on table public.lista_espera is 'Lista de espera para agentes IA / trial desde la landing';
