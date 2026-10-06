-- Clave de Pushover de cada negocio, en una tabla APARTE y solo para el servidor.
--
-- Por qué aparte: en business_profiles los grants son de tabla (anon y authenticated tienen SELECT
-- sobre todas las columnas), así que una columna nueva allí sería legible desde el navegador por
-- cualquier miembro del negocio. Esta tabla tiene RLS activada y NINGUNA policy, y se le quitan los
-- permisos a anon y authenticated: solo la service role (que se salta RLS) la lee y la escribe.
--
-- Aditiva: crea una tabla nueva. El `revoke` sobre una tabla recién creada no quita nada que
-- existiera antes (se hace para que no herede los permisos por defecto del esquema public).
-- Re-ejecutable.

create table if not exists public.business_avisos_movil (
  business_id uuid primary key references public.business_profiles (id) on delete cascade,
  pushover_user_key text check (pushover_user_key is null or pushover_user_key ~ '^[A-Za-z0-9]{30}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.business_avisos_movil enable row level security;
-- Sin policies a propósito: solo la service role (que se salta RLS) lee y escribe.
revoke all on table public.business_avisos_movil from anon, authenticated;

comment on table public.business_avisos_movil is
  'Clave de usuario de Pushover por negocio. Solo servidor (service role): sin policies.';
