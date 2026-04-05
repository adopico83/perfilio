# Perfilio — Estado del proyecto

Documento orientado a mentor técnico: inventario de lo **implementado y operativo** en el código actual, y un **roadmap** inferido (prioridades sugeridas; validar con el equipo).

**Alcance:** revisión del repositorio (App Router, APIs, tests, dependencias). Fecha de referencia: abril 2026.

---

## 1. FUNCIONALIDADES IMPLEMENTADAS

### Dashboard y UI

- **Dashboard principal** (`app/dashboard/page.tsx`): resumen de negocio con contadores (presupuestos, albaranes/facturas pendientes), métricas (importe pendiente de cobro, total presupuestado, materiales vía heurística en texto de presupuestos), desgloses en modales, últimos presupuestos, agenda próxima, obras activas, últimos clientes, entradas recientes de diario, integración Gmail (conexión/desconexión, urgentes con caché en `localStorage`).
- **Shell del dashboard** (`components/dashboard/dashboard-shell.tsx`): layout con panel lateral del agente; en desktop el chat es columna fija (`lg:`), en móvil overlay (`lg:hidden`).
- **Navegación y secciones**: acordeones de sección con persistencia en `localStorage`; modal de agenda (calendario, CRUD de eventos vía Supabase).
- **Modales/contextos**: obra (`obra-modal-context`, `obra-modal.tsx`), email (`email-modal`, urgentes), canvas (`canvas-context`, `canvas-modal`), sidebar del agente (`agent-sidebar-context`).
- **Refresco tras agente**: evento global `CustomEvent('perfilio:refresh')` desde `agent-sidebar.tsx` tras respuesta exitosa del agente; `dashboard/page.tsx` escucha y vuelve a ejecutar `loadDashboard` (misma función que en el montaje).
- **Landing pública** (`app/page.tsx` + `components/landing/*`): marketing, sectores, pricing, FAQ, demo, lista de espera (modal que intenta notificar vía API — ver nota técnica en roadmap).
- **Autenticación**: login (`app/login/page.tsx`), logout, middleware que protege `/dashboard` y redirige sesión activa fuera de `/login`.
- **Tema**: `next-themes`, toggle claro/oscuro (`components/ui/theme-toggle.tsx`).
- **Páginas de dominio** (todas bajo flujo autenticado + layouts donde aplica): presupuestos, facturas, albaranes, obras, clientes (lista + ficha `[id]`), diario, mensajes, historial, agente (vista alternativa de conversaciones pendientes).

### Agente IA (tools y capacidades)

- **Endpoint principal**: `POST /api/agente` (`app/api/agente/route.ts`) — modelo OpenAI con **router de intención** (una llamada clasifica en `documentos | emails | agenda | gastos | diario | clientes | calculo | general`) y segunda pasada con **subconjunto de tools** según la categoría (reduce tokens y ruido).
- **Contexto en system prompt**: perfil de negocio (Supabase `business_profiles`), fecha/hora, ciudad para meteo, eventos agenda (primer mensaje), bloque **memoria del negocio** (`memoria_negocio`), listados dinámicos de **obras abiertas/en curso** y **últimos clientes** (últimas 10 / 10).
- **Mensajes multimodales**: texto + **imagen** (data URL / base64) para visión en el turno del usuario (tickets, fotos); compresión en cliente en `agent-sidebar.tsx` para adjuntos.
- **Historial y persistencia**: `conversation_history` en Supabase; API `app/api/agente/conversaciones/route.ts` para listar conversaciones por usuario/negocio.
- **Saludo automático** (sidebar): prompt interno que fuerza uso de tools (agenda, presupuestos pendientes, emails, albaranes sin facturar, tiempo) una vez al día por `localStorage`.
- **TTS**: `POST /api/tts` (lectura en voz del markdown del asistente).
- **Transcripción de voz**: `POST /api/transcribe` (Whisper) usada desde el sidebar para dictado.
- **Respuestas estructuradas**: payload puede incluir `canvas` (abre modal de vista visual), `obra_modal` (abre ficha obra), `email_pendiente` (borrador para aprobación en UI).

**Tools registradas** (ejecución server-side con `createServiceClient` + RLS según políticas Supabase):

