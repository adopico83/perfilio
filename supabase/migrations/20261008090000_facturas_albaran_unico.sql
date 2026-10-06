-- Una factura como máximo por albarán (igual que uq_facturas_presupuesto_id para presupuestos).
-- Aditiva: solo crea un índice si no existe. Los albaranes sin factura y las facturas sin albarán
-- (albaran_id NULL) no cuentan. Hoy no hay facturas, así que no puede fallar por duplicados.
create unique index if not exists uq_facturas_albaran_id
  on public.facturas (albaran_id)
  where albaran_id is not null;
