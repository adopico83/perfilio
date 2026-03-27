-- Permitir actualizar y eliminar agenda solo del negocio del usuario autenticado
create policy "agenda_update_own_business"
  on public.agenda
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = agenda.business_id
        and bp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = agenda.business_id
        and bp.user_id = auth.uid()
    )
  );

create policy "agenda_delete_own_business"
  on public.agenda
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.business_profiles bp
      where bp.id = agenda.business_id
        and bp.user_id = auth.uid()
    )
  );
