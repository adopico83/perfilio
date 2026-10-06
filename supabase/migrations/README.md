# Migraciones de Supabase: léeme antes de aplicar nada

## Dos «relojes» distintos

Cada migración tiene **dos fechas** que no coinciden:

1. **El nombre del fichero** en este repo (`20261006120000_facturas_presupuesto_id.sql`).
2. **La versión registrada en la base** (`supabase_migrations.schema_migrations`). Cuando una migración se aplica
   con el MCP (`apply_migration`) la base le pone la hora del momento, así que su versión es otra.

Por eso el repo tiene más ficheros (30 + los nuevos) que migraciones registradas en la base (15), y los
timestamps casi nunca son iguales.

## Equivalencias (fichero del repo → versión registrada en la base)

| Fichero del repo | Versión en la base |
|---|---|
| `20260924120000_business_profiles_emisor` | `20260924171040` |
| `20260927130000_presupuesto_previews` | `20260928092013` |
| `20260927221916_business_profiles_rls_propio` | `20260927221916` (coincide) |
| `20260928090000_presupuestos_preview_id` | `20260928092022` |
| `20260929100000_presupuestos_pdf_bucket` | `20260929205654` |
| `20260929110000_presupuestos_origen_confirmacion` | `20260929205703` |
| `20260930100000_presupuestos_numero_unico` | `20261001210105` |
| `20261005090000_notificaciones_insights_rls` | `20261005230909` |
| `20261005231124_remap_pino_business_id_trigger` | `20261005231124` (fichero espejo, ver abajo) |
| `20261005231333_revoke_anon_perfilio_user_in_business` | `20261005231333` (fichero espejo, ver abajo) |
| `20261006120000_facturas_presupuesto_id` | `20261006092158` |
| `20261006130000_business_profiles_marca` | `20261006092207` |
| `20261006140000_diario_obra_storage_por_negocio` | `20261006094637` |
| `20261007090000_presupuestos_rellenar_numero` | `20261006122327` |
| `20261007100000_business_profiles_resumen_push` | `20261006121927` |

## Ficheros «espejo»

`20261005231124_remap_pino_business_id_trigger.sql` y `20261005231333_revoke_anon_perfilio_user_in_business.sql`
**ya están aplicados** en producción (se hicieron directamente con el MCP). Se han copiado aquí con su SQL literal
solo para que el repo cuente toda la historia. **No se vuelven a ejecutar.**

## Ficheros antiguos que la base no tiene registrados (17)

Se aplicaron a mano antes de empezar a registrar migraciones. Sus efectos ya están en la base:

`20250315000000_conversation_history`, `20250316000000_lista_espera`, `20250321120000_agenda`,
`20250327200000_agenda_update_delete_policies`, `20250328220000_gastos`, `20250329120000_gastos_documentos`,
`20250329180000_diario_obra`, `20250330120000_clientes`, `20250331120000_presupuestos_extras`,
`20250331140000_tarifas_negocio`, `20260402000000_obras`, `20260402120000_obras_fecha_fin`,
`20260402140000_gastos_cliente_id`, `20260402150000_business_profiles_ubicacion`, `20260403000000_memoria_negocio`,
`20260418120000_presupuesto_borrador`, `20260923120000_agenda_cita_campos`.

Además hay tablas creadas a mano sin migración (`facturas`, `presupuestos`, `albaranes`, `business_users`,
`conversations`, `ai_responses`, `registros_jornada`, `operarios`, `push_subscriptions`, `gmail_tokens`…).

## La regla

- **NUNCA `supabase db push` contra producción**: intentaría volver a ejecutar ficheros ya aplicados.
  Solo se podría hacer después de un `supabase migration repair`, y eso lo decide Ander.
- Las migraciones se aplican **de una en una** (MCP `apply_migration` o el SQL editor de Supabase), después de revisarlas.
- Las migraciones nuevas deben poder ejecutarse dos veces sin fallar.
- Las que modifican o borran algo (`drop policy`, `update` de datos…) llevan en la primera línea
  `-- ⚠️ MIGRACIÓN NO ADITIVA: …` y se señalan en el PR.

## Pendientes de aplicar (PR «limpieza técnica + seguridad»)

En este orden:

1. `20261008090000_facturas_albaran_unico.sql` — aditiva (índice único de factura por albarán).
2. `20261008100000_storage_pdf_por_negocio.sql` — ⚠️ **NO ADITIVA** (cambia 2 policies de storage).
3. `20261008110000_conversaciones_por_negocio.sql` — ⚠️ **NO ADITIVA** (quita 3 policies abiertas).
4. `20261008120000_avisos_movil_por_negocio.sql` — aditiva (tabla `business_avisos_movil`, solo servidor).

Del PR anterior (#36) siguen las suyas si no se han aplicado: `20261007090000` (NO aditiva) y `20261007100000`.

## Esquema de referencia

`supabase/schema-referencia.sql` es **solo documentación** (cabecera «NO EJECUTAR NUNCA») y está **pendiente**
de rellenar con el volcado del esquema real. No se reconstruye a partir de las migraciones porque no reflejan
las tablas creadas a mano.
