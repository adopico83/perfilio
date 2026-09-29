# Fase 3 MCP: enlace PDF firmado + leer presupuestos

## Objetivo
1. Tool `obtener_enlace_pdf_presupuesto`: URL firmada y temporal (Supabase Storage, bucket
   privado `presupuestos-pdf`) al PDF oficial de un presupuesto confirmado del negocio.
2. Tools de solo lectura `ver_presupuestos` (listado con filtros) y `ver_presupuesto` (detalle).

## Rama
`fase3-enlace-pdf-y-leer-presupuestos` (desde `fase2-mcp-previsualizar-presupuesto`). PR contra `main`.

## Prohibido
No merge, no aplicar migraciones, no tocar `.env*`, no `supabase`/`vercel` CLI, no push a main.

## Decisiones (validadas por el usuario)
- El PDF no vive en Storage (se renderiza al vuelo en `/api/pdf/presupuesto/[id]`). Opción A:
  subir el PDF generado con el render oficial a `presupuestos-pdf/{business_id}/{presupuesto_id}.pdf`
  (upsert en cada llamada) y firmar con `createSignedUrl`.
- Bucket privado; políticas de `storage.objects` solo SELECT para `authenticated` por
  `business_users` sobre la carpeta `{business_id}`. Escritura solo con service role (MCP).
- «Confirmado» = `preview_id` no nulo o estado en enviado/aceptado/aprobado/facturado.
  `preview_id` solo lo escribe `confirmarPreviewPresupuesto` (ver nota en resumen).
- No se cambia el estado `borrador` que deja `confirmar_presupuesto` (pendiente).
- Caducidad por defecto 7 días, máximo 30; por encima se rechaza.

## TDD
Modo: ON. Runner: Jest 30 (`npm test`). Fuente: continuidad de la fase 2.

## Tareas
- [x] T1 — Extraer el render del PDF de la route a `lib/pdf/presupuesto-render.tsx` (sin cambio de
      comportamiento). Ruta: inline (refactor mecánico).
- [x] T2 — `ver_presupuestos` + `ver_presupuesto` (`lib/presupuestos/lectura.ts`, execute-tool, server,
      tests). Ruta: delegada (writer, >2 archivos no triviales).
- [x] T3 — `obtener_enlace_pdf_presupuesto` + migración del bucket (sin aplicar) + tests.
      Ruta: delegada (writer).
- [x] T4 — README, cierre: `npm test`, `npx tsc --noEmit`, `npm run build`, lint, PR.

## Evidencia de checks
- `npm test`: 49 suites, 345 tests, verde.
- `npx tsc --noEmit`: sin errores.
- `npm run build`: correcto (`public/sw.js` revertido tras el build).
- Lint: ver PR (10 errores/26 avisos preexistentes en main según fase 2).
- Route declarada: T1 inline; T2 y T3 delegadas (writer). Desvio T3: import dinamico del render
  (`@react-pdf/renderer` es ESM y rompe Jest si se importa estatico).
- Limite: las politicas de Storage no se pueden ejercitar en Jest; verificar tras aplicar migracion.

## Commits

- refactor(pdf) render compartido; feat(mcp) ver_presupuestos/ver_presupuesto; feat(mcp) obtener_enlace_pdf_presupuesto; feat(db) bucket presupuestos-pdf (sin aplicar)
