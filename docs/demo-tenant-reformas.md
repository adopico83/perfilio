# Tenant demo de reformas (Orbegozo / demos comerciales)

Seed + cuenta Auth **aparte de Pino**. Objetivo: demo de ~5 minutos (clientes → obra → presupuesto con partidas de reforma) sin mezclar gremios ni datos reales.

## Diseño (por qué no va en la cuenta de Pino)

En código, un usuario Auth resuelve **un** negocio:

```ts
// lib/supabase/get-business-id.ts
.from('business_profiles').select('id').eq('user_id', userId).limit(1)
```

RLS de clientes, obras, presupuestos, etc. es del estilo:

```sql
EXISTS (
  SELECT 1 FROM business_profiles bp
  WHERE bp.id = <tabla>.business_id
    AND bp.user_id = auth.uid()
)
```

Consecuencia: el tenant demo **tiene que ser otro usuario Auth**. Si se inserta en el `user_id` de Pino, `getBusinessId*` devolvería el mismo `business_id` (o el primero) y la demo vería (o pisaría) el taller de aluminio.

| | Pino (producción) | Demo reformas |
|---|---|---|
| Usuario Auth | el de siempre | **nuevo**, dedicado |
| Email | el de Pino | `demo-reformas@perfilio.app` (sugerido) |
| `business_profiles.nombre` | negocio real | `Reformas Demo Errenteria` |
| Sector | aluminio / Pino | `Reformas` |
| Ciudad | (la de Pino) | Errenteria |
| Datos | reales — **no tocar** | inventados |

El seed **no borra** filas. Si el UUID que pegas ya tiene un perfil sin el marcador `[seed:demo-reformas]` (p. ej. Pino), el script **aborta**.

## Credenciales (fuera del repo)

El PR **no** incluye contraseñas.

1. Ander / El bicho crean el usuario en Supabase Auth.
2. La password se guarda en **1Password** o se pasa por **DM**. Nunca en git, issues ni el SQL.
3. Este documento solo fija el **email** sugerido.

## 1. Crear el usuario Auth (prod Supabase)

