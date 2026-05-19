# Perfilio

**Agente de Operaciones con IA para gremios de construcción y reformas en el País Vasco.**

Perfilio no es otro ERP con chatbot encima: es un agente que **ejecuta trabajo** — presupuestos, albaranes, facturas, gastos, diario de obra, horas de operarios y correo — mientras el encargado está en faena.

Proyecto **SaaS en producción** y **Trabajo de Fin de Grado (DAW)**. Diseñado para autónomos y pequeñas empresas del sector que necesitan menos pantallas y más acciones hechas.

---

## ¿Qué es Perfilio?

| | |
|---|---|
| **Qué hace** | Orquesta el ciclo operativo de una obra: cliente → presupuesto → albarán → factura, con gastos, diario visual y equipo en obra. |
| **Cómo** | Conversación natural (texto y voz), herramientas conectadas a Supabase y APIs externas, dashboard crema/terracota. |
| **Para quién** | Albañilería, reformas, pintura, fontanería y oficios afines en Euskadi. |
| **Qué no es** | Un software de gestión pasivo. Perfilio **actúa**: dicta, genera PDFs, registra gastos desde foto, envía emails. |

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase · OpenAI · Vercel

---

## Features actuales

### Agente y voz
- Agente conversacional con historial estilo ChatGPT (conversaciones por negocio).
- **Whisper** (STT) y **TTS** (voz `onyx`) integrados en el sidebar del dashboard.
- Dictado de presupuestos por voz con **tarifas base PV 2026**.

### Ciclo comercial y obra
- Flujo completo: **Obra → Cliente → Presupuesto → Albarán → Factura**.
- Canvas visual de obras (ficha unificada: presupuestos, facturas, diario, gastos, horas).
- **Diario de obra** visual: foto + audio → entrada estructurada → PDF.
- **Gastos** con OCR de tickets de compra (foto → gasto categorizado).

### Equipo y comunicación
- Gestión de **operarios** y **horas por obra**.
- **Emails** vía Gmail OAuth2 (borradores con aprobación humana).
- **Weather tool** (OpenWeather) para planificación en obra.

### Plataforma
- **PWA** con notificaciones push (agenda y avisos).
- **Dashboard** multi-usuario con paleta crema (`#EFEADF`) / terracota (`#A04A2F`).
- **RLS completo** en Supabase: cada usuario solo ve datos de su `business_profile`.
- Landing editorial con demo en vídeo y flujo de acceso a beta.

---

## Arquitectura

### Stack técnico

| Capa | Tecnología |
|------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Framer Motion |
| Backend / API | Route Handlers (`app/api/*`), Server y Client Components |
| Base de datos | Supabase (PostgreSQL + Auth + Storage) |
| IA | OpenAI (chat, tools, Whisper, TTS) |
| Email transaccional | Resend |
| Email operativo | Gmail API (OAuth2) |
| Deploy | Vercel (app), Supabase (DB), Railway (cron Python push) |
| Tests | Jest + Testing Library |

### Estructura de carpetas (clave)

```
perfilio/
├── app/
│   ├── page.tsx                 # Landing
│   ├── login/                   # Auth
│   ├── dashboard/               # Panel principal
│   ├── agente/                  # Vista agente (si aplica)
│   ├── obras|clientes|presupuestos|albaranes|facturas|gastos|diario|operarios|mensajes/
│   └── api/
│       ├── agente/              # ⚠️ God File — orquestador del agente
│       ├── agente/conversaciones/
│       ├── cron/, push/, gmail/, pdf/, transcribe/, tts/, ...
│       └── ...
├── components/
│   ├── dashboard/               # Sidebar agente, modales, nav, widgets
│   └── landing/
├── lib/
│   └── agente/
│       └── modules/             # Lógica extraída del God File
│           ├── operarios.ts
│           ├── presupuestos.ts
│           ├── diario.ts
│           ├── gastos.ts
│           └── agenda.ts
├── contexts/                    # Canvas, email, obra modal, sidebar agente
└── public/                      # Assets, PWA, manifest
```

### Base de datos (tablas principales)

Todas las entidades de negocio cuelgan de `business_profiles` (perfil por usuario/empresa):

