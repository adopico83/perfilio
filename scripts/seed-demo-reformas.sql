-- =============================================================================
-- Seed: tenant demo de REFORMAS (aislado de Pino)
-- =============================================================================
--
-- QUÉ HACE
--   Crea (o actualiza de forma idempotente) un negocio demo de reformas en
--   Errenteria, con 2 clientes inventados, 1 obra abierta y 1 presupuesto con
--   partidas. Todo cuelga de un usuario Auth DEDICADO.
--
-- POR QUÉ UN USUARIO AUTH NUEVO
--   getBusinessId* hace:
--     .from('business_profiles').eq('user_id', userId).limit(1)
--   RLS: filas por business_id cuyo business_profiles.user_id = auth.uid().
--   Un usuario Auth = un business_id. Meter este seed en la cuenta de Pino
--   mezclaría gremios o, peor, podría pisar el perfil. NO usar el user de Pino.
--
-- ANTES DE EJECUTAR
--   1. En Supabase Dashboard → Authentication → Users → Add user
--      Email sugerido: demo-reformas@perfilio.app
--      Password: la pones tú y la guardas FUERA del repo (1Password / DM).
--      Marca «Auto Confirm User».
--   2. Copia el UUID del usuario (columna User UID).
--   3. Pégalo SOLO en la constante demo_user_id de abajo.
--   4. SQL Editor (rol postgres: bypasea RLS; es el camino previsto).
--
-- NO CONTIENE PASSWORDS. No borra ni actualiza filas de otros negocios.
--
-- IDEMPOTENCIA
--   Reejecutar es seguro: si el user ya tiene el marcador [seed:demo-reformas],
--   actualiza perfil / business_users / clientes / obra / presupuesto demo.
--   Si el user ya tiene OTRO negocio (p. ej. Pino), ABORTA sin tocar nada.
--
-- SUPUESTOS DE SCHEMA (ver docs/demo-tenant-reformas.md)
--   - business_profiles: no hay CREATE TABLE en migraciones del repo; columnas
--     tomadas del SELECT del agente y de get-business-id.ts.
--   - presupuestos: tampoco hay CREATE TABLE; las partidas NO van en JSON ni
--     en tabla de líneas. Se guardan como texto en presupuesto_generado, con el
--     formato de generarTextoPresupuestoDesdeItems (lib/agente/modules/presupuestos.ts),
--     que parsePresupuestoGenerado (lib/pdf/parser.ts) entiende para el PDF.
-- =============================================================================

do $$
declare
  -- >>> SUSTITUYE este UUID por el del usuario Auth demo (Dashboard → Users) <<<
  demo_user_id          constant uuid := '00000000-0000-0000-0000-000000000000';

  seed_marker           constant text := '[seed:demo-reformas]';
  biz_nombre            constant text := 'Reformas Demo Errenteria';
  biz_sector            constant text := 'Reformas';
  cliente_a_nombre      constant text := 'Ainhoa Etxeberria';
  cliente_b_nombre      constant text := 'Iker Agirre';
  obra_nombre           constant text := 'Reforma piso';

  v_auth_email          text;
  v_existing_nombre     text;
  v_existing_contexto   text;
  v_business_id         uuid;
  v_cliente_a_id        uuid;
  v_cliente_b_id        uuid;
  v_obra_id             uuid;
  v_presupuesto_id      uuid;
  v_texto_presupuesto   text;
  v_base                numeric := 9755.00;
  v_iva                 numeric := 2048.55;
  v_total               numeric := 11803.55;
  v_bu_has_role         boolean := false;
