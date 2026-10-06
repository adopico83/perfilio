-- Ya aplicada en producción el 6/10/2026 (01:11 Madrid). Fichero espejo: NO volver a ejecutar.
-- Safety net: while bicho-daily-check edge may still write business_id='pino',
-- rewrite it to the real UUID before RLS makes those rows invisible.
create or replace function public.remap_pino_business_id()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.business_id is not null and new.business_id::text = 'pino' then
    new.business_id := '8784450e-08a4-420a-8c37-d30bff8f0d39';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_remap_pino_bicho_notifications on public.bicho_notifications;
create trigger trg_remap_pino_bicho_notifications
  before insert or update of business_id on public.bicho_notifications
  for each row execute function public.remap_pino_business_id();

drop trigger if exists trg_remap_pino_perfilio_insights on public.perfilio_insights;
create trigger trg_remap_pino_perfilio_insights
  before insert or update of business_id on public.perfilio_insights
  for each row execute function public.remap_pino_business_id();
