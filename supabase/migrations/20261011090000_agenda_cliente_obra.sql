-- La cita de agenda guarda a qué cliente y a qué obra pertenece (antes solo había texto en el título).
-- Así «lo de Mikel» no se confunde con otro cliente que comparta apellido.
-- ADITIVA y re-ejecutable: dos columnas nulas con FK y `on delete set null` (si se borra el cliente o la obra,
-- la cita se queda, solo pierde el vínculo). No toca datos existentes.
alter table public.agenda
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;
alter table public.agenda
  add column if not exists obra_id uuid references public.obras (id) on delete set null;

create index if not exists idx_agenda_cliente_id on public.agenda (cliente_id);
create index if not exists idx_agenda_obra_id on public.agenda (obra_id);