begin
  if demo_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception
      'Placeholder demo_user_id sin sustituir. Crea el usuario Auth demo en el Dashboard, copia su UUID y pégalo en scripts/seed-demo-reformas.sql. NO uses la cuenta de Pino.';
  end if;

  select u.email
    into v_auth_email
  from auth.users u
  where u.id = demo_user_id;

  if v_auth_email is null then
    raise exception
      'No existe auth.users con id %. Crea primero el usuario en Authentication → Users (email sugerido: demo-reformas@perfilio.app) y vuelve a ejecutar.',
      demo_user_id;
  end if;

  -- Mismo criterio que getBusinessId*: primer (único) perfil de este user_id.
  select bp.id, bp.nombre, bp.contexto_adicional
    into v_business_id, v_existing_nombre, v_existing_contexto
  from public.business_profiles bp
  where bp.user_id = demo_user_id
  limit 1;

  if v_business_id is not null
     and coalesce(v_existing_contexto, '') not like '%' || seed_marker || '%' then
    raise exception
      'El user_id % ya tiene business_profiles «%» sin marcador %. No se toca (protección Pino / otros tenants). Usa un usuario Auth demo dedicado.',
      demo_user_id, coalesce(v_existing_nombre, '(sin nombre)'), seed_marker;
  end if;

  if v_existing_nombre is not null
     and (
       v_existing_nombre ilike '%pino%'
       or v_existing_nombre ilike '%aluminio%'
     ) then
    raise exception
      'Abortado: el perfil ligado a este user parece Pino/aluminio («%»). El demo de reformas debe vivir en otro usuario Auth.',
      v_existing_nombre;
  end if;

  -- Partidas en el formato que genera el agente y parsea el PDF.
  v_texto_presupuesto :=
    'PRESUPUESTO PARA ' || cliente_a_nombre || E'\n'
    || E'\n'
    || 'CAPÍTULO DEMOLICIÓN' || E'\n'
    || '1. Demolición de tabiquería y alicatados de baño y cocina | Cantidad: 25 | Precio: 35,00 € | Importe: 875,00 €' || E'\n'
    || 'TOTAL DEMOLICIÓN: 875,00 €' || E'\n'
    || 'CAPÍTULO FONTANERÍA' || E'\n'
    || '2. Renovación de fontanería de baño (sanitarios, desagües y tomas) | Cantidad: 1 | Precio: 1.850,00 € | Importe: 1.850,00 €' || E'\n'
    || 'TOTAL FONTANERÍA: 1.850,00 €' || E'\n'
    || 'CAPÍTULO ELECTRICIDAD' || E'\n'
    || '3. Cuadro eléctrico, puntos de luz y tomas en vivienda | Cantidad: 1 | Precio: 1.420,00 € | Importe: 1.420,00 €' || E'\n'
    || 'TOTAL ELECTRICIDAD: 1.420,00 €' || E'\n'
    || 'CAPÍTULO PINTURA' || E'\n'
    || '4. Pintura lisa de paredes y techos | Cantidad: 85 | Precio: 18,00 € | Importe: 1.530,00 €' || E'\n'
    || 'TOTAL PINTURA: 1.530,00 €' || E'\n'
    || 'CAPÍTULO COCINA Y ACABADOS' || E'\n'
    || '5. Mobiliario de cocina, encimera y zócalos | Cantidad: 1 | Precio: 3.800,00 € | Importe: 3.800,00 €' || E'\n'
    || 'TOTAL COCINA Y ACABADOS: 3.800,00 €' || E'\n'
    || 'CAPÍTULO LIMPIEZA' || E'\n'
    || '6. Limpieza final de obra | Cantidad: 1 | Precio: 280,00 € | Importe: 280,00 €' || E'\n'
    || 'TOTAL LIMPIEZA: 280,00 €' || E'\n'
    || 'BASE IMPONIBLE: 9.755,00 € | IVA (21%): 2.048,55 € | TOTAL: 11.803,55 €';

  if v_business_id is null then
    insert into public.business_profiles (
      user_id,
      nombre,
      sector,
      descripcion,
      servicios,
      tarifas,
      contexto_adicional,
      ciudad,
      direccion
    ) values (
      demo_user_id,
      biz_nombre,
      biz_sector,
      'Empresa de reformas integrales de vivienda en Errenteria. Demolición, fontanería, electricidad, pintura, cocinas y acabados. Datos 100 % inventados para demos comerciales (prospect Orbegozo). No es el taller de aluminio ni la cuenta de Pino.',
      'Reformas de pisos, baños y cocinas; demolición controlada; instalaciones; pintura; acabados; limpieza final de obra.',
      'Precios orientativos PV (sin compromiso): demolición tabiquería 30–40 €/m²; pintura lisa 16–20 €/m²; limpieza final de obra 250–350 €. Fontanería, electricidad y cocina se presupuestan por partida.',
      seed_marker || ' Tenant demo comercial de reformas. Clientes y obra ficticios. No mezclar con producción Pino.',
      'Errenteria',
      'Calle Beraun, 20100 Errenteria, Gipuzkoa'
    )
    returning id into v_business_id;
    raise notice 'business_profiles creado: %', v_business_id;
  else
    update public.business_profiles
    set
      nombre = biz_nombre,
      sector = biz_sector,
      descripcion = 'Empresa de reformas integrales de vivienda en Errenteria. Demolición, fontanería, electricidad, pintura, cocinas y acabados. Datos 100 % inventados para demos comerciales (prospect Orbegozo). No es el taller de aluminio ni la cuenta de Pino.',
      servicios = 'Reformas de pisos, baños y cocinas; demolición controlada; instalaciones; pintura; acabados; limpieza final de obra.',
      tarifas = 'Precios orientativos PV (sin compromiso): demolición tabiquería 30–40 €/m²; pintura lisa 16–20 €/m²; limpieza final de obra 250–350 €. Fontanería, electricidad y cocina se presupuestan por partida.',
      contexto_adicional = seed_marker || ' Tenant demo comercial de reformas. Clientes y obra ficticios. No mezclar con producción Pino.',
      ciudad = 'Errenteria',
      direccion = 'Calle Beraun, 20100 Errenteria, Gipuzkoa'
    where id = v_business_id
      and user_id = demo_user_id;
    raise notice 'business_profiles actualizado: %', v_business_id;
  end if;

  -- Membership: las API de clientes/obras/diario miran business_users ANTES
  -- que business_profiles. Sin esta fila, el header (getBusinessId* → perfiles)
  -- funciona y las rutas devuelven 403 «No tienes acceso a este negocio».
  -- La tabla NO está en supabase/migrations/; se inserta solo si existe.
  begin
    if to_regclass('public.business_users') is not null then
      select exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'business_users'
          and c.column_name = 'role'
      ) into v_bu_has_role;

      if not exists (
        select 1
        from public.business_users bu
        where bu.user_id = demo_user_id
          and bu.business_id = v_business_id
      ) then
        begin
          if v_bu_has_role then
            execute 'insert into public.business_users (business_id, user_id, role) values ($1, $2, $3)'
              using v_business_id, demo_user_id, 'owner';
          else
            execute 'insert into public.business_users (business_id, user_id) values ($1, $2)'
              using v_business_id, demo_user_id;
          end if;
          raise notice 'business_users creado: user % → business %', demo_user_id, v_business_id;
        exception
          when unique_violation then
            raise notice 'business_users ya existía (unique)';
          when others then
            begin
              execute 'insert into public.business_users (business_id, user_id) values ($1, $2)'
                using v_business_id, demo_user_id;
              raise notice 'business_users creado sin role: user % → business %', demo_user_id, v_business_id;
            exception
              when unique_violation then
                raise notice 'business_users ya existía';
              when others then
                raise notice
                  'No se insertó business_users (%). El helper de código cae a business_profiles tras desplegar el hotfix.',
                  SQLERRM;
            end;
        end;
      else
        raise notice 'business_users ya existía para este user+negocio';
      end if;
    else
      raise notice 'Tabla public.business_users no existe; acceso vía business_profiles';
    end if;
  exception
    when others then
      raise notice
        'business_users: no se pudo comprobar/insertar (%). No se aborta el seed (no se toca Pino).',
        SQLERRM;
  end;

  -- Cliente 1 (obra + presupuesto)
  select c.id
    into v_cliente_a_id
  from public.clientes c
  where c.business_id = v_business_id
    and c.nombre = cliente_a_nombre
  limit 1;

  if v_cliente_a_id is null then
    insert into public.clientes (
      business_id, nombre, telefono, email, direccion, nif, notas
    ) values (
      v_business_id,
      cliente_a_nombre,
      '600 11 11 11',
      'ainhoa.etxeberria@example.com',
      'Calle Beraun 14, 3º B, 20100 Errenteria',
      null,
      seed_marker || ' Cliente ficticio. Reforma de piso en Beraun.'
    )
    returning id into v_cliente_a_id;
    raise notice 'cliente creado: % (%)', cliente_a_nombre, v_cliente_a_id;
  else
    update public.clientes
    set
      telefono = '600 11 11 11',
      email = 'ainhoa.etxeberria@example.com',
      direccion = 'Calle Beraun 14, 3º B, 20100 Errenteria',
      notas = seed_marker || ' Cliente ficticio. Reforma de piso en Beraun.',
      updated_at = now()
    where id = v_cliente_a_id
      and business_id = v_business_id;
    raise notice 'cliente actualizado: % (%)', cliente_a_nombre, v_cliente_a_id;
  end if;

  -- Cliente 2 (ficha extra para el listado de la demo)
  select c.id
    into v_cliente_b_id
  from public.clientes c
  where c.business_id = v_business_id
    and c.nombre = cliente_b_nombre
  limit 1;

  if v_cliente_b_id is null then
    insert into public.clientes (
      business_id, nombre, telefono, email, direccion, nif, notas
    ) values (
      v_business_id,
      cliente_b_nombre,
      '600 22 22 22',
      'iker.agirre@example.com',
      'Avenida de Galtzaraborda 28, 1º A, 20100 Errenteria',
      null,
      seed_marker || ' Cliente ficticio. Sin obra abierta; sirve para mostrar el listado.'
    )
    returning id into v_cliente_b_id;
    raise notice 'cliente creado: % (%)', cliente_b_nombre, v_cliente_b_id;
  else
    update public.clientes
    set
      telefono = '600 22 22 22',
      email = 'iker.agirre@example.com',
      direccion = 'Avenida de Galtzaraborda 28, 1º A, 20100 Errenteria',
      notas = seed_marker || ' Cliente ficticio. Sin obra abierta; sirve para mostrar el listado.',
      updated_at = now()
    where id = v_cliente_b_id
      and business_id = v_business_id;
    raise notice 'cliente actualizado: % (%)', cliente_b_nombre, v_cliente_b_id;
  end if;

  -- Obra abierta vinculada a Ainhoa
  select o.id
    into v_obra_id
  from public.obras o
  where o.business_id = v_business_id
    and o.nombre = obra_nombre
  limit 1;

  if v_obra_id is null then
    insert into public.obras (
      business_id,
      cliente_id,
      nombre,
      direccion,
      estado,
      fecha_inicio,
      descripcion
    ) values (
      v_business_id,
      v_cliente_a_id,
      obra_nombre,
      'Calle Beraun 14, 3º B, 20100 Errenteria',
      'abierta',
      current_date - 7,
      seed_marker || ' Reforma integral de piso: baño, cocina, instalaciones y acabados. Datos inventados.'
    )
    returning id into v_obra_id;
    raise notice 'obra creada: % (%)', obra_nombre, v_obra_id;
  else
    update public.obras
    set
      cliente_id = v_cliente_a_id,
      direccion = 'Calle Beraun 14, 3º B, 20100 Errenteria',
      estado = 'abierta',
      descripcion = seed_marker || ' Reforma integral de piso: baño, cocina, instalaciones y acabados. Datos inventados.',
      updated_at = now()
    where id = v_obra_id
      and business_id = v_business_id;
    raise notice 'obra actualizada: % (%)', obra_nombre, v_obra_id;
  end if;

  -- Un presupuesto con partidas en presupuesto_generado (texto, no tabla de líneas)
  select p.id
    into v_presupuesto_id
  from public.presupuestos p
  where p.business_id = v_business_id
    and coalesce(p.mensaje_cliente, '') like '%' || seed_marker || '%'
  order by p.created_at asc
  limit 1;

  if v_presupuesto_id is null then
    insert into public.presupuestos (
      business_id,
      cliente_id,
      cliente_nombre,
      obra_id,
      fecha,
      estado,
      importe_total,
      numero_presupuesto,
      mensaje_cliente,
      presupuesto_generado,
      es_extra
    ) values (
      v_business_id,
      v_cliente_a_id,
      cliente_a_nombre,
      v_obra_id,
      current_date - 3,
      'pendiente',
      v_total,
      1,
      seed_marker || ' Reforma piso Errenteria — Pre 1/26',
      v_texto_presupuesto,
      false
    )
    returning id into v_presupuesto_id;
    raise notice 'presupuesto creado: % (total % €)', v_presupuesto_id, v_total;
  else
    update public.presupuestos
    set
      cliente_id = v_cliente_a_id,
      cliente_nombre = cliente_a_nombre,
      obra_id = v_obra_id,
      estado = 'pendiente',
      importe_total = v_total,
      numero_presupuesto = coalesce(numero_presupuesto, 1),
      mensaje_cliente = seed_marker || ' Reforma piso Errenteria — Pre 1/26',
      presupuesto_generado = v_texto_presupuesto,
      es_extra = false
    where id = v_presupuesto_id
      and business_id = v_business_id;
    raise notice 'presupuesto actualizado: % (total % €)', v_presupuesto_id, v_total;
  end if;

  -- Reuniones próximas para la card de calendario del shell demo.
  -- Solo columnas del CREATE TABLE de agenda; el resto tiene default en prod.
  -- Idempotente por título dentro de ESTE negocio (no toca otras agendas).
  if to_regclass('public.agenda') is not null then
    delete from public.agenda a
    where a.business_id = v_business_id
      and a.titulo in (
        'Visita de obra — Ainhoa Etxeberria',
        'Reunión de mediciones — Iker Agirre',
        'Revisión del presupuesto'
      );

    insert into public.agenda (business_id, titulo, fecha, hora, completado)
    values
      (
        v_business_id,
        'Visita de obra — Ainhoa Etxeberria',
        current_date + 1,
        '10:00',
        false
      ),
      (
        v_business_id,
        'Reunión de mediciones — Iker Agirre',
        current_date + 3,
        '17:30',
        false
      ),
      (
        v_business_id,
        'Revisión del presupuesto',
        current_date + 6,
        '09:30',
        false
      );
    raise notice 'agenda demo: 3 reuniones a partir de %', current_date;
  end if;

  raise notice '---';
  raise notice 'Seed demo reformas OK';
  raise notice 'Auth user: % (%)', demo_user_id, v_auth_email;
  raise notice 'business_id: %', v_business_id;
  raise notice 'business_users: membership user+negocio (si la tabla existe)';
  raise notice 'clientes: % / %', v_cliente_a_id, v_cliente_b_id;
  raise notice 'obra: %', v_obra_id;
  raise notice 'presupuesto: %  base=%  iva=%  total=%', v_presupuesto_id, v_base, v_iva, v_total;
  raise notice 'Login: /login con % (password fuera del repo) → /dashboard', v_auth_email;
end $$;
