-- Un mismo negocio no puede repetir numero_presupuesto (los NULL quedan fuera del índice).
create unique index if not exists presupuestos_business_numero_unico
  on public.presupuestos (business_id, numero_presupuesto)
  where numero_presupuesto is not null;
