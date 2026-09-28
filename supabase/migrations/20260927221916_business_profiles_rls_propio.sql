drop policy if exists "Acceso autenticado business_profiles" on public.business_profiles;
drop policy if exists business_profiles_select_propio on public.business_profiles;
drop policy if exists business_profiles_insert_propio on public.business_profiles;
drop policy if exists business_profiles_update_propio on public.business_profiles;
drop policy if exists business_profiles_delete_propio on public.business_profiles;

create policy business_profiles_select_propio on public.business_profiles
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.business_users bu where bu.business_id = business_profiles.id and bu.user_id = auth.uid()));

create policy business_profiles_insert_propio on public.business_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy business_profiles_update_propio on public.business_profiles
  for update to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.business_users bu where bu.business_id = business_profiles.id and bu.user_id = auth.uid()))
  with check (user_id = auth.uid() or exists (select 1 from public.business_users bu where bu.business_id = business_profiles.id and bu.user_id = auth.uid()));

create policy business_profiles_delete_propio on public.business_profiles
  for delete to authenticated
  using (user_id = auth.uid());
