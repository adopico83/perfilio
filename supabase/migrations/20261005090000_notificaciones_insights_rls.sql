-- Resumen diario + RLS de bicho_notifications y perfilio_insights.
--
-- Hasta ahora estas dos tablas no tenían migración en el repo y, según el estado real de la base,
-- podían estar abiertas a cualquier usuario autenticado (o incluso a anon). Esta migración:
--   1. Se asegura de que ambas tienen business_id (los avisos son por negocio).
--   2. Pasa los avisos antiguos que quedaron con business_id = 'pino' al UUID real del negocio
--      (si no, con RLS nadie los vería). Las filas con business_id NULL no se tocan.
--   3. Borra TODAS las policies que hubiera (desconocidas) y activa RLS.
--   4. Deja solo: el miembro/dueño del negocio puede LEER y ACTUALIZAR (marcar leído, feedback)
--      lo suyo. Insertar y borrar solo lo hace el servidor con la service role (que se salta RLS).
--   5. Añade un índice único para que el cron del resumen diario no duplique el aviso del día.
--
-- Compara business_id como texto a propósito: en estas tablas la columna puede ser uuid o text
-- según cómo se creara a mano, y así la policy vale en ambos casos.
--
-- Filas antiguas con business_id NULL (p. ej. las de src/lib/notify.ts) dejan de ser visibles
-- para los usuarios: nadie es dueño de ellas. El servidor sigue viéndolas.

-- 1. business_id -------------------------------------------------------------------------------
alter table public.bicho_notifications
  add column if not exists business_id uuid references public.business_profiles (id) on delete cascade;
alter table public.perfilio_insights
  add column if not exists business_id uuid references public.business_profiles (id) on delete cascade;

create index if not exists idx_bicho_notifications_business_created
  on public.bicho_notifications (business_id, created_at desc);
create index if not exists idx_perfilio_insights_business_created
  on public.perfilio_insights (business_id, created_at desc);

-- Un resumen diario por negocio y día (slug = resumen-diario-AAAA-MM-DD).
create unique index if not exists uq_bicho_notifications_resumen_diario
  on public.bicho_notifications (business_id, slug)
  where type = 'resumen_diario';

-- 1b. Backfill: 'pino' -> UUID del negocio -----------------------------------------------------
-- Antes de crear las policies. Se compara como texto porque, si la columna es uuid, 'pino' no
-- puede existir (y comparar uuid = 'pino' daría error de sintaxis); si es text, se reescribe.
update public.bicho_notifications
   set business_id = '8784450e-08a4-420a-8c37-d30bff8f0d39'
 where business_id::text = 'pino';
update public.perfilio_insights
   set business_id = '8784450e-08a4-420a-8c37-d30bff8f0d39'
 where business_id::text = 'pino';

-- 2. Función de pertenencia ---------------------------------------------------------------------
-- security definer: evita depender de las policies de business_profiles / business_users al
-- evaluar la policy (y la recursión). Solo responde sobre el usuario que hace la consulta.
create or replace function public.perfilio_user_in_business(p_business_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_business_id is not null
    and auth.uid() is not null
    and (
      exists (
        select 1 from public.business_profiles bp
        where bp.id::text = p_business_id and bp.user_id = auth.uid()
      )
      or exists (
        select 1 from public.business_users bu
        where bu.business_id::text = p_business_id and bu.user_id = auth.uid()
      )
    );
$$;

revoke all on function public.perfilio_user_in_business(text) from public;
grant execute on function public.perfilio_user_in_business(text) to authenticated, service_role;

-- 3. Policies ----------------------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['bicho_notifications', 'perfilio_insights'] loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select, update on table public.%I to authenticated', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.perfilio_user_in_business(business_id::text))',
      t || '_select_propio', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.perfilio_user_in_business(business_id::text)) with check (public.perfilio_user_in_business(business_id::text))',
      t || '_update_propio', t
    );
  end loop;
end
$$;
