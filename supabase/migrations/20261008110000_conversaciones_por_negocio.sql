-- ⚠️ MIGRACIÓN NO ADITIVA: borra 3 policies abiertas de conversation_history, conversations y ai_responses. Revisar antes de aplicar.
--
-- Problema: cada una de esas tablas tiene una policy permisiva FOR ALL con `using (auth.uid() is not null)`
-- ("Acceso autenticado …"). Las policies permisivas se suman con OR, así que CUALQUIER usuario con
-- sesión, de cualquier negocio, podía leer, modificar y borrar todo con la anon key (en
-- conversation_history están las 365 conversaciones del agente de Pino). Las policies por
-- business_users que ya existen no servían de nada mientras estuviera la abierta.
--
-- Arreglo: policies por negocio con perfilio_user_in_business() y fuera las abiertas. Primero se crean
-- las nuevas y luego se borran las viejas. Re-ejecutable (drop policy if exists antes de cada create).
-- No se borran las dos policies por business_users que ya tenía conversation_history.
-- Puede que el arreglo urgente de la policy abierta ya se haya aplicado a mano: no pasa nada.

do $$
begin
  if to_regprocedure('public.perfilio_user_in_business(text)') is null then
    raise exception 'Falta public.perfilio_user_in_business(text): aplica antes 20261005090000_notificaciones_insights_rls.sql';
  end if;
end
$$;

-- conversation_history: leer e insertar lo del negocio; borrar solo lo propio (botón de borrar del panel).
drop policy if exists "conversation_history_select_negocio" on public.conversation_history;
create policy "conversation_history_select_negocio"
  on public.conversation_history
  for select
  to authenticated
  using (public.perfilio_user_in_business(business_id::text));

drop policy if exists "conversation_history_insert_negocio" on public.conversation_history;
create policy "conversation_history_insert_negocio"
  on public.conversation_history
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.perfilio_user_in_business(business_id::text));

drop policy if exists "conversation_history_delete_propio" on public.conversation_history;
create policy "conversation_history_delete_propio"
  on public.conversation_history
  for delete
  to authenticated
  using (user_id = auth.uid() and public.perfilio_user_in_business(business_id::text));

drop policy if exists "Acceso autenticado conversation_history" on public.conversation_history;

-- conversations (flujo antiguo de /mensajes).
drop policy if exists "conversations_negocio" on public.conversations;
create policy "conversations_negocio"
  on public.conversations
  for all
  to authenticated
  using (public.perfilio_user_in_business(business_id::text))
  with check (public.perfilio_user_in_business(business_id::text));

drop policy if exists "Acceso autenticado conversations" on public.conversations;

-- ai_responses: pertenece al negocio de su conversación.
drop policy if exists "ai_responses_negocio" on public.ai_responses;
create policy "ai_responses_negocio"
  on public.ai_responses
  for all
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = ai_responses.conversation_id
        and public.perfilio_user_in_business(c.business_id::text)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = ai_responses.conversation_id
        and public.perfilio_user_in_business(c.business_id::text)
    )
  );

drop policy if exists "Acceso autenticado ai_responses" on public.ai_responses;