| Área | Tools |
|------|--------|
| Documentos | `obtener_*_pendientes`, `listar_presupuestos/facturas/albaranes`, `albaranes_sin_facturar`, `cambiar_estado_*`, `editar_*`, `generar_presupuesto_por_dictado` (con `solo_vista_previa` para evitar duplicados en BD hasta confirmación), `gestionar_tarifas`, `crear_presupuesto/factura/albaran`, `crear_obra`, `actualizar_obra`, `buscar_obra`, `ver_ficha_obra`, `asociar_documentos_a_obra`, `convertir_presupuesto_a_albaran`, `convertir_albaran_a_factura` |
| Clientes | `crear_cliente`, `buscar_cliente`, `ver_cliente` |
| Agenda | `crear_recordatorio`, `editar_recordatorio`, `eliminar_recordatorio` |
| Emails | `obtener_mensajes_pendientes`, `leer_emails_recientes`, `enviar_email` |
| Gastos | `registrar_gasto_ticket`, `vincular_gasto` |
| Diario | `crear_entrada_diario`, `generar_pdf_diario` |
| Cálculo / utilidades | `calcular_medicion`, `get_directions` (rutas), `consultar_tiempo` (Open-Meteo + geocoding) |
| Extras | `registrar_extra`, `listar_extras` |
| Memoria | `guardar_memoria`, `eliminar_memoria` |
| Visualización | `mostrar_vista_visual` |

- **Flujo SDD** (documentado en prompt): confirmación explícita antes de crear documentos sensibles; `generar_presupuesto_por_dictado` primera pasada con `solo_vista_previa: true`, segunda sin vista previa tras “sí”.
- **Lib de apoyo**: `lib/dictado-presupuesto.ts` (estructuración de partidas con tarifas del negocio o base albañilería), `lib/memoria-negocio.ts`, `lib/obras-context.ts`, `lib/weather.ts`, `lib/maps.ts`, `lib/albaranes-sin-facturar.ts`, `lib/diario-obra.ts`, `lib/diario-pdf-link.ts`.

### Gestión de obras y clientes

- **API REST**: `GET/POST /api/obras`, `GET/PATCH/DELETE /api/obras/[id]`; `GET/POST /api/clientes`, `GET/PATCH/DELETE /api/clientes/[id]` (validación y negocio en rutas).
- **UI**: listados y fichas en `app/obras/page.tsx`, `app/clientes/page.tsx`, `app/clientes/[id]/page.tsx`; modal de obra desde dashboard/agente.
- **Contexto en agente**: resolución de obra para documentos (`resolverObraDocumentoAgente`, etc.); creación de obra con `cliente_id` / `cliente_nombre` (búsqueda ilike); si no existe cliente por nombre, **auto-alta** opcional con `cliente_telefono` / `cliente_email` en `crear_obra`.

### Documentos (presupuestos, albaranes, facturas)

- **Listados UI** en `app/presupuestos`, `app/albaranes`, `app/facturas` (patrones similares de tabla/cards según implementación actual).
- **Agente**: CRUD y cambios de estado; conversiones encadenadas presupuesto → albarán → factura; extras como presupuestos hijos (`es_extra`, `parent_id`); asociación masiva de IDs a obra.
- **API auxiliar**: `GET /api/albaranes/sin-facturar` para listados de antigüedad.
- **Tarifas**: tabla `tarifas` por `business_id`; tool `gestionar_tarifas` (listar/añadir/editar).

### Gastos y OCR

- **Visión**: imágenes en el chat del agente analizadas en el mensaje de usuario (no OCR clásico Tesseract en repo; extracción vía modelo multimodal).
- **Tool `registrar_gasto_ticket`**: registro de gasto a partir de datos (y contexto de imagen en la conversación); `vincular_gasto` para asociar a documentos u obra.
- **Clasificación aparte**: `POST /api/classify` (GPT-3.5) para urgencia de mensajes en flujo “mensajes” + alerta email vía `lib/email.ts` (Resend).

### Diario de obra

- **API**: `GET/POST /api/diario`, `POST /api/diario/upload` (subida de archivos asociados al diario).
- **UI**: `app/diario/page.tsx`, modal de entrada (`diario-entrada-modal.tsx`); widget en dashboard con últimas entradas.
- **Agente**: `crear_entrada_diario` (incl. `cliente_id` donde aplica), `generar_pdf_diario`; enlaces de descarga PDF reconocidos en UI (`lib/diario-pdf-link.ts`).

### Emails (Gmail OAuth2)

- **OAuth**: `GET /api/auth/gmail`, callback `app/api/auth/gmail/callback/route.ts`, `POST /api/auth/gmail/disconnect`.
- **Tokens**: tabla `gmail_tokens`; refresco en `lib/gmail/get-access-token.ts`.
- **APIs**: `GET /api/gmail/recent`, `GET /api/gmail/urgentes` (heurística de urgencia + caché en cliente), `POST /api/gmail/send`.
- **Agente**: lectura de recientes, borrador con aprobación (`enviar_email` → `email_pendiente` en respuesta).
- **Dashboard**: tarjetas de urgentes/recientes, modal de envío.

### Móvil y responsive