| Dominio | Tablas |
|---------|--------|
| Negocio | `business_profiles` |
| Obras y clientes | `obras`, `clientes` |
| Documentos | `presupuestos`, `albaranes`, `facturas` |
| Operativa | `gastos`, entradas de `diario`, `tarifas` |
| Equipo | `operarios`, registros de jornada/horas |
| Agente | `conversaciones`, mensajes, `perfilio_insights` (avisos del “Bicho”) |
| Integraciones | tokens Gmail, suscripciones push |

### God File y módulos

**`app/api/agente/route.ts`** (~4.800 líneas) es el **orquestador puro** del agente: system prompt, tool calling, routing de intenciones y coordinación con Supabase.

> **Regla de oro:** no añadir lógica de dominio nueva aquí. El código nuevo va a `lib/agente/modules/*` y se importa desde el route.

Módulos ya extraídos:

- `lib/agente/modules/operarios.ts`
- `lib/agente/modules/presupuestos.ts`
- `lib/agente/modules/diario.ts`
- `lib/agente/modules/gastos.ts`
- `lib/agente/modules/agenda.ts`

### Patrón RLS (Row Level Security)

Aislamiento multi-tenant por usuario autenticado:

```sql
EXISTS (
  SELECT 1
  FROM business_profiles bp
  WHERE bp.id = tabla.business_id
    AND bp.user_id = auth.uid()
)
```

Cada tabla operativa (`obras`, `clientes`, `presupuestos`, etc.) referencia `business_id` y hereda políticas vía `business_profiles`.

---

## Variables de entorno

Crear `.env.local` en la raíz (nunca commitear secretos):

| Variable | Uso |
|----------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (cliente + RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Operaciones server-side privilegiadas |
| `OPENAI_API_KEY` | Chat, tools, Whisper, TTS |
| `GMAIL_CLIENT_ID` | OAuth2 Gmail |
| `GMAIL_CLIENT_SECRET` | OAuth2 Gmail |
| `RESEND_API_KEY` | Emails transaccionales (lista de espera, notificaciones) |
| `OPENWEATHER_API_KEY` | Tool de tiempo en el agente |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push PWA (cliente) |
| `VAPID_PRIVATE_KEY` | Push PWA (servidor) |
| `CRON_SECRET` | Protección de endpoints cron (`/api/cron/*`) |

---

## Cómo arrancar en local

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env.local   # si existe ejemplo; si no, crear .env.local a mano
# Rellenar todas las variables de la tabla anterior

# 3. Desarrollo
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). Login en `/login`, dashboard en `/dashboard`.

```bash
# Build de producción (local)
npm run build
npm start
```

---

## Tests

```bash
npm test
```

Estado actual: **88 tests en 24 suites en verde**.

Los tests cubren utilidades del agente, módulos extraídos, helpers de negocio y componentes críticos del dashboard.

---

## Despliegue

| Servicio | Rol |
|----------|-----|
| **Vercel** | Frontend + API Routes. Deploy automático desde `main`. |
| **Supabase** | PostgreSQL, Auth, Storage (imágenes diario, tickets, etc.). |
| **Railway** | Cron en Python para envío de push notifications programadas. |

Dominio de producción configurado en Vercel. Migraciones y políticas RLS se gestionan en el panel de Supabase.

---

## Roadmap

- [ ] **Outlook / Microsoft Graph** — adapter de email paralelo a Gmail.
- [ ] **TicketBAI** — integración vía [ticketbaiws.eus](https://ticketbaiws.eus) para facturación en País Vasco.
- [ ] **Profit Protector** — alertas de gasto real vs presupuestado por obra.
- [ ] **Follow-up automático** de presupuestos enviados sin respuesta.
- [ ] **Extracción completa del God File** — más dominio en `lib/agente/modules/`.
- [ ] **Expansión beta** — Pimoga2, Orbegozo Dekorazioa, Iker Larrauri.

---

## Licencia y autoría

Proyecto académico y producto en evolución. Uso restringido según política del repositorio y acuerdos con empresas beta.

**Perfilio** — *El encargado que no duerme.*
