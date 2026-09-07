<p align="center">
  <img src="public/logo.png" width="200" alt="Perfilio" />
</p>

<h1 align="center">Perfilio</h1>
<p align="center"><strong>El encargado que no duerme.</strong></p>

<p align="center">
  Agente de operaciones con IA para <strong>gremios de construcción y reformas en el País Vasco</strong>.<br />
  Dictas en obra. Él presupuesta, factura, anota gastos y lleva el equipo.
</p>

<p align="center"><em>EN — Operations agent for Basque construction trades. Dictate a quote. Log an expense from a photo. Keep the jobsite moving.</em></p>

<p align="center">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16.1-black?style=flat-square&logo=nextdotjs" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img alt="Vercel" src="https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel" />
  <img alt="Uso restringido" src="https://img.shields.io/badge/licencia-uso%20restringido-lightgrey?style=flat-square" />
</p>

<p align="center">
  <a href="https://perfilio.vercel.app"><strong>Demo en vivo</strong></a>
  ·
  <a href="https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20y%20quiero%20acceso%20a%20la%20beta"><strong>Acceso beta (WhatsApp)</strong></a>
  ·
  <a href="https://github.com/adopico83/perfilio"><strong>GitHub</strong></a>
</p>

<p align="center">
  SaaS en producción · TFG (DAW) · Beta cerrada
</p>

<p align="center">
  <img src="docs/readme/agente.png" width="260" alt="Agente IA: briefing del día en Irún" />
  <img src="docs/readme/presupuesto.png" width="260" alt="Borrador de presupuesto por dictado" />
</p>

<p align="center"><sub>Agente IA: briefing del día → “Crea un presupuesto…” → borrador con IVA. Fotogramas reales de <code>public/demo_nueva.mp4</code>.</sub></p>

<!-- Huecos para Ander (ver docs/readme/ASSETS.md)
<p align="center">
  <img src="docs/readme/landing.png" width="720" alt="Landing Perfilio" />
</p>
<p align="center">
  <img src="docs/readme/dashboard.png" width="360" alt="Dashboard" />
  <img src="docs/readme/gasto.png" width="360" alt="Gasto desde foto" />
</p>
-->

---

## El problema

El encargado está en faena. El papeleo no espera: presupuestos, albaranes, facturas, tickets, horas, correo.

Perfilio **no es un ERP con un chat encima**. Es un agente que **ejecuta**: voz, foto y texto se convierten en documentos y registros reales.

| | |
|---|---|
| **Para quién** | Albañilería, reformas, pintura, fontanería, electricidad e interiorismo en Euskadi |
| **Qué no es** | Software pasivo. No te deja solo ante otra pantalla más |

---

## Qué puedes hacer hoy

- **Dictar un presupuesto** — partidas en lenguaje de gremio (m², ml, jornadas); tarifas base País Vasco 2025 + tarifas del negocio; PDF con IVA.
- **Gasto desde foto** — adjuntas el ticket; el modelo ve la imagen y categoriza el gasto.
- **Diario de obra** — foto + audio → entrada estructurada → PDF.
- **Ciclo comercial** — obra → cliente → presupuesto → albarán → factura (también extras y conversiones).
- **Equipo** — operarios y horas por obra.
- **Correo con freno humano** — Gmail OAuth2; el agente redacta, tú apruebas el envío.
- **Briefing del día** — agenda, pendientes, albaranes sin facturar, tiempo en obra (OpenWeather).
- **Avisos de fondo (“El Bicho”)** — insights de inactividad, rentabilidad y facturación sobre obras activas.

PWA instalable (dashboard + push de agenda). Paleta crema `#EFEADF` / terracota `#A04A2F`.

---

## Pruébalo en 60 segundos

### Opción A — ver el producto

