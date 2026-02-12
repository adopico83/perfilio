# Esquema de base de datos – Perfilio

Documentación de tablas para el proyecto Supabase.

---

## Tabla: `materiales`

Almacena materiales/productos para presupuestos y control de stock.

| Columna           | Tipo         | Restricciones     | Descripción              |
|-------------------|--------------|-------------------|--------------------------|
| id                | uuid         | PK, default gen_random_uuid() | Identificador único |
| nombre            | text         | NOT NULL          | Nombre del material      |
| unidad            | text         | NOT NULL          | Unidad (m, m², u, kg…)   |
| precio_unitario   | decimal(12,2)| NOT NULL          | Precio por unidad        |
| stock_actual      | integer      | default 0         | Cantidad en stock        |
| created_at        | timestamptz  | default now()     | Fecha de creación        |
| updated_at        | timestamptz  | default now()     | Última actualización      |

---

## Tabla: `clientes`

Datos de clientes para presupuestos y facturas.

| Columna    | Tipo        | Restricciones     | Descripción        |
|------------|-------------|-------------------|--------------------|
| id         | uuid        | PK, default gen_random_uuid() | Identificador único |
| nombre     | text        | NOT NULL          | Nombre o razón social |
| email      | text        |                   | Email de contacto  |
| telefono   | text        |                   | Teléfono           |
| direccion  | text        |                   | Dirección fiscal   |
| created_at | timestamptz | default now()     | Fecha de creación  |
| updated_at | timestamptz | default now()     | Última actualización |

---

## Tabla: `presupuestos`

Cabecera de presupuestos vinculados a clientes.

| Columna      | Tipo         | Restricciones     | Descripción                    |
|--------------|--------------|-------------------|--------------------------------|
| id           | uuid         | PK, default gen_random_uuid() | Identificador único     |
| cliente_id   | uuid         | FK → clientes(id), NOT NULL | Cliente asociado    |
| estado       | text         | NOT NULL          | borrador, enviado, aceptado, rechazado |
| total        | decimal(12,2)| NOT NULL          | Importe total                  |
| valido_hasta | date         |                   | Fecha de validez               |
| created_at   | timestamptz  | default now()     | Fecha de creación              |
| updated_at   | timestamptz  | default now()     | Última actualización           |

---

## Tabla: `facturas`

Facturas emitidas, opcionalmente ligadas a un presupuesto.

| Columna        | Tipo         | Restricciones     | Descripción                |
|----------------|--------------|-------------------|----------------------------|
| id             | uuid         | PK, default gen_random_uuid() | Identificador único |
| presupuesto_id | uuid         | FK → presupuestos(id) | Presupuesto origen (opcional) |
| cliente_id     | uuid         | FK → clientes(id), NOT NULL | Cliente facturado   |
| numero         | text         | NOT NULL, UNIQUE  | Número de factura          |
| total          | decimal(12,2)| NOT NULL          | Importe total              |
| estado         | text         | NOT NULL          | pendiente, pagada, vencida  |
| fecha_emision  | date         | NOT NULL          | Fecha de emisión            |
| created_at     | timestamptz  | default now()     | Fecha de creación          |
| updated_at     | timestamptz  | default now()     | Última actualización       |

---

## Relaciones

- `presupuestos.cliente_id` → `clientes.id`
- `facturas.cliente_id` → `clientes.id`
- `facturas.presupuesto_id` → `presupuestos.id` (opcional)

## Notas

- Añadir tablas de líneas (por ejemplo `presupuesto_lineas`, `factura_lineas`) cuando se implemente el detalle de partidas.
- Considerar RLS (Row Level Security) en Supabase por tabla según roles de usuario.
