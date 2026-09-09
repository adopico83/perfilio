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

Reejecutar es idempotente sobre **ese** tenant (actualiza perfil, los 2 clientes, la obra y el presupuesto marcados).

Si olvidáis sustituir el UUID, el script falla a propósito. Si el user no existe en `auth.users`, también.

## 3. Entrar a la demo

1. Producción: [perfilio.vercel.app/login](https://perfilio.vercel.app/login) (o el preview del PR, si aplica).
2. Email del user demo + password de 1Password/DM. **No** la cuenta de Pino.
3. Tras login, redirección a `/dashboard`.
4. Cabecera / perfil: **Reformas Demo Errenteria**, no branding Pino ni `EMPRESA_PINO`.

Si el dashboard sale vacío, el UUID del seed no coincide con el user con el que habéis entrado, o el seed no se ha ejecutado.

## 4. Checklist demo 5 min (prospect Orbegozo)

Orden de producto: **cliente → obra → presupuesto**.

1. **Login** con `demo-reformas@perfilio.app` (no Pino).
2. **Dashboard**: negocio «Reformas Demo Errenteria»; aparece 1 obra activa y el presupuesto reciente.
3. **Clientes** (`/clientes`):
   - Ainhoa Etxeberria (obra + presupuesto).
   - Iker Agirre (solo ficha, para que el listado no quede en uno).
   - Nombres vascos genéricos, teléfonos/emails `@example.com` inventados.
4. **Obras** (`/obras`): «Reforma piso», estado **abierta**, dirección en Errenteria, cliente Ainhoa.
5. **Presupuestos** (`/presupuestos`): abrir el de Ainhoa. Partidas:
   - Demolición (tabiquería / alicatados)
   - Fontanería (baño)
   - Electricidad (cuadro y puntos)
   - Pintura
   - Cocina y acabados
   - Limpieza final
   - Totales: base 9.755,00 € + IVA 21 % 2.048,55 € = **11.803,55 €** (PV orientativo).
6. Opcional, agente: «lista mis clientes», « enséñame la obra Reforma piso», «presupuesto de Ainhoa». El sector del perfil es reformas, no aluminio.

No hace falta TicketBAI, visor 3D ni crear documentos nuevos en la demo corta. El presupuesto ya está en estado `pendiente` para poder mostrarlo (y, si apetece, marcarlo aceptado).

## Qué inserta el seed

| Tabla | Filas | Notas |
|---|---|---|
| `business_profiles` | 1 | `user_id` = demo Auth; `ciudad` Errenteria; marcador `[seed:demo-reformas]` |
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
- Este cambio no añade features, TicketBAI, 3D ni lógica en `app/api/agente/route.ts`.
