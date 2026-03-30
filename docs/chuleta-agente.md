# Chuleta del asistente Perfilio

Guía sencilla para entender qué puede hacer el agente de tu negocio y cómo pedírselo con palabras normales. No hace falta saber de informática.

---

## 1. Listado de herramientas del agente

Cada “herramienta” es una acción concreta que el agente puede ejecutar por ti cuando se lo pides bien.

### Presupuestos

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **obtener_presupuestos_pendientes** | Te lista los presupuestos que siguen pendientes, con cliente, importe y fecha. | “Enséñame los presupuestos pendientes” o “¿Qué presupuestos tengo sin cerrar?” |
| **listar_presupuestos** | Te muestra los últimos 10 presupuestos (todos los estados). | “Lista mis últimos presupuestos” o “Quiero ver el historial de presupuestos” |
| **crear_presupuesto** | Guarda un presupuesto nuevo en el sistema con el texto que ya esté redactado. | “Crea un presupuesto para…” o “Genera y guarda un presupuesto para la reforma de…” |
| **cambiar_estado_presupuesto** | Cambia el estado de un presupuesto (por ejemplo a aceptado o rechazado). | “Marca como aceptado el presupuesto de…” (mejor si antes pides que lo busque) |
| **editar_presupuesto** | Cambia nombre de cliente, importe o el texto del presupuesto guardado. | “Cambia el importe del presupuesto de…” o “Actualiza la descripción del presupuesto…” |

### Facturas

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **obtener_facturas_pendientes** | Lista facturas pendientes de cobro con cliente, importe y fecha. | “¿Qué facturas tengo por cobrar?” |
| **listar_facturas** | Muestra las últimas 10 facturas. | “Muéstrame las últimas facturas” |
| **crear_factura** | Registra una factura nueva. | “Crea una factura por los trabajos de…” |
| **cambiar_estado_factura** | Cambia el estado de una factura (por ejemplo a pagada). | “Marca como pagada la factura de…” |
| **editar_factura** | Cambia datos de una factura ya existente. | “Corrige el total de la factura…” |

### Albaranes

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **obtener_albaranes_pendientes** | Lista albaranes pendientes con cliente y fecha. | “¿Qué albaranes están pendientes?” |
| **listar_albaranes** | Muestra los últimos 10 albaranes. | “Lista los últimos albaranes” |
| **crear_albaran** | Crea un albarán nuevo. | “Genera un albarán por la entrega de…” |
| **cambiar_estado_albaran** | Cambia el estado del albarán. | “Pon como entregado el albarán de…” |
| **editar_albaran** | Modifica un albarán existente. | “Cambia la descripción del albarán…” |

### Clientes

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **crear_cliente** | Da de alta una ficha de cliente con datos de contacto. | “Registra un cliente que se llama…” |
| **buscar_cliente** | Busca clientes por nombre, email o teléfono. | “Busca clientes que se llamen García” |
| **ver_cliente** | Muestra la ficha completa con historial de documentos y diario. | “Muéstrame todo lo de el cliente…” |

### Mensajes y correo

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **obtener_mensajes_pendientes** | Recoge respuestas del asistente que aún no has aprobado o rechazado. | “¿Tengo mensajes pendientes de revisar?” |
| **leer_emails_recientes** | Lee los últimos correos del Gmail conectado (resumen). | “¿Qué correos tengo recientes?” |
| **enviar_email** | Prepara un borrador de correo; **no lo envía** hasta que tú lo confirmes en pantalla. | “Redacta un email a… con asunto…” |

### Agenda (recordatorios)

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **crear_recordatorio** | Crea un evento o recordatorio en la agenda. | “Apúntame una cita el día… a las…” |
| **editar_recordatorio** | Cambia título, fecha u hora de un recordatorio. | “Cambia la hora del recordatorio de…” |
| **eliminar_recordatorio** | Borra un recordatorio. | “Elimina el recordatorio del…” |

### Medidas y obra

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **calcular_medicion** | Calcula superficies, volúmenes, metros lineales o perímetros a partir de medidas que tú das (en metros o centímetros). | “Calcula los metros cuadrados de una habitación 4 por 3” o “¿Cuánto volumen tiene un bloque de…?” |

### Gastos y tickets (foto de ticket o factura)

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **registrar_gasto_ticket** | Guarda un gasto leído de una foto, **solo después de que tú confirmes**. | Primero enseñas la foto; cuando el agente resume los datos, dices “sí, regístralo” |
| **vincular_gasto** | Une un gasto ya guardado a una factura o albarán. | “Vincula ese gasto a la factura número…” |

### Diario de obra

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **crear_entrada_diario** | Añade una entrada al diario de una obra (texto, y enlaces a fotos o vídeos si ya están subidos). | “Registra en el diario de la obra… que hoy hemos…” |
| **generar_pdf_diario** | Genera un PDF con todo el diario de esa obra y te da un enlace de descarga. | “Sácame el PDF del diario de la obra…” |

### Vista en pantalla grande (tabla)

| Herramienta | Qué hace | Cómo pedirlo |
|-------------|----------|--------------|
| **mostrar_vista_visual** | Abre un panel con filas en tabla (presupuestos, facturas, albaranes, clientes, emails, gastos o diario). | “Muéstramelo en tabla” o “Ábreme una vista con los presupuestos” o “Quiero ver esto en panel” |

---

## 2. Capacidades de voz

El agente **no oye directamente** por el altavoz del ordenador: lo que ocurre en la aplicación es lo siguiente.

