-- La agenda ya guarda citas en public.agenda (titulo, fecha, hora).
-- El agente escribe description, location y minutos_antelacion, pero el
-- CREATE TABLE original no las declaraba. En producción existen con valor
-- por defecto; esta migración las deja en el esquema del repo.
-- No hay obra_id ni hora de fin: el lugar va en location y el fin, si se
-- indica, queda dentro de description.

alter table if exists public.agenda
  add column if not exists description text;

alter table if exists public.agenda
  add column if not exists location text;

alter table if exists public.agenda
  add column if not exists minutos_antelacion integer not null default 0;