- **Sidebar agente**: panel completo en móvil (drawer/overlay), ancho fijo en `lg+`.
- **Dashboard**: grids y tipografía adaptables (Tailwind); secciones colapsables.
- **Touch**: botones con `touch-manipulation` en varios controles del sidebar.
- **No hay** app nativa ni PWA explícita en el inventario revisado.

### Técnico (stack, tests, arquitectura)

- **Stack**: Next.js **16** (App Router), React **19**, TypeScript **5**, Tailwind **4**, Supabase (`@supabase/ssr` + `@supabase/supabase-js`), OpenAI SDK, Resend, html2canvas + jsPDF (PDF cliente).
- **Estructura**: `app/` rutas y route handlers; `components/` UI; `lib/` dominio y clientes; `contexts/` estado UI global; `middleware.ts` sesión Supabase + guardas de ruta.
- **Seguridad**: middleware exige usuario para **cualquier** ` /api/*` (401 si no hay sesión); tests en `middleware.api-protection.test.ts`.
- **Tests**: **Jest 30** + Testing Library; **77 tests** en **20 suites** cubriendo sobre todo API agente (tools, dictado, tiempo, albaranes, extras), APIs obras/clientes/diario, Gmail auth/urgentes, transcribe, maps, weather, memoria, middleware, modales (email/canvas), obras-context.
- **CI**: no hay workflows `.github/` en el repositorio (ejecutar tests en local o añadir pipeline pendiente).
- **Documentación interna**: `DATABASE.md` (esquema orientativo; **desalineado** respecto a columnas reales usadas en código, p. ej. `presupuestos.presupuesto_generado`, `obra_id`, estados extendidos), `AUTH_SETUP.md`, `docs/chuleta-agente.md`.
- **Rutas legacy / demo**: `app/test-classify`, `app/test-assistant` — útiles en desarrollo.
- **Flujo paralelo “mensajes”**: `app/mensajes` + `app/agente` + `app/historial` + `/api/assistant` + tabla `conversations` / `ai_responses` (aprobar/rechazar respuestas), distinto del agente con tools del dashboard.

---

## 2. ROADMAP PENDIENTE

### Inmediato (post-reunión con primer beta tester)

- **Sintetizar feedback** en issues concretos (UX agente, latencia, errores de tools, datos mal enlazados obra/cliente).
- **Lista de espera / landing**: el middleware bloquea `POST /api/lista-espera-notificacion` sin sesión (401); si el formulario público debe funcionar, **excluir esa ruta** del matcher o tratarla como API pública documentada.
- **Coherencia documentación ↔ código**: actualizar `DATABASE.md` y `types/index.ts` al esquema real de Supabase (presupuestos, estados, columnas de gastos, diario, etc.).
- **Observabilidad mínima**: logging estructurado y/o captura de errores en ` /api/agente` (hoy hay `console.error` disperso); métricas de uso de tools en beta.
- **Pruebas manuales críticas**: Gmail en producción (redirect URIs, refresh tokens), subida diario, PDF diario, flujo `solo_vista_previa` → confirmación → un solo insert en BD.

### Medio plazo

- **CI/CD**: pipeline (GitHub Actions u otro) con `npm run lint` + `npm run test` + `npm run build` en cada PR.
- **RLS y multi-tenant**: revisión explícita de políticas Supabase por `business_id` / `user_id`; hoy la seguridad depende mucho del service role en APIs del agente y del middleware de sesión.
- **Onboarding**: registro self-service si el modelo de negocio lo requiere (`AUTH_SETUP.md` ya esboza `/register`).
- **Unificación o deprecación** del flujo `mensajes` + `/api/assistant` vs agente con tools (evitar dos “cerebros” y duplicar mantenimiento).
- **Rendimiento agente**: cache de contexto estático, límites de tokens, streaming de respuesta al cliente (si la UX lo pide).
- **Materiales / stock**: tabla `materiales` descrita en `DATABASE.md` — integrar en UI y en agente si es prioridad de negocio.
- **Accesibilidad y i18n**: auditoría básica (ARIA en modales ya parcial) y decisión sobre idiomas.

### Largo plazo / por validar

- **App móvil o PWA** con offline limitado para obra (fotos, dictado, sync).
- **Facturación del SaaS** (Stripe u otro), planes, límites por negocio.
- **Informes y BI**: export contable, dashboard ejecutivo, comparativas por obra.
- **Integraciones**: otros buzones, WhatsApp Business, contabilidad (Holded, A3, …).
- **Equipo y roles**: varios usuarios por `business_id` con permisos (solo lectura, solo obra X, etc.).
- **Hardering legal**: RGPD, retención de conversaciones, DPA con OpenAI/Google según uso real.

---

*Generado a partir del análisis del código en el repositorio Perfilio; las prioridades del roadmap son propuestas y deben cruzarse con la estrategia de producto.*
