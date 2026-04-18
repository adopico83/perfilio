-- Borradores conversacionales de presupuesto (por usuario y negocio)
create table if not exists public.presupuesto_borrador (
  id uuid primary key default gen_random_uuid (),
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  user_id uuid not null,
  cliente_nombre text,
  obra_id uuid references public.obras (id) on delete set null,
  cliente_id uuid references public.clientes (id) on delete set null,
  iva_porcentaje numeric(5, 2) not null default 21,
  estado text not null default 'en_construccion',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presupuesto_borrador_estado_chk check (
    estado in ('en_construccion', 'confirmado', 'cancelado')
  )
);

create unique index if not exists idx_presupuesto_borrador_unico_activo on public.presupuesto_borrador (business_id, user_id)
where
  estado = 'en_construccion';

create index if not exists idx_presupuesto_borrador_business_user on public.presupuesto_borrador (business_id, user_id, estado);

create table if not exists public.presupuesto_borrador_items (
  id uuid primary key default gen_random_uuid (),
  borrador_id uuid not null references public.presupuesto_borrador (id) on delete cascade,
  business_id uuid not null references public.business_profiles (id) on delete cascade,
  orden int not null,
  capitulo text,
  descripcion text not null,
  cantidad numeric(14, 4) not null,
  unidad text not null,
  precio_unitario numeric(14, 4) not null,
  importe numeric(14, 4) not null,
  raw_dictado text,
  created_at timestamptz not null default now()
);

create index if not exists idx_presupuesto_borrador_items_borrador on public.presupuesto_borrador_items (borrador_id, orden);

create index if not exists idx_presupuesto_borrador_items_business on public.presupuesto_borrador_items (business_id);

alter table public.presupuesto_borrador enable row level security;

alter table public.presupuesto_borrador_items enable row level security;

create policy "presupuesto_borrador_select_own"
  on public.presupuesto_borrador for select to authenticated using (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador.business_id
        and bp.user_id = auth.uid ()
    )
    and presupuesto_borrador.user_id = auth.uid ()
  );

create policy "presupuesto_borrador_insert_own"
  on public.presupuesto_borrador for insert to authenticated with check (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador.business_id
        and bp.user_id = auth.uid ()
    )
    and presupuesto_borrador.user_id = auth.uid ()
  );

create policy "presupuesto_borrador_update_own"
  on public.presupuesto_borrador for update to authenticated using (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador.business_id
        and bp.user_id = auth.uid ()
    )
    and presupuesto_borrador.user_id = auth.uid ()
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador.business_id
        and bp.user_id = auth.uid ()
    )
    and presupuesto_borrador.user_id = auth.uid ()
  );

create policy "presupuesto_borrador_items_select_own"
  on public.presupuesto_borrador_items for select to authenticated using (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador_items.business_id
        and bp.user_id = auth.uid ()
    )
    and exists (
      select 1
      from public.presupuesto_borrador pb
      where
        pb.id = presupuesto_borrador_items.borrador_id
        and pb.user_id = auth.uid ()
    )
  );

create policy "presupuesto_borrador_items_insert_own"
  on public.presupuesto_borrador_items for insert to authenticated with check (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador_items.business_id
        and bp.user_id = auth.uid ()
    )
    and exists (
      select 1
      from public.presupuesto_borrador pb
      where
        pb.id = presupuesto_borrador_items.borrador_id
        and pb.user_id = auth.uid ()
    )
  );

create policy "presupuesto_borrador_items_update_own"
  on public.presupuesto_borrador_items for update to authenticated using (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador_items.business_id
        and bp.user_id = auth.uid ()
    )
    and exists (
      select 1
      from public.presupuesto_borrador pb
      where
        pb.id = presupuesto_borrador_items.borrador_id
        and pb.user_id = auth.uid ()
    )
  )
  with check (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador_items.business_id
        and bp.user_id = auth.uid ()
    )
    and exists (
      select 1
      from public.presupuesto_borrador pb
      where
        pb.id = presupuesto_borrador_items.borrador_id
        and pb.user_id = auth.uid ()
    )
  );

create policy "presupuesto_borrador_items_delete_own"
  on public.presupuesto_borrador_items for delete to authenticated using (
    exists (
      select 1
      from public.business_profiles bp
      where
        bp.id = presupuesto_borrador_items.business_id
        and bp.user_id = auth.uid ()
    )
    and exists (
      select 1
      from public.presupuesto_borrador pb
      where
        pb.id = presupuesto_borrador_items.borrador_id
        and pb.user_id = auth.uid ()
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where
      pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'presupuesto_borrador_items'
  ) then
    alter publication supabase_realtime add table public.presupuesto_borrador_items;
  end if;
end $$;
