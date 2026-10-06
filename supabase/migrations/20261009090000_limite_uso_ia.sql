-- Límite de uso de la IA (/api/assistant y /api/classify) por usuario y negocio.
--
-- Por qué: esas rutas solo exigían sesión, así que cualquier usuario podía llamarlas sin límite y
-- gastar OpenAI. Un contador en memoria no sirve en Vercel (cada petición puede caer en otra
-- instancia y las instancias se reinician), así que el contador vive aquí, en la base.
--
-- Qué crea (todo nuevo, aditiva y re-ejecutable):
--  * Tabla ia_uso_limite: un contador por (usuario, negocio, ventana, periodo). Ventana 'min' (cada
--    minuto) o 'dia' (cada día de Madrid). RLS activada SIN policies y sin permisos para
--    anon/authenticated: solo la service role (que se salta RLS) la usa.
--  * Función ia_registrar_uso(): suma 1 al contador y dice si se permite. Es ATÓMICA: usa
--    insert … on conflict do update … returning, que bloquea la fila, así que dos peticiones a la
--    vez no se cuelan. Solo la puede ejecutar service_role. De paso borra las filas de más de 2 días.

create table if not exists public.ia_uso_limite (
  user_id uuid not null,
  business_id text not null default '',  -- '' = el usuario no tiene negocio propio
  ventana text not null check (ventana in ('min', 'dia')),
  periodo text not null,                 -- minuto (AAAA-MM-DDTHH:MM) o día de Madrid (AAAA-MM-DD)
  contador integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, business_id, ventana, periodo)
);

alter table public.ia_uso_limite enable row level security;
-- Sin policies a propósito: solo la service role lee y escribe.
revoke all on table public.ia_uso_limite from anon, authenticated;
grant select, insert, update, delete on table public.ia_uso_limite to service_role;

create or replace function public.ia_registrar_uso(
  p_user uuid,
  p_business text,
  p_minuto text,
  p_dia text,
  p_max_minuto integer,
  p_max_dia integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  n_min integer;
  n_dia integer;
begin
  -- Limpieza: la tabla no crece sin parar.
  delete from public.ia_uso_limite where updated_at < now() - interval '2 days';

  insert into public.ia_uso_limite as t (user_id, business_id, ventana, periodo, contador)
  values (p_user, coalesce(p_business, ''), 'min', p_minuto, 1)
  on conflict (user_id, business_id, ventana, periodo)
  do update set contador = t.contador + 1, updated_at = now()
  returning t.contador into n_min;

  if n_min > p_max_minuto then
    return jsonb_build_object('permitido', false, 'motivo', 'minuto', 'usado', n_min);
  end if;

  insert into public.ia_uso_limite as t (user_id, business_id, ventana, periodo, contador)
  values (p_user, coalesce(p_business, ''), 'dia', p_dia, 1)
  on conflict (user_id, business_id, ventana, periodo)
  do update set contador = t.contador + 1, updated_at = now()
  returning t.contador into n_dia;

  if n_dia > p_max_dia then
    return jsonb_build_object('permitido', false, 'motivo', 'dia', 'usado', n_dia);
  end if;

  return jsonb_build_object('permitido', true, 'usado_minuto', n_min, 'usado_dia', n_dia);
end;
$$;

revoke all on function public.ia_registrar_uso(uuid, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ia_registrar_uso(uuid, text, text, text, integer, integer) to service_role;