1. Abre **[perfilio.vercel.app](https://perfilio.vercel.app)** (landing pública).
2. Pide acceso: **[WhatsApp](https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20y%20quiero%20acceso%20a%20la%20beta)**. La beta es cerrada; no hay registro self-service.
3. Con cuenta, entra en `/login` → `/dashboard`.

### Opción B — local (devs)

Hace falta un proyecto Supabase (Auth + tablas) y una `OPENAI_API_KEY`. No hay `.env.example` en el repo.

```bash
git clone https://github.com/adopico83/perfilio.git
cd perfilio
npm install
# crea .env.local (tabla de abajo)
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Crea el usuario en el panel de Supabase Auth (ver `AUTH_SETUP.md`).

```bash
npm test          # 100 tests en 26 ficheros
npm run build && npm start
```

---

## Stack (verificado en `package.json`)

| Capa | Tecnología |
|------|------------|
| App | **Next.js 16.1** (App Router) · **React 19** · **TypeScript 5** · **Tailwind CSS v4** · Framer Motion |
| Backend | Route Handlers `app/api/*` · Server / Client Components |
| Datos | Supabase (PostgreSQL + Auth + Storage + **RLS**) |
| IA | OpenAI (chat + tools + Whisper STT + TTS `onyx`) |
| Docs | `@react-pdf/renderer`, jsPDF |
| Email | Resend (transaccional) · Gmail API (operativo) |
| Deploy | **Vercel** (`perfilio.vercel.app`) · cron de push: GitHub Actions → `/api/cron/agenda-push` |
| Tests | Jest 30 + Testing Library |

---

## Arquitectura (versión corta)

```mermaid
flowchart LR
  A[Encargado<br/>voz / texto / foto] --> B[POST /api/agente]
  B --> C[Router de intención]
  C --> D[Módulos de dominio]
  D --> E[Supabase + RLS]
  D --> F[Gmail / PDF / meteo]
```

1. El route **clasifica** la intención (`documentos`, `presupuesto`, `gastos`, `diario`, `operarios`…).
2. Ejecuta **solo las tools de esa categoría**.
3. La lógica vive en `lib/agente/modules/*`. El route orquesta.

### Regla de oro

`app/api/agente/route.ts` (~1.200 líneas) es **orquestador**: system prompt, tool calling, routing. **No añadir dominio nuevo ahí.** Código nuevo → `lib/agente/modules/` y se importa.

Módulos actuales: `presupuestos`, `documentos`, `obras-clientes`, `gastos`, `diario`, `operarios`, `agenda`, `correo`, `canvas`, `calculo`. Apoyo: `router.ts`, `guardrails.ts`, `orquestacion.ts`.

### Dónde está cada cosa

```
app/page.tsx              Landing
app/login/                Auth
app/dashboard/            Panel
app/{obras,clientes,presupuestos,albaranes,facturas,gastos,diario,operarios}/
app/api/agente/           Orquestador + conversaciones
lib/agente/modules/       Dominio extraído
components/dashboard/     Sidebar agente, canvas, modales
supabase/migrations/      Esquema + políticas RLS
```

### RLS (multi-tenant)

Cada tabla operativa cuelga de `business_profiles`. Patrón:

```sql
EXISTS (
  SELECT 1 FROM business_profiles bp
  WHERE bp.id = tabla.business_id
    AND bp.user_id = auth.uid()
)
```

Tablas clave: `obras`, `clientes`, `presupuestos`, `albaranes`, `facturas`, `gastos`, diario, `operarios`, `tarifas`, conversaciones, tokens Gmail, push.

---

## Variables de entorno

Crear `.env.local`. **Nunca commitear secretos.**

| Variable | Uso |
|----------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente + RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Server privilegiado |
| `OPENAI_API_KEY` | Chat, tools, Whisper, TTS |
| `NEXT_PUBLIC_APP_URL` | Callbacks (p. ej. Gmail) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth2 Gmail |
| `RESEND_API_KEY` | Emails transaccionales |
| `OPENWEATHER_API_KEY` | Tiempo en obra |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push PWA |
| `CRON_SECRET` | Protege `/api/cron/*` |

Opcionales: `RESEND_FROM`, `NOTIFICATION_EMAIL`, `VAPID_MAILTO`, `ALERT_EMAIL`.

---

## Roadmap

- [ ] **TicketBAI** — facturación Euskadi ([ticketbaiws.eus](https://ticketbaiws.eus)); las facturas se generan, la conexión Hacienda no está cerrada
- [ ] **Outlook / Microsoft Graph** — email paralelo a Gmail
- [ ] **Profit Protector** — gasto real vs presupuestado por obra
- [ ] **Follow-up** de presupuestos enviados sin respuesta
- [ ] Más dominio fuera del orquestador
- [ ] Ampliar la beta cerrada

---

## Contribuir y contacto

Issues y PRs bienvenidos si el cambio es concreto (bug, test, docs). Antes de tocar el agente: lee la **regla de oro** y `docs/chuleta-agente.md`.

| | |
|---|---|
| Demo / beta | [WhatsApp](https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20y%20quiero%20acceso%20a%20la%20beta) |
| Producto | [perfilio.vercel.app](https://perfilio.vercel.app) |
| Código | [github.com/adopico83/perfilio](https://github.com/adopico83/perfilio) |
| Email producto | hello@perfilio.app |

Uso restringido (producto + TFG). No hay licencia open-source. El repo es público para mostrar el trabajo, no para redistribuir el SaaS.

**Perfilio** — *el encargado que no duerme.*
