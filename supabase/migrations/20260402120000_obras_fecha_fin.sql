alter table if exists public.obras
  add column if not exists fecha_fin date;
