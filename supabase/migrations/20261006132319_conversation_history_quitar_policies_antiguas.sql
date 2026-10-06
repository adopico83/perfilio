-- Ya aplicada en producción el 6/10/2026 (15:23 Madrid). Fichero espejo: NO volver a ejecutar.
-- ⚠️ MIGRACIÓN NO ADITIVA: borra las 2 policies antiguas de conversation_history (las sustituyen las de 20261008110000_conversaciones_por_negocio).
-- Con OK de Ander (6/10/2026): las policies por negocio ya cubren select/insert/delete.
drop policy if exists "usuarios insertan su historial" on public.conversation_history;
drop policy if exists "usuarios ven su historial" on public.conversation_history;