**Entrada por voz (micrófono)**  
- Puedes grabar lo que dices con el botón del micrófono en el panel del agente.  
- Ese audio se convierte automáticamente en texto y se envía al agente **como si lo hubieras escrito**.  
- Así puedes dictar presupuestos, notas del diario de obra, mensajes largos, etc.

**Salida por voz (escuchar respuesta)**  
- Cuando el agente responde, puedes usar la opción para **escuchar la respuesta en voz alta**.  
- La aplicación genera un audio a partir del texto de la respuesta para que puedas oírla sin leer.

En resumen: **hablas y el sistema transcribe**; **el agente responde por texto y tú puedes pedir que te lo lean en voz alta**. Todo el “cerebro” del agente sigue siendo el mismo; solo cambia cómo introduces y cómo escuchas el mensaje.

---

## 3. Qué hace el agente solo, sin que lo pidas

- **Inicio de conversación**  
  - Si tienes **citados en la agenda para hoy o mañana**, el agente puede mencionarlo al principio, en un tono natural (sin listas largas).  
  - Si hay **mensajes de clientes pendientes de tu revisión**, las instrucciones le dicen que los mencione al inicio cuando aplique.

- **Fechas y saludos**  
  - El agente conoce la **fecha y hora actuales** (zona de España) para saludar bien y hablar de plazos con sentido.

- **Reglas internas (tú no las ves, pero las cumple)**  
  - No crea presupuestos, facturas ni albaranes **nuevos** solo porque hayas dicho la palabra “presupuesto” en un comentario: tiene que quedar claro que quieres **crear** uno.  
  - Para **medidas de obra**, no inventa totales a mano: usa el cálculo automático.  
  - Para **fotos de tickets**, primero te enseña lo que ha leído y pregunta; solo guarda el gasto si confirmas.  
  - Los **correos con borrador** no se envían solos: tú das el paso final en la interfaz.

---

## 4. Vista visual (panel tipo tabla / “canvas”)

**Cuándo se activa**  
Cuando pides explícitamente ver algo **en tabla**, **en vista**, **en panel**, **visualízalo** o similar. No es para cada listado normal del chat: es para cuando quieres una **pantalla aparte** con filas y columnas.

**Cómo funciona por dentro (en simple)**  
1. El agente primero **obtiene los datos** (por ejemplo “últimos presupuestos” o “correos recientes”).  
2. Luego abre el **panel visual** con esos mismos datos.  
3. Si faltan datos, intenta rellenarlos solo en algunos casos; lo ideal es que siempre haya una lista reciente detrás.

**Qué puedes ver ahí**  
Presupuestos, facturas, albaranes, clientes, correos, gastos o entradas del diario de obra, según lo que hayas pedido.

Tras abrirlo, el agente suele decir algo breve del estilo: “Abriendo vista visual de…”.

---

## 5. Resumen de las instrucciones principales del agente

### Identidad y tono  
El agente se presenta como el asistente de **tu negocio**: usa el nombre, sector, servicios, tarifas e información extra que hayas guardado en el perfil. Responde en **español**, de forma **profesional y clara**, sin rollos innecesarios.

### Presupuestos, facturas y albaranes  
- **Crear** solo cuando pides claramente crear o generar algo nuevo.  
- **Listar o “pendientes”** cuando solo quieres consultar.  
- Para **cambiar estado** o **editar**, si hablas de “el de Juan” sin número, el agente primero **busca el documento** en la lista y luego actúa.  
- Los **estados** que maneja incluyen pendiente, aceptado, rechazado, facturado y pagado (según el tipo de documento).

### Facturas nuevas  
Si faltan datos, el agente puede preguntarte por cliente, NIF, mano de obra, materiales, etc., antes de cerrar la factura con base, IVA al 21 % y total.

### Correo electrónico  
**enviar_email** solo deja un **borrador**; tú debes **aprobar o cancelar** el envío desde la propia pantalla.

### Urgencia en correos (criterios que sigue el agente)  
Un correo se considera **urgente** si, por ejemplo:  
- En asunto o texto aparecen ideas como urgencia, presupuesto, factura pendiente, pago, plazo, reclamación, avería, emergencia, etc.  
- Viene de un **cliente que ya aparece** en presupuestos o facturas.  
- Lleva **más de dos días sin leer**.  
- Es **respuesta** a un presupuesto que enviaste.  

Si no encaja en nada de eso, lo trata como **normal**.

### Diario de obra  
- **crear_entrada_diario** cuando quieres dejar constancia del avance (vale lo que dictes o escribas).  
- **generar_pdf_diario** cuando quieres el PDF completo de una obra; hace falta el **nombre exacto** de la obra.  
- Después de crear una entrada, el sistema puede sugerirte si quieres el PDF; el agente puede repetir esa idea.

### Medidas  
Si hablas de metros, dimensiones o cálculos de obra, debe usar la herramienta de **cálculo** y explicarte el resultado con el desglose, sin inventarse números a ojo.

### Fotos de tickets  
Primero **lee y te muestra** lo que entiende; **registra el gasto** solo si confirmas. Después puede ofrecer **vincular** el gasto a una factura o albarán cuando tú lo indiques.

### Vista visual  
Solo cuando pides ver datos en **tabla / panel / vista**; necesita datos recientes y no debe abrir el panel vacío.

---

*Documento generado a partir del comportamiento definido en la aplicación Perfilio. Si el producto cambia, conviene revisar esta chuleta.*
