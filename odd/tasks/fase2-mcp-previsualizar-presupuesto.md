# Fase 2 MCP: previsualizar → confirmar presupuesto

## Objetivo
Ninguna vía MCP debe guardar importes calculados por el modelo. Grok sigue el flujo
previsualizar → enseñar al humano → confirmar.

## Rama
`fase2-mcp-previsualizar-presupuesto` (desde `main`, commit `0c67133`)

## Prohibido
No merge, no push de main, no aplicar migración, no tocar `.env*`, no commitear `public/sw.js`.
Al final: push de la rama + PR contra `main` (sin merge).

## TDD
Modo: ON (test primero, rojo observado, código mínimo, refactor). Runner: Jest 30 (`npm test`).

## Tareas

- [x] T1 — Dominio puro `lib/presupuestos/preview.ts`: `calcularPreviewPresupuesto`.
      Tests: `__tests__/presupuestos.preview.test.ts` (casos 1-6 del encargo: IVA 21%/10%,
      redondeo decimal, redondeo por línea antes de sumar, avisos importe/total_declarado,
      falta_precio → confirmable:false). Ruta: delegada (writer, 2 archivos no triviales).
- [x] T2 — Migración `supabase/migrations/20260927130000_presupuesto_previews.sql` (sin aplicar).
      Ruta: inline (1 archivo, mecánico una vez fijado el esquema). Escrita, pendiente de
      commit (se commitea después de T1 para respetar el orden dominio→migración).
- [x] T3+T4 (fusionadas) — Persistencia `guardarPreviewPresupuesto`/`confirmarPreviewPresupuesto`
      en `lib/presupuestos/preview.ts` + tools MCP `previsualizar_presupuesto`/
      `confirmar_presupuesto` en `lib/mcp/server.ts` + `lib/mcp/execute-tool.ts`. Se fusionan
      porque los tests obligatorios 7-12 del encargo están escritos en términos de las tools
      MCP (`__tests__/mcp.execute-tool.test.ts`, `__tests__/mcp.server.test.ts`), no de las
      funciones de persistencia aisladas — separarlas habría sido artificial.
      Ruta: delegada (writer, 4 archivos no triviales).
- [x] T5 — `crear_presupuesto`: acepta `capitulos`+`iva_porcentaje` (mismo camino
      preview→confirmar en una llamada); legacy con `descripcion` re-parseada por
      `parsePresupuestoGenerado` y recalculada (ignora `total`); legacy sin partidas
      parseables → `validacion` sin insertar. Test: caso 13. Ruta: delegada (writer).
- [x] T6 — Descripciones LLM de las 3 tools + actualizar línea de tools MCP en `README.md`.
      Ruta: inline.
- [x] T7 — Cierre: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`
      (revertir `public/sw.js` tras build), grep de que ningún camino MCP escribe
      `importe_total` desde un número del modelo. Push rama + PR (skill branch-pr).

## Evidencia de checks
- `npm test`: 47 suites, 280 tests, todo verde.
- `npm run lint`: 10 errores / 26 avisos, **preexistentes en `main`** (verificado con
  `git stash` antes de esta rama, mismo recuento exacto). Ninguno en los archivos
  tocados por esta feature. No corregidos, fuera de alcance.
- `npx tsc --noEmit`: sin salida, sin errores.
- `npm run build`: build de producción correcto. `public/sw.js` revertido tras el build.
- Grep `importe_total` en `lib/mcp/`: solo dos escrituras, ambas desde valores
  recalculados por el servidor (`confirmado.total` en `confirmar_presupuesto`/camino
  `capitulos` de `crear_presupuesto`, `recalculo.total` en el camino legacy). Ningún
  camino escribe un `total` del argumento del modelo directamente.

## Commits
- `5640541` feat(presupuestos): calcular preview de presupuesto sin persistir importes del modelo
- `2a877d3` feat(db): anadir migracion de presupuesto_previews (sin aplicar)
- `59b0ce0` feat(mcp): tools previsualizar_presupuesto y confirmar_presupuesto
- `11e847f` feat(mcp): crear_presupuesto acepta capitulos y recalcula el legacy
- `677ba7b` docs: actualizar tools MCP de presupuesto en README
- `9e87cb8` docs(odd): documento de tareas de la Fase 2 MCP previsualizar/confirmar

## Revisión PR #22 (correcciones)
- `8e96cf0` fix(db): RLS de presupuesto_previews via business_users y preview_id en presupuestos
  — quita insert/update/delete `authenticated` de `presupuesto_previews` (solo escribe
  el service role del MCP), deja solo un `select` basado en `business_users` (no
  `business_profiles.user_id`), políticas con `drop policy if exists`. Añade migración
  nueva `20260928090000_presupuestos_preview_id.sql` (columna `preview_id` + índice
  único parcial en `presupuestos`, sin aplicar).
- `8ec3940` fix(mcp): autorreparo de confirmacion atomica, IVA 0% y errores {ok,code}
  — `confirmarPreviewPresupuesto` se autorrepara si el insert tuvo éxito pero el
  marcado final falló (busca por `preview_id` en vez de reintentar el insert); el
  reclamo exige `expires_at > now`; `revertirAPendiente` y la relectura idempotente
  filtran por `business_id`; corrige IVA 0% legado que se convertía en 21%; errores
  del camino `capitulos` de `crear_presupuesto` usan `{ok:false, code}`;
  `previsualizar_presupuesto` exige `cliente_nombre` y lo trunca a 255.
- Verificación tras la revisión: `npm test` 47 suites/284 tests verde, `npx tsc --noEmit`
  limpio, `npm run build` verde (`sw.js` revertido).

## Choques con el código real
Ninguno bloqueante (ver verificación previa, memoria Engram
`project/roadmap-fase-2-no-mergeado-sin-ddl-base-de-business-profiles-presupuestos`).

## Limitaciones conocidas (para el PR)
- **Agrupación de capítulos con nombre repetido no contiguo**: si `capitulos` trae dos
  entradas separadas con el mismo `nombre` no contiguas entre sí (p. ej. `[COCINA, BAÑO,
  COCINA]`), `calcularPreviewPresupuesto` numera las partidas de salida en orden de
  entrada plano, mientras que `generarTextoCanonico` (y por tanto el texto guardado)
  las reagrupa por nombre de capítulo. En ese caso concreto la numeración mostrada en
  la previsualización podría no coincidir exactamente con la del texto final. No
  cubierto por los tests obligatorios del encargo; Grok no debería producir capítulos
  no contiguos en la práctica, pero se documenta como limitación conocida.
- La rama `en_curso` (reclamo atómico concurrente) no estaba en la lista de tests
  obligatoria del encargo; se añadió un test extra para cubrirla igualmente.
