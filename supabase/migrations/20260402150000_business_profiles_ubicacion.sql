-- Ubicación del negocio (meteorología, contexto del agente)
alter table if exists public.business_profiles
  add column if not exists ciudad text,
  add column if not exists direccion text;
