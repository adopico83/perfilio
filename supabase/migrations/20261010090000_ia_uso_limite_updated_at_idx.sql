-- Índice para el borrado de filas viejas de ia_registrar_uso().
--
-- La función hace `delete from public.ia_uso_limite where updated_at < now() - interval '2 days'` en cada
-- llamada. Sin índice recorre la tabla entera (solo existe la clave primaria). Con este índice basta mirar
-- las filas más antiguas. Aditiva y re-ejecutable (`if not exists`).
create index if not exists ia_uso_limite_updated_at_idx
  on public.ia_uso_limite (updated_at);