1. [Supabase Dashboard](https://supabase.com/dashboard) → proyecto de **producción** Perfilio.
2. **Authentication** → **Users** → **Add user**.
3. Email: `demo-reformas@perfilio.app` (u otro acordado; anótalo).
4. Password: la que vayáis a usar en la demo. Guardadla fuera del repo.
5. Marcad **Auto Confirm User** (si no, `/login` fallará hasta confirmar el correo).
6. Copiad el **User UID** (UUID). Ese valor es `demo_user_id`.

No hace falta registro público ni tocar `app/login`. Entrada: `/login` con email + password.

## 2. Ejecutar el seed

Archivo: [`scripts/seed-demo-reformas.sql`](../scripts/seed-demo-reformas.sql).

1. Abrid el SQL en el editor. En la constante `demo_user_id` (ahora `00000000-0000-0000-0000-000000000000`) pegad el UUID del paso anterior.
2. Dashboard → **SQL Editor** → New query → pegad el script → Run.
3. En Notices deberíais ver `Seed demo reformas OK` y los ids (`business_id`, clientes, obra, presupuesto).

El SQL Editor corre con privilegios de postgres y **bypasea RLS**. Es el camino previsto: el seed escribe en el `business_id` del user demo, no en el de Pino.

Reejecutar es idempotente sobre **ese** tenant (actualiza perfil, membership `business_users` si aplica, los 2 clientes, la obra y el presupuesto marcados).

Si olvidáis sustituir el UUID, el script falla a propósito. Si el user no existe en `auth.users`, también.

## Incidente prod (hotfix PR #5)

**Síntoma (Ander / El bicho):** login con `demo-reformas@perfilio.app` (UUID `c848c42d-cd40-48c3-a07b-35e06e844e5b`) OK; cabecera «Reformas Demo Errenteria»; **Clientes / Obras** «No tienes acceso a este negocio»; **Presupuestos** vacío.

**Causa:** `getBusinessId*` solo lee `business_profiles` → el header acierta. Las API (`app/api/clientes/route.ts` y clones) tenían un `assertUserOwnsBusiness` local que, si el cliente de Supabase exponía `business_users.select` (siempre en prod), **devolvía false sin mirar el perfil**. El seed original no insertaba `business_users`. El agente ya hacía el fallback correcto (`assertUserCanAccessBusiness`).

**Fix de código:** helper compartido [`lib/supabase/assert-user-owns-business.ts`](../lib/supabase/assert-user-owns-business.ts):

1. `business_users` con fila → true.
2. Si no hay fila, error, o la tabla no está en el mock → `business_profiles` (`id` + `user_id`).

Las rutas API (clientes, obras, diario, gastos, operarios, push, PDF, presupuestos auxiliares) y el agente importan ese helper. Sin ifs extra en `app/api/agente/route.ts`.

**Fix de datos (prod, ahora):** [`scripts/fix-demo-reformas-access.sql`](../scripts/fix-demo-reformas-access.sql). Pegar en SQL Editor. Solo toca el perfil con marcador `[seed:demo-reformas]` de ese UUID; **no toca Pino**.

Tras el correctivo, recargar `/clientes` y `/obras` (sin cache). Presupuestos lista por RLS cliente; si prod filtra por membership, la fila de `business_users` también desbloquea el listado.

El seed [`scripts/seed-demo-reformas.sql`](../scripts/seed-demo-reformas.sql) ahora inserta `business_users` si la tabla existe (idempotente).

## 3. Entrar a la demo

1. Producción: [perfilio.vercel.app/login](https://perfilio.vercel.app/login) (o el preview del PR, si aplica).
2. Email del user demo + password de 1Password/DM. **No** la cuenta de Pino.
3. Tras login, redirección a `/dashboard`.
4. Cabecera / perfil: **Reformas Demo Errenteria**, no branding Pino ni `EMPRESA_PINO`.

Si el dashboard sale vacío, el UUID del seed no coincide con el user con el que habéis entrado, o el seed no se ha ejecutado.

Si la cabecera muestra el negocio demo pero clientes/obras dicen «No tienes acceso a este negocio», es el fallo de `assertUserOwnsBusiness` / `business_users` (sección **Incidente prod**). No reejecutéis el seed contra Pino.

## 4. Checklist demo 5 min (prospect Orbegozo)

Orden de producto: **Hoy → obra → presupuesto** (shell con nav izquierda).

1. **Login** con `demo-reformas@perfilio.app` (no Pino).
2. **Shell**: barra lateral izquierda con Dashboard / Clientes / Obras / Presupuestos / Agente IA. Top bar mínima (nombre del negocio + salir). El agente **no** ocupa la derecha hasta pulsar Agente IA.
3. **Hoy** (`/dashboard`): tres cards — clientes, obra en curso («Reforma piso»), presupuesto pendiente — y un CTA **Presupuesto de esta obra**. Sin métricas, urgentes, Gmail ni TicketBAI.
4. **Clientes** (`/clientes`):
   - Ainhoa Etxeberria (obra + presupuesto).
   - Iker Agirre (solo ficha, para que el listado no quede en uno).
   - Nombres vascos genéricos, teléfonos/emails `@example.com` inventados.
4. **Obras** (`/obras` o ficha desde Hoy): «Reforma piso», estado **abierta**, dirección en Errenteria, cliente Ainhoa. Chips del agente: «Añade partida», «Envía presupuesto» (rellenan el chat; no densifican `app/api/agente/route.ts`).
5. **Presupuestos** (`/presupuestos`): abrir el de Ainhoa (CTA de Hoy o `?id=`). Partidas:
   - Demolición (tabiquería / alicatados)
   - Fontanería (baño)
   - Electricidad (cuadro y puntos)
   - Pintura
   - Cocina y acabados
   - Limpieza final
   - Totales: base 9.755,00 € + IVA 21 % 2.048,55 € = **11.803,55 €** (PV orientativo).
   - Mismos chips de agente en el modal.
6. Opcional, agente: «lista mis clientes», «enséñame la obra Reforma piso», «presupuesto de Ainhoa». El sector del perfil es reformas, no aluminio.

No hace falta TicketBAI, visor 3D ni crear documentos nuevos en la demo corta. El presupuesto ya está en estado `pendiente` para poder mostrarlo (y, si apetece, marcarlo aceptado).

## Qué inserta el seed

| Tabla | Filas | Notas |
|---|---|---|
| `business_profiles` | 1 | `user_id` = demo Auth; `ciudad` Errenteria; marcador `[seed:demo-reformas]` |
| `business_users` | 0 o 1 | Membership `demo_user_id` + `business_id` **si la tabla existe** (no está en `supabase/migrations/`). Sin ella, las API devolvían 403. |
| `clientes` | 2 | Ainhoa Etxeberria, Iker Agirre |
| `obras` | 1 | «Reforma piso», `estado = abierta`, `cliente_id` = Ainhoa |
| `presupuestos` | 1 | `obra_id` + `cliente_id`; partidas en `presupuesto_generado` |

No inserta facturas, albaranes, gastos, diario, tarifas de tabla `tarifas`, ni `presupuesto_borrador`. No escribe en el negocio de Pino.

## Supuestos de schema (bloqueo declarado)

**`presupuestos` y `business_profiles` no tienen `CREATE TABLE` en `supabase/migrations/`.** El seed usa solo columnas que aparecen en migraciones posteriores o en inserts/selects del código actual.

### `business_profiles` (inferido)

Usadas en `app/api/agente/route.ts`, `get-business-id.ts` y `app/api/pdf/presupuesto/[id]/route.tsx`:

`id`, `user_id`, `nombre`, `sector`, `descripcion`, `servicios`, `tarifas` (texto de perfil, no la tabla `tarifas`), `contexto_adicional`, `ciudad`, `direccion`. `logo_url` no se rellena (evita branding Pino).

`ciudad` / `direccion`: migración `20260402150000_business_profiles_ubicacion.sql`.

### `business_users` (prod, no está en migraciones del repo)

El cliente de Supabase en las API hace `.from('business_users').select('business_id').eq('business_id', …).eq('user_id', …)`. Columnas usadas: `business_id`, `user_id`. Si existe `role`, el seed/correctivo insertan `'owner'`. El helper **no** exige esta tabla: sin fila o con error cae a `business_profiles`.

### `clientes` / `obras` (migraciones)

- `clientes`: `20250330120000_clientes.sql` — `business_id`, `nombre`, `telefono`, `email`, `direccion`, `nif`, `notas`.
- `obras`: `20260402000000_obras.sql` + `fecha_fin` en `20260402120000_obras_fecha_fin.sql` — `estado` default `'abierta'` (también `en_curso`, `pausada`, `cerrada` en la API).

### `presupuestos` (inferido del código)

No hay tabla `presupuesto_lineas` ni JSON de partidas en el insert de producción. El agente guarda:

| Columna | Origen en código |
|---|---|
| `business_id` | todos los inserts |
| `presupuesto_generado` | texto de partidas (`documentos.ts`, `presupuestos.ts`) |
| `mensaje_cliente` | idem |
| `fecha`, `estado` | `borrador` / `pendiente` / `aceptado`… |
| `importe_total` | total con IVA en el flujo de dictado / borrador |
| `cliente_nombre`, `cliente_id` | `20250330120000_clientes.sql` añade `cliente_id` |
| `obra_id` | `20260402000000_obras.sql` |
| `numero_presupuesto` | insert al confirmar borrador conversacional |
| `es_extra`, `parent_id` | `20250331120000_presupuestos_extras.sql` |

Formato de `presupuesto_generado` alineado con `generarTextoPresupuestoDesdeItems` y `parsePresupuestoGenerado`:

```
CAPÍTULO DEMOLICIÓN
1. … | Cantidad: 25 | Precio: 35,00 € | Importe: 875,00 €
TOTAL DEMOLICIÓN: 875,00 €
…
BASE IMPONIBLE: 9.755,00 € | IVA (21%): 2.048,55 € | TOTAL: 11.803,55 €
```

`presupuesto_borrador` / `presupuesto_borrador_items` (`20260418120000_presupuesto_borrador.sql`) son el canvas conversacional. **No** se seedan: la demo enseña un presupuesto ya listado.

Si en prod faltara alguna columna opcional (`numero_presupuesto`, `es_extra`), comentadla en el `INSERT`/`UPDATE` del seed y reejecutad.

## Advertencias

- **No entrar con la cuenta de Pino** en una demo de reformas. El aislamiento es por usuario Auth, no por “modo demo” en la UI.
- No reutilicéis el UUID de Pino en `demo_user_id`.
- Clientes y direcciones son ficticios; no sustituir por datos reales del prospecto sin acuerdo.
- Este cambio no añade features, TicketBAI ni 3D. El agente solo **reutiliza** el helper de acceso (misma lógica que ya tenía); no se densifica `route.ts` con ifs de demo.
- **No** borrar ni migrar datos de Pino. El seed y el correctivo abortan si el UUID no es el tenant demo.
