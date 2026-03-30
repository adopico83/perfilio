import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  buildDiarioObraPdf,
  fetchDiarioObraEntries,
  insertDiarioObraEntry,
  sanitizeDiarioFilePart,
} from '@/lib/diario-obra';
import { getGmailAccessTokenForUser } from '@/lib/gmail/get-access-token';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** El modelo a veces envía un objeto o string JSON en lugar de un array; sin esto capturarCanvas no rellena canvas. */
function normalizarDatosCanvasVista(datos: unknown): unknown[] {
  if (Array.isArray(datos)) return datos;
  if (datos && typeof datos === 'object') return [datos];
  if (typeof datos === 'string') {
    const s = datos.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object') return [p];
    } catch {
      return [];
    }
  }
  return [];
}

/** YYYY-MM-DD del instante dado en la zona horaria indicada (p. ej. Europa/Madrid). */
function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Suma días a una fecha civil YYYY-MM-DD. */
function addDaysToYmd(ymd: string, days: number): string {
  const [y, mo, da] = ymd.split('-').map(Number);
  const u = Date.UTC(y, mo - 1, da + days);
  return new Date(u).toISOString().slice(0, 10);
}

const ESTADOS_DOC = ['pendiente', 'aceptado', 'rechazado', 'facturado', 'pagado'] as const;
type EstadoDoc = (typeof ESTADOS_DOC)[number];

function parseEstadoDoc(raw: unknown): EstadoDoc | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (ESTADOS_DOC as readonly string[]).includes(s) ? (s as EstadoDoc) : null;
}

const IMAGEN_VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGEN_DECODED_BYTES = 4 * 1024 * 1024;

/** Devuelve data URL lista para OpenAI vision, o null si es inválida o demasiado grande. */
function normalizarImagenVision(
  imagen: unknown,
  imagenMime: unknown
): string | null {
  if (imagen == null || typeof imagen !== 'string') return null;
  const s = imagen.trim();
  if (!s) return null;

  let mime: string;
  let b64: string;
  const marker = ';base64,';

  if (s.startsWith('data:image/')) {
    const mi = s.indexOf(marker);
    if (mi === -1) return null;
    mime = s.slice('data:'.length, mi).toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!IMAGEN_VISION_MIMES.has(mime)) return null;
    b64 = s.slice(mi + marker.length).replace(/\s/g, '');
  } else {
    const rawMime =
      typeof imagenMime === 'string' && imagenMime.trim()
        ? imagenMime.trim().toLowerCase()
        : 'image/jpeg';
    mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!IMAGEN_VISION_MIMES.has(mime)) return null;
    b64 = s.replace(/\s/g, '');
  }

  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0 || buf.length > MAX_IMAGEN_DECODED_BYTES) return null;
  } catch {
    return null;
  }

  return `data:${mime};base64,${b64}`;
}

const TIPOS_MEDICION = ['superficie', 'volumen', 'lineal', 'perimetro'] as const;
type TipoMedicion = (typeof TIPOS_MEDICION)[number];

/** Convierte dimensiones del usuario a metros y calcula totales en m², m³ o ml. */
function calcularMedicionObra(toolArgs: Record<string, unknown>):
  | { error: string }
  | {
      tipo: TipoMedicion;
      total: number;
      unidad: 'm²' | 'm³' | 'ml';
      desglose: string[];
      descripcion?: string;
    } {
  const tipoRaw = String(toolArgs.tipo ?? '').trim().toLowerCase();
  if (!(TIPOS_MEDICION as readonly string[]).includes(tipoRaw)) {
    return {
      error:
        'tipo inválido. Usa: superficie, volumen, lineal o perimetro',
    };
  }
  const tipo = tipoRaw as TipoMedicion;

  const unidadEntrada =
    toolArgs.unidad === undefined || toolArgs.unidad === null
      ? 'm'
      : String(toolArgs.unidad).trim().toLowerCase();
  if (unidadEntrada !== 'm' && unidadEntrada !== 'cm') {
    return { error: 'unidad debe ser "m" o "cm"' };
  }
  const factorAMetros = unidadEntrada === 'cm' ? 0.01 : 1;

  const dimensionesRaw = toolArgs.dimensiones;
  if (!Array.isArray(dimensionesRaw) || dimensionesRaw.length === 0) {
    return { error: 'dimensiones debe ser un array con al menos un elemento' };
  }

  type Dim = { largo: number; ancho: number; alto?: number };
  const dimensiones: Dim[] = [];
  for (let idx = 0; idx < dimensionesRaw.length; idx++) {
    const d = dimensionesRaw[idx];
    if (!d || typeof d !== 'object') {
      return { error: `dimensiones[${idx}] debe ser un objeto con largo y ancho` };
    }
    const o = d as Record<string, unknown>;
    const largo = Number(o.largo);
    const ancho = Number(o.ancho);
    const alto =
      o.alto !== undefined && o.alto !== null ? Number(o.alto) : undefined;
    if (!Number.isFinite(largo) || !Number.isFinite(ancho)) {
      return { error: 'cada dimensión necesita largo y ancho numéricos' };
    }
    if (tipo === 'volumen') {
      if (alto === undefined || !Number.isFinite(alto)) {
        return { error: 'para volumen cada dimensión necesita largo, ancho y alto' };
      }
    }
    dimensiones.push({ largo, ancho, alto });
  }

  let huecos: Array<{ cantidad: number; largo: number; ancho: number }> = [];
  if (toolArgs.huecos !== undefined && toolArgs.huecos !== null) {
    if (!Array.isArray(toolArgs.huecos)) {
      return { error: 'huecos debe ser un array de objetos' };
    }
    for (let i = 0; i < toolArgs.huecos.length; i++) {
      const h = toolArgs.huecos[i];
      if (!h || typeof h !== 'object') {
        return { error: `huecos[${i}] debe ser un objeto` };
      }
      const ho = h as Record<string, unknown>;
      const cantidad = Number(ho.cantidad);
      const hl = Number(ho.largo);
      const ha = Number(ho.ancho);
      if (!Number.isFinite(cantidad) || !Number.isFinite(hl) || !Number.isFinite(ha)) {
        return { error: 'cada hueco necesita cantidad, largo y ancho numéricos' };
      }
      huecos.push({ cantidad, largo: hl, ancho: ha });
    }
  }

  const descripcionStr =
    toolArgs.descripcion !== undefined && toolArgs.descripcion !== null
      ? String(toolArgs.descripcion).trim()
      : '';
  const descripcion = descripcionStr.length > 0 ? descripcionStr : undefined;

  const L = (n: number) => n * factorAMetros;
  const desglose: string[] = [];
  let total = 0;

  const unidadSalida: 'm²' | 'm³' | 'ml' =
    tipo === 'superficie' ? 'm²' : tipo === 'volumen' ? 'm³' : 'ml';

  if (tipo === 'superficie') {
    let bruto = 0;
    dimensiones.forEach((d, i) => {
      const area = L(d.largo) * L(d.ancho);
      bruto += area;
      desglose.push(
        `Pieza ${i + 1}: ${d.largo} × ${d.ancho} ${unidadEntrada} → ${area.toFixed(6)} m²`
      );
    });
    let restaHuecos = 0;
    huecos.forEach((h, i) => {
      const aHueco = L(h.largo) * L(h.ancho) * h.cantidad;
      restaHuecos += aHueco;
      desglose.push(
        `Hueco ${i + 1}: ${h.cantidad} × (${h.largo} × ${h.ancho} ${unidadEntrada}) → ${aHueco.toFixed(6)} m²`
      );
    });
    total = bruto - restaHuecos;
    desglose.push(`Subtotal superficies: ${bruto.toFixed(6)} m²`);
    if (restaHuecos > 0) {
      desglose.push(`Resta huecos: ${restaHuecos.toFixed(6)} m²`);
    }
    desglose.push(`Total neto: ${total.toFixed(6)} m²`);
  } else if (tipo === 'volumen') {
    dimensiones.forEach((d, i) => {
      const vol = L(d.largo) * L(d.ancho) * L(d.alto!);
      total += vol;
      desglose.push(
        `Volumen ${i + 1}: ${d.largo} × ${d.ancho} × ${d.alto} ${unidadEntrada} → ${vol.toFixed(6)} m³`
      );
    });
    desglose.push(`Total: ${total.toFixed(6)} m³`);
  } else if (tipo === 'lineal') {
    dimensiones.forEach((d, i) => {
      const len = L(d.largo);
      total += len;
      desglose.push(
        `Tramo ${i + 1}: largo ${d.largo} ${unidadEntrada} → ${len.toFixed(6)} ml`
      );
    });
    desglose.push(`Total lineal: ${total.toFixed(6)} ml`);
  } else {
    dimensiones.forEach((d, i) => {
      const p = 2 * (L(d.largo) + L(d.ancho));
      total += p;
      desglose.push(
        `Rectángulo ${i + 1}: perímetro 2×(${d.largo}+${d.ancho}) ${unidadEntrada} → ${p.toFixed(6)} ml`
      );
    });
    desglose.push(`Total perímetro: ${total.toFixed(6)} ml`);
  }

  const totalRedondeado = Math.round(total * 1e9) / 1e9;

  const out: {
    tipo: TipoMedicion;
    total: number;
    unidad: 'm²' | 'm³' | 'ml';
    desglose: string[];
    descripcion?: string;
  } = {
    tipo,
    total: totalRedondeado,
    unidad: unidadSalida,
    desglose,
  };
  if (descripcion !== undefined) {
    out.descripcion = descripcion;
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, business_id, historial, imagen, imagen_mime } = body;

    const mensajeTrim = typeof mensaje === 'string' ? mensaje.trim() : '';
    const imagenDataUrl = normalizarImagenVision(imagen, imagen_mime);

    if (!mensajeTrim && !imagenDataUrl) {
      return NextResponse.json(
        {
          error:
            'Envía un mensaje de texto o una imagen válida (base64 o data URL image/*)',
        },
        { status: 400 }
      );
    }
    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id es requerido' },
        { status: 400 }
      );
    }

    const historialValido = Array.isArray(historial)
      ? historial.filter(
          (m: unknown) =>
            m &&
            typeof m === 'object' &&
            'role' in m &&
            'content' in m &&
            (m as { role: string }).role !== 'system' &&
            typeof (m as { content: unknown }).content === 'string'
        ).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      : [];

    const supabase = createServiceClient();
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();
    const { data: profile, error: profileError } = await supabase
      .from('business_profiles')
      .select('nombre, sector, descripcion, servicios, tarifas, contexto_adicional')
      .eq('id', business_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'No se encontró el perfil del negocio' },
        { status: 404 }
      );
    }

    const nombre = profile.nombre ?? 'el negocio';
    const sector = profile.sector ?? 'no especificado';
    const descripcion = profile.descripcion ?? '';
    const servicios = profile.servicios ?? '';
    const tarifas = profile.tarifas ?? '';
    const contexto_adicional = profile.contexto_adicional ?? '';

    const fechaActual = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const ahora = new Date().toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let agendaContextoPrimerMensaje = '';
    const esPrimerMensajeConversacion =
      historialValido.length === 0 || historialValido.length === 1;

    if (esPrimerMensajeConversacion) {
      const tzAgenda = 'Europe/Madrid';
      const hoyYmd = formatYmdInTimeZone(new Date(), tzAgenda);
      const mananaYmd = addDaysToYmd(hoyYmd, 1);

      const { data: agendaRows, error: agendaError } = await supabase
        .from('agenda')
        .select('titulo, fecha, hora')
        .eq('business_id', business_id)
        .in('fecha', [hoyYmd, mananaYmd])
        .order('fecha', { ascending: true });

      if (!agendaError && agendaRows && agendaRows.length > 0) {
        const lineas = agendaRows.map(
          (row: { titulo?: string | null; fecha?: string | null; hora?: string | null }) => {
            const titulo = String(row.titulo ?? '').trim() || 'Evento';
            const fecha = row.fecha ?? '';
            const cuando =
              fecha === hoyYmd ? 'hoy' : fecha === mananaYmd ? 'mañana' : fecha;
            const horaStr = row.hora != null && String(row.hora).trim()
              ? ` a las ${String(row.hora).trim()}`
              : '';
            return `- ${titulo} (${cuando}${horaStr})`;
          }
        );
        agendaContextoPrimerMensaje = `

PRIMER MENSAJE — Eventos en agenda (solo hoy y mañana; fechas en calendario local del negocio):
${lineas.join('\n')}

Al inicio de tu respuesta, antes de atender lo que pide el usuario, menciona de forma breve y natural (una o dos frases, tono coloquial) lo relevante de estos eventos; no hagas una lista numerada ni viñetas. Puedes usar fórmulas del estilo "Por cierto, ..." y luego enlazar con "Dicho esto," o similar antes de seguir con su petición.`;
      }
    }

    const systemPrompt = `Fecha y hora actual: ${ahora}. Usa esta información para saludos, recordatorios y cualquier referencia temporal.
Eres el asistente IA de ${nombre}, un negocio de ${sector}.
${descripcion}
Servicios que ofrece: ${servicios}
Tarifas aproximadas: ${tarifas}
Información adicional: ${contexto_adicional}
Responde siempre de forma profesional, concisa y en español.

IMPORTANTE — herramientas de creación en base de datos:
- La herramienta "crear_presupuesto" SOLO debe llamarse cuando el usuario pide EXPLÍCITAMENTE crear, generar o hacer un presupuesto NUEVO (p. ej. "crea un presupuesto", "genera un presupuesto para...", "hazme un presupuesto"). NO la uses si solo pregunta por presupuestos existentes, menciona la palabra "presupuesto" en contexto informativo, o quiere ver/listar/consultar presupuestos (usa entonces "listar_presupuestos" u "obtener_presupuestos_pendientes").
- La herramienta "crear_factura" SOLO cuando pida EXPLÍCITAMENTE crear/generar/registrar una factura nueva. Para ver o listar facturas usa "listar_facturas" u "obtener_facturas_pendientes", sin crear.
- La herramienta "crear_albaran" SOLO cuando pida EXPLÍCITAMENTE crear/generar un albarán nuevo. Para consultar o listar albaranes usa "listar_albaranes" u "obtener_albaranes_pendientes", sin crear.

Si el usuario solo quiere información o listados, responde con texto y/o las herramientas de listado o pendientes; nunca invoques crear_* en esos casos.

Estado y edición de presupuestos, facturas y albaranes:
- Estados válidos al cambiar estado: pendiente, aceptado, rechazado, facturado, pagado.
- "cambiar_estado_presupuesto", "cambiar_estado_factura" y "cambiar_estado_albaran" requieren el id (UUID) del documento y el estado deseado.
- Si el usuario identifica un documento por cliente o contexto (p. ej. "acepta el presupuesto de Juan Mari", "marca como pagada la factura de…"), primero usa "listar_presupuestos", "listar_facturas" o "listar_albaranes" para obtener el id correcto (y desambiguar si hay varios), y después llama a la herramienta cambiar_estado_* correspondiente.
- Para modificar datos sin cambiar solo el estado, usa "editar_presupuesto", "editar_factura" o "editar_albaran" con el id y solo los campos que deban actualizarse (cliente_nombre, importe_total, descripcion). En presupuestos, "descripcion" actualiza el texto del presupuesto guardado (presupuesto_generado).

Si te piden explícitamente un presupuesto nuevo, usa las tarifas como referencia y genera uno estructurado en la respuesta y, si procede, llama a "crear_presupuesto" con el texto generado.
Cuando el usuario pida generar una factura, sigue este flujo:
- Si el usuario no ha dado el desglose completo, primero pregunta:
  - Nombre del cliente y NIF/CIF si lo tiene
  - Conceptos de mano de obra: horas trabajadas y tarifa por hora
  - Materiales utilizados: nombre, cantidad y precio unitario de cada uno
  - Desplazamiento u otros conceptos adicionales si los hay
- Una vez tengas todos los datos, genera la factura estructurada con:
  - Líneas detalladas: concepto, cantidad, precio unitario, importe
  - Subtotal (base imponible)
  - IVA 21 %
  - Total
Cuando el usuario pida generar una factura, estructura la respuesta con: número de factura, cliente, NIF/CIF si lo tienes, descripción de trabajos, base imponible, IVA (21%) y total.
Cuando el usuario pida generar un albarán, estructura la respuesta con: cliente, descripción de trabajos realizados, fecha y total si aplica.
Siempre confirma al usuario que has guardado el documento en el sistema.
Al inicio de cada conversación, si hay mensajes pendientes de clientes, menciónalos proactivamente.
Puedes ayudar al usuario a gestionar mensajes de clientes, generar presupuestos, facturas y albaranes.

Envío de emails (Gmail):
- La herramienta "enviar_email" no envía el correo de inmediato: deja un borrador pendiente de aprobación del usuario en el chat.
- Después de llamarla con destinatario, asunto y cuerpo, muestra en tu respuesta el borrador completo (para, asunto, texto) y advierte claramente que el usuario debe pulsar "Enviar" o "Cancelar" en el panel para confirmar o descartar el envío.

Clasificación de emails urgentes:
- Un email es URGENTE si cumple alguno de estos criterios:
  - Contiene palabras clave en asunto o cuerpo: "urgente", "importante", "presupuesto", "factura pendiente", "pago", "vencimiento", "plazo", "impago", "reclamación", "queja", "problema", "avería", "emergencia".
  - Es de un cliente conocido (remitente presente en historial de presupuestos/facturas).
  - Lleva más de 48h sin leer.
  - Es respuesta a un presupuesto enviado.
- Un email es NORMAL si no cumple ninguno de los criterios anteriores.

Vista visual (panel modal / canvas):
- Flujo obligatorio cuando el usuario pida ver datos "en tabla", "en vista", "en panel", "visualiza" o "canvas":
  1) Llama primero a la tool de listado que corresponda (listar_presupuestos, listar_facturas, listar_albaranes, leer_emails_recientes para emails, etc.) y espera su resultado.
  2) Con el array de resultados obtenido en el paso 1, llama a "mostrar_vista_visual" pasando en "datos" ese array completo (los mismos objetos que devolvió la tool, normalmente bajo la clave "items" debes expandirlos al array "datos").
  3) NUNCA llames a "mostrar_vista_visual" con "datos" vacío ni sin haber ejecutado antes la tool de listado correspondiente en ese turno o inmediatamente antes en la misma conversación con datos frescos.
- IMPORTANTE: Para mostrar_vista_visual, SIEMPRE debes obtener los datos primero con la tool de listado correspondiente (listar_presupuestos, listar_facturas, listar_albaranes, etc.). Nunca llames a mostrar_vista_visual con datos vacíos. El campo datos debe contener el array completo devuelto por la tool de listado.
- Para emails usa "leer_emails_recientes" y pasa en "datos" el array "items" que devuelve. Para gastos o diario, solo usa mostrar_vista_visual si ya tienes filas concretas de una tool previa en el mismo flujo; si no existe tool de listado, obtén o confirma los datos antes de abrir el panel.
- No uses "mostrar_vista_visual" para listados habituales en el chat sin petición explícita de vista visual.
- Tras llamar a "mostrar_vista_visual", responde en el chat con un mensaje breve del estilo: "Abriendo vista visual de [titulo]..."

Medidas y cálculos de obra:
- Cuando el usuario mencione medidas, dimensiones, metros cuadrados/cúbicos, perímetros, metros lineales o cálculos de obra, DEBES usar la herramienta "calcular_medicion". Extrae del texto del usuario los números (largo, ancho, alto si aplica), el tipo de cálculo (superficie, volumen, lineal, perimetro), huecos a restar en superficies si los indica, y la unidad (m o cm).
- NUNCA calcules tú en texto los totales de obra: siempre llama primero a "calcular_medicion" y basa la respuesta en el resultado que devuelve la herramienta (total, unidad, desglose).

Tickets y facturas (imagen adjunta / OCR):
- Si el mensaje incluye una imagen de ticket o factura, analízala con visión y extrae: proveedor o comercio, importe sin IVA (base imponible), cuantía de IVA, importe total, fecha del documento (YYYY-MM-DD si es posible) y una breve descripción del gasto.
- En el MISMO turno en el que recibes por primera vez esa imagen en el mensaje del usuario, NO llames a "registrar_gasto_ticket". Primero muestra claramente en texto los datos que hayas podido leer y termina preguntando si debe registrar el gasto (p. ej. "¿Registro este gasto?").
- Llama a "registrar_gasto_ticket" solo cuando el usuario confirme de forma explícita en un mensaje posterior (sí, adelante, regístralo, confirmo, vale…). Si corrige cifras o datos, refleja los valores acordados en la tool y, si hace falta, vuelve a pedir confirmación antes de registrar.
- Los importes deben ser números coherentes (importe sin IVA, IVA e importe total); si algo no se lee bien, dilo y pide aclaración en lugar de inventar.
- Cuando "registrar_gasto_ticket" devuelva ok y hayas confirmado al usuario que el gasto se guardó, añade siempre en tu respuesta (en el mismo mensaje): "¿Quieres vincularlo a algún albarán o factura? Dime el número o el nombre del cliente y lo busco."
- NO llames a "vincular_gasto" por iniciativa propia ni en ese mismo turno: espera a que el usuario indique a qué documento enlazarlo. Si menciona número de factura/albarán o nombre de cliente, primero usa "listar_facturas" o "listar_albaranes" para localizar el UUID correcto y, cuando lo tengas claro, llama a "vincular_gasto" con gasto_id (el id devuelto al registrar) y documentos: [{ tipo, id }].

Diario de obra:
- Usa "crear_entrada_diario" cuando el usuario quiera registrar el avance de una obra (texto dictado o escrito): obligatorio obra_nombre; opcional dirección, texto, fotos y videos como URLs (tras subir archivos al almacenamiento del diario si el flujo lo permite).
- Tras crear la entrada, si la tool devuelve el mensaje con la pregunta del PDF, puedes repetir o reforzar la pregunta al usuario.
- Usa "generar_pdf_diario" cuando pida exportar o descargar el diario completo de una obra; necesitas el nombre exacto de la obra. La tool devuelve una URL firmada para descarga.

Fecha actual: ${fechaActual}
Cuando generes presupuestos, usa esta fecha como fecha del presupuesto.${agendaContextoPrimerMensaje}`;

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'obtener_presupuestos_pendientes',
          description:
            'Obtiene presupuestos pendientes del negocio actual con cliente, importe y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_facturas_pendientes',
          description:
            'Obtiene facturas pendientes del negocio actual con cliente, importe y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_albaranes_pendientes',
          description: 'Obtiene albaranes pendientes del negocio actual con cliente y fecha',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_presupuestos',
          description:
            'Lista los últimos 10 presupuestos del negocio (todos los estados). Úsala cuando el usuario pida ver, consultar o listar sus presupuestos sin crear uno nuevo.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_facturas',
          description:
            'Lista las últimas 10 facturas del negocio. Úsala cuando el usuario pida ver, consultar o listar facturas sin crear una nueva.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_albaranes',
          description:
            'Lista los últimos 10 albaranes del negocio. Úsala cuando el usuario pida ver, consultar o listar albaranes sin crear uno nuevo.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_presupuesto',
          description:
            'Actualiza el estado de un presupuesto por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_presupuestos antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_factura',
          description:
            'Actualiza el estado de una factura por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_facturas antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cambiar_estado_albaran',
          description:
            'Actualiza el estado de un albarán por id. Estados: pendiente, aceptado, rechazado, facturado, pagado. Si no tienes el id, usa listar_albaranes antes.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              estado: {
                type: 'string',
                enum: [...ESTADOS_DOC],
                description: 'Nuevo estado',
              },
            },
            required: ['id', 'estado'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_presupuesto',
          description:
            'Actualiza un presupuesto existente (cliente_nombre, importe_total y/o descripcion del texto del presupuesto). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del presupuesto' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Importe total' },
              descripcion: {
                type: 'string',
                description: 'Nuevo texto del presupuesto (sustituye presupuesto_generado)',
              },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_factura',
          description:
            'Actualiza una factura existente (cliente_nombre, importe_total como total con IVA, y/o descripcion de trabajos). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID de la factura' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total con IVA (actualiza base e IVA al 21%)' },
              descripcion: { type: 'string', description: 'Descripción / conceptos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_albaran',
          description:
            'Actualiza un albarán existente (cliente_nombre, importe_total, y/o descripcion). Requiere id; indica solo los campos que cambien.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del albarán' },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
              importe_total: { type: 'number', description: 'Total' },
              descripcion: { type: 'string', description: 'Descripción de trabajos (descripcion_trabajos)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_presupuesto',
          description:
            'Guarda en el sistema un presupuesto NUEVO ya redactado. Solo llamar si el usuario pidió explícitamente crear/generar un presupuesto nuevo. Requiere el texto completo del presupuesto.',
          parameters: {
            type: 'object',
            properties: {
              texto_presupuesto: {
                type: 'string',
                description: 'Texto completo del presupuesto a guardar',
              },
              cliente_nombre: { type: 'string', description: 'Nombre del cliente si se conoce' },
              importe_total: { type: 'number', description: 'Importe total si se conoce' },
            },
            required: ['texto_presupuesto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_factura',
          description:
            'Registra en el sistema una factura NUEVA. Solo si el usuario pidió explícitamente crear/generar una factura.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción o conceptos de la factura',
              },
              total: { type: 'number', description: 'Total con IVA si aplica' },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_albaran',
          description:
            'Registra en el sistema un albarán NUEVO. Solo si el usuario pidió explícitamente crear/generar un albarán.',
          parameters: {
            type: 'object',
            properties: {
              descripcion_trabajos: {
                type: 'string',
                description: 'Descripción de trabajos o entrega',
              },
              total: { type: 'number', description: 'Total opcional' },
              cliente_nombre: { type: 'string', description: 'Cliente si se conoce' },
            },
            required: ['descripcion_trabajos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'obtener_mensajes_pendientes',
          description:
            'Obtiene respuestas IA del negocio pendientes de aprobación (sin aprobar ni rechazar): texto generado, borrador editado y conversación asociada',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'leer_emails_recientes',
          description:
            'Lee los últimos 5 emails recientes del inbox del usuario conectado y devuelve remitente, asunto y resumen del cuerpo',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'enviar_email',
          description:
            'Prepara un borrador de email para Gmail: NO lo envía hasta que el usuario lo apruebe en el chat. Usa cuando quieran enviar un correo; requiere destinatario, asunto y cuerpo. Tras llamarla, explica el borrador y que debe aprobar el envío.',
          parameters: {
            type: 'object',
            properties: {
              destinatario: { type: 'string' },
              asunto: { type: 'string' },
              cuerpo: { type: 'string' },
            },
            required: ['destinatario', 'asunto', 'cuerpo'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_recordatorio',
          description:
            'Crea un recordatorio o evento en la agenda del negocio con título, fecha (YYYY-MM-DD) y opcionalmente hora',
          parameters: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Título del recordatorio' },
              fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
              hora: { type: 'string', description: 'Hora opcional (texto libre)' },
            },
            required: ['titulo', 'fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_recordatorio',
          description:
            'Actualiza un recordatorio existente en la agenda del negocio. Indica el id del evento y al menos uno de: título, fecha (YYYY-MM-DD) u hora',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
              titulo: { type: 'string', description: 'Nuevo título' },
              fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
              hora: { type: 'string', description: 'Nueva hora (texto libre) o vacío para quitar' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_recordatorio',
          description: 'Elimina un recordatorio de la agenda del negocio por su id',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID del evento en agenda' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'calcular_medicion',
          description:
            'Calcula medidas de obra en JavaScript (superficie m², volumen m³, metros lineales ml, perímetro). Úsala siempre que el usuario pida cálculos con dimensiones; extrae largo, ancho y alto del mensaje. No calcules totales mentalmente: pasa los datos aquí.',
          parameters: {
            type: 'object',
            properties: {
              tipo: {
                type: 'string',
                enum: ['superficie', 'volumen', 'lineal', 'perimetro'],
                description:
                  'superficie: suma de largo×ancho menos huecos; volumen: suma de largo×ancho×alto; lineal: suma de largos; perimetro: suma de 2×(largo+ancho) por cada rectángulo',
              },
              dimensiones: {
                type: 'array',
                description:
                  'Lista de piezas o tramos. Para lineal solo se usa largo de cada objeto.',
                items: {
                  type: 'object',
                  properties: {
                    largo: { type: 'number' },
                    ancho: { type: 'number' },
                    alto: {
                      type: 'number',
                      description: 'Obligatorio si tipo es volumen',
                    },
                  },
                  required: ['largo', 'ancho'],
                  additionalProperties: false,
                },
              },
              huecos: {
                type: 'array',
                description:
                  'Opcional. Solo aplica a superficie: resta cantidad × largo × ancho por cada hueco',
                items: {
                  type: 'object',
                  properties: {
                    cantidad: { type: 'number' },
                    largo: { type: 'number' },
                    ancho: { type: 'number' },
                  },
                  required: ['cantidad', 'largo', 'ancho'],
                  additionalProperties: false,
                },
              },
              unidad: {
                type: 'string',
                enum: ['m', 'cm'],
                description: 'Unidad en la que vienen largo, ancho y alto. Por defecto metros.',
              },
              descripcion: {
                type: 'string',
                description: 'Opcional. Qué elemento se está midiendo (p. ej. "habitación principal")',
              },
            },
            required: ['tipo', 'dimensiones'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'registrar_gasto_ticket',
          description:
            'Registra en la base de datos un gasto extraído de un ticket o factura. Solo después de que el usuario haya confirmado explícitamente tras tu resumen y la pregunta "¿Registro este gasto?".',
          parameters: {
            type: 'object',
            properties: {
              proveedor: { type: 'string', description: 'Nombre del comercio o proveedor' },
              importe: {
                type: 'number',
                description: 'Importe sin IVA (base imponible)',
              },
              iva: { type: 'number', description: 'Cuantía del IVA en la misma moneda' },
              importe_total: { type: 'number', description: 'Total con IVA' },
              fecha: {
                type: 'string',
                description: 'Fecha del documento en formato YYYY-MM-DD',
              },
              descripcion: {
                type: 'string',
                description: 'Resumen breve del concepto del gasto (opcional)',
              },
            },
            required: ['proveedor', 'importe', 'iva', 'importe_total', 'fecha'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'vincular_gasto',
          description:
            'Vincula un gasto registrado a una o varias facturas o albaranes. Usar después del OCR si el usuario quiere asociar el ticket a un documento.',
          parameters: {
            type: 'object',
            properties: {
              gasto_id: {
                type: 'string',
                description: 'UUID del gasto a vincular',
              },
              documentos: {
                type: 'array',
                description: 'Lista de documentos a los que vincular el gasto',
                items: {
                  type: 'object',
                  properties: {
                    tipo: { type: 'string', enum: ['factura', 'albaran'] },
                    id: { type: 'string', description: 'UUID del documento' },
                  },
                  required: ['tipo', 'id'],
                  additionalProperties: false,
                },
              },
            },
            required: ['gasto_id', 'documentos'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_entrada_diario',
          description:
            'Crea una entrada en el diario de obra con texto, fotos y/o vídeos. El texto puede venir de lo que ha dictado el usuario por voz o escrito. Usar cuando el usuario quiera registrar el avance de una obra.',
          parameters: {
            type: 'object',
            properties: {
              obra_nombre: {
                type: 'string',
                description:
                  "Nombre o identificador de la obra (ej: 'Reforma Calle Mayor', 'Casa García')",
              },
              obra_direccion: {
                type: 'string',
                description: 'Dirección física de la obra',
              },
              texto: {
                type: 'string',
                description:
                  'Descripción del trabajo realizado, observaciones, materiales usados, etc.',
              },
              fotos: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs de las fotos subidas previamente',
              },
              videos: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs de los vídeos subidos previamente',
              },
            },
            required: ['obra_nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generar_pdf_diario',
          description:
            'Genera un PDF con todas las entradas del diario de una obra ordenadas por fecha.',
          parameters: {
            type: 'object',
            properties: {
              obra_nombre: {
                type: 'string',
                description: 'Nombre de la obra cuyo diario se quiere exportar',
              },
            },
            required: ['obra_nombre'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mostrar_vista_visual',
          description:
            'Muestra una lista de documentos, emails, gastos o entradas de diario en un panel visual modal. Usar cuando el usuario pida explícitamente ver datos en tabla, vista, panel o canvas. No usar para listados normales en el chat. IMPORTANTE: Solo llamar después de obtener datos con listar_presupuestos, listar_facturas, listar_albaranes, leer_emails_recientes u otra tool de listado aplicable. El campo datos debe ser el array completo devuelto por esa tool (p. ej. el contenido del array "items" de la respuesta).',
          parameters: {
            type: 'object',
            properties: {
              tipo: {
                type: 'string',
                enum: [
                  'presupuestos',
                  'facturas',
                  'albaranes',
                  'emails',
                  'gastos',
                  'diario',
                ],
                description: 'Tipo de datos a mostrar',
              },
              titulo: {
                type: 'string',
                description: "Título del panel, ej: 'Últimos presupuestos', 'Emails recientes'",
              },
              datos: {
                type: 'array',
                description:
                  'Array completo de filas obtenido en la respuesta de la tool de listado previa (p. ej. todos los elementos de "items"); no debe estar vacío.',
                items: { type: 'object' },
              },
            },
            required: ['tipo', 'titulo', 'datos'],
            additionalProperties: false,
          },
        },
      },
    ];

    const textoUsuario =
      mensajeTrim ||
      '(El usuario adjuntó una imagen, posiblemente un ticket o factura. Analízala e indica qué datos ves.)';

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: textoUsuario },
    ];
    if (imagenDataUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imagenDataUrl, detail: 'auto' },
      });
    }

    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historialValido.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const maxTokensAgente = imagenDataUrl ? 1600 : 800;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: maxTokensAgente,
    });

    const firstMessage = completion.choices[0]?.message;

    const getGmailAccessToken = async () => {
      if (!authUser?.id) return { error: 'No hay usuario autenticado para Gmail' } as const;
      const r = await getGmailAccessTokenForUser(authUser.id);
      if ('error' in r) {
        return { error: r.error } as const;
      }
      return { accessToken: r.accessToken } as const;
    };

    const runTool = async (toolName: string, toolArgs: Record<string, unknown>) => {
      console.log('Ejecutando tool:', toolName);
      switch (toolName) {
        case 'obtener_presupuestos_pendientes': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('cliente_nombre, importe_total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.importe_total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_facturas_pendientes': {
          const { data, error } = await supabase
            .from('facturas')
            .select('cliente_nombre, total, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              importe: r.total ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'obtener_albaranes_pendientes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('cliente_nombre, fecha')
            .eq('business_id', business_id)
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: false })
            .limit(50);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: any) => ({
              cliente: r.cliente_nombre ?? null,
              fecha: r.fecha ?? null,
            })),
          };
        }
        case 'listar_presupuestos': {
          const { data, error } = await supabase
            .from('presupuestos')
            .select('id, cliente_nombre, importe_total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_presupuestos Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              cliente_nombre?: string | null;
              importe_total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.importe_total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_facturas': {
          const { data, error } = await supabase
            .from('facturas')
            .select('id, numero_factura, cliente_nombre, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_facturas Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              numero_factura?: string | null;
              cliente_nombre?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              numero_factura: r.numero_factura ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'listar_albaranes': {
          const { data, error } = await supabase
            .from('albaranes')
            .select('id, numero_albaran, cliente_nombre, total, fecha, estado')
            .eq('business_id', business_id)
            .order('fecha', { ascending: false })
            .limit(10);
          if (error) {
            console.error('[agente] listar_albaranes Supabase:', error);
            return { error: error.message };
          }
          return {
            items: (data ?? []).map((r: {
              id?: string;
              numero_albaran?: string | null;
              cliente_nombre?: string | null;
              total?: number | null;
              fecha?: string | null;
              estado?: string | null;
            }) => ({
              id: r.id ?? null,
              numero_albaran: r.numero_albaran ?? null,
              cliente: r.cliente_nombre ?? null,
              importe_total: r.total ?? null,
              fecha: r.fecha ?? null,
              estado: r.estado ?? null,
            })),
          };
        }
        case 'cambiar_estado_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_factura': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'cambiar_estado_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          const estado = parseEstadoDoc(toolArgs.estado);
          if (!id) return { error: 'id es obligatorio' };
          if (!estado) {
            return {
              error:
                'estado inválido; use uno de: pendiente, aceptado, rechazado, facturado, pagado',
            };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update({ estado })
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_presupuesto': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            importe_total?: number;
            presupuesto_generado?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.importe_total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.presupuesto_generado = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('presupuestos')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el presupuesto o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_factura': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: {
            cliente_nombre?: string;
            total?: number;
            base_imponible?: number;
            iva?: number;
            descripcion_trabajos?: string;
          } = {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const totalNum = Number(toolArgs.importe_total);
            if (!Number.isFinite(totalNum)) {
              return { error: 'importe_total debe ser un número válido' };
            }
            const baseImponible = totalNum ? totalNum / 1.21 : 0;
            const iva = totalNum ? totalNum - baseImponible : 0;
            updates.total = totalNum;
            updates.base_imponible = Number.isFinite(baseImponible) ? baseImponible : 0;
            updates.iva = Number.isFinite(iva) ? iva : 0;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('facturas')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró la factura o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_albaran': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) return { error: 'id es obligatorio' };
          const updates: { cliente_nombre?: string; total?: number; descripcion_trabajos?: string } =
            {};
          if (toolArgs.cliente_nombre !== undefined) {
            const c = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
            if (!c) return { error: 'cliente_nombre no puede estar vacío' };
            updates.cliente_nombre = c;
          }
          if (toolArgs.importe_total !== undefined) {
            const n = Number(toolArgs.importe_total);
            if (!Number.isFinite(n)) return { error: 'importe_total debe ser un número válido' };
            updates.total = n;
          }
          if (toolArgs.descripcion !== undefined) {
            const d = String(toolArgs.descripcion ?? '').trim();
            if (!d) return { error: 'descripcion no puede estar vacía' };
            updates.descripcion_trabajos = d;
          }
          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (cliente_nombre, importe_total o descripcion)' };
          }
          const { data: row, error } = await supabase
            .from('albaranes')
            .update(updates)
            .eq('id', id)
            .eq('business_id', business_id)
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          if (!row?.id) {
            return { error: 'No se encontró el albarán o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'crear_presupuesto': {
          const texto = String(toolArgs.texto_presupuesto ?? '').trim();
          if (!texto) {
            return { error: 'texto_presupuesto es obligatorio' };
          }
          const clienteNombre =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';
          const importeRaw = toolArgs.importe_total;
          const importe_total =
            importeRaw != null && Number.isFinite(Number(importeRaw))
              ? Number(importeRaw)
              : null;

          const { error } = await supabase.from('presupuestos').insert({
            business_id,
            mensaje_cliente: mensaje,
            presupuesto_generado: texto,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'borrador',
            ...(importe_total != null && { importe_total }),
            ...(clienteNombre.length > 0 && { cliente_nombre: clienteNombre }),
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_factura': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : 0;
          const baseImponible = totalNum ? totalNum / 1.21 : 0;
          const iva = totalNum ? totalNum - baseImponible : 0;

          const { error } = await supabase.from('facturas').insert({
            business_id,
            cliente_nombre: null,
            descripcion_trabajos: desc,
            base_imponible: Number.isFinite(baseImponible) ? baseImponible : 0,
            iva: Number.isFinite(iva) ? iva : 0,
            total: Number.isFinite(totalNum) ? totalNum : 0,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'crear_albaran': {
          const desc = String(toolArgs.descripcion_trabajos ?? '').trim();
          if (!desc) {
            return { error: 'descripcion_trabajos es obligatorio' };
          }
          const totalRaw = toolArgs.total;
          const totalNum =
            totalRaw != null && Number.isFinite(Number(totalRaw))
              ? Number(totalRaw)
              : null;
          const clienteAlb =
            toolArgs.cliente_nombre != null
              ? String(toolArgs.cliente_nombre).trim().slice(0, 255)
              : '';

          const { error } = await supabase.from('albaranes').insert({
            business_id,
            cliente_nombre: clienteAlb.length > 0 ? clienteAlb : null,
            descripcion_trabajos: desc,
            total: totalNum,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'pendiente',
          });

          if (error) return { error: error.message };
          return { ok: true };
        }
        case 'obtener_mensajes_pendientes': {
          const { data: convRows, error: convError } = await supabase
            .from('conversation_history')
            .select('conversation_id')
            .eq('business_id', business_id);

          if (convError) {
            console.log('Resultado mensajes:', null, convError);
            return { error: convError.message };
          }

          const conversationIds = [
            ...new Set(
              (convRows ?? [])
                .map((r: { conversation_id?: string | null }) => r.conversation_id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
            ),
          ];

          if (conversationIds.length === 0) {
            console.log('Resultado mensajes:', [], null);
            return { items: [] };
          }

          const { data, error } = await supabase
            .from('ai_responses')
            .select(
              'id, conversation_id, created_at, ai_response, edited_response, approved_at, rejected_at'
            )
            .in('conversation_id', conversationIds)
            .is('approved_at', null)
            .is('rejected_at', null)
            .order('created_at', { ascending: false })
            .limit(50);

          console.log('Resultado mensajes:', data, error);
          if (error) return { error: error.message };
          return {
            items: (data ?? []).map((r: {
              id?: string;
              conversation_id?: string | null;
              created_at?: string | null;
              ai_response?: string | null;
              edited_response?: string | null;
              approved_at?: string | null;
              rejected_at?: string | null;
            }) => ({
              id: r.id ?? null,
              conversation_id: r.conversation_id ?? null,
              creado_en: r.created_at ?? null,
              respuesta_ia: r.ai_response ?? null,
              borrador_editado: r.edited_response ?? null,
              pendiente_de_aprobacion: !r.approved_at && !r.rejected_at,
            })),
          };
        }
        case 'leer_emails_recientes': {
          const tokenResult = await getGmailAccessToken();
          if ('error' in tokenResult) return { error: tokenResult.error };
          const accessToken = tokenResult.accessToken;

          const listRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (!listRes.ok) {
            return { error: 'No se pudieron leer emails recientes de Gmail' };
          }

          const listJson = (await listRes.json()) as {
            messages?: Array<{ id: string }>;
          };

          const msgIds = listJson.messages ?? [];
          const items: Array<{ remitente: string | null; asunto: string | null; resumen: string | null }> = [];

          for (const msg of msgIds) {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );
            if (!msgRes.ok) continue;

            const msgJson = (await msgRes.json()) as {
              snippet?: string;
              payload?: { headers?: Array<{ name?: string; value?: string }> };
            };

            const headers = msgJson.payload?.headers ?? [];
            const from =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
            const subject =
              headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ??
              null;

            items.push({
              remitente: from,
              asunto: subject,
              resumen: msgJson.snippet ?? null,
            });
          }

          return { items };
        }
        case 'enviar_email': {
          const destinatario = String(toolArgs.destinatario ?? '').trim();
          const asunto = String(toolArgs.asunto ?? '').trim();
          const cuerpo = String(toolArgs.cuerpo ?? '').trim();

          if (!destinatario || !asunto || !cuerpo) {
            return { error: 'Faltan parámetros obligatorios para enviar email' };
          }

          return {
            tipo: 'email_pendiente_aprobacion',
            para: destinatario,
            asunto,
            cuerpo,
          };
        }
        case 'crear_recordatorio': {
          const titulo = String(toolArgs.titulo ?? '').trim();
          const fechaRaw = String(toolArgs.fecha ?? '').trim();
          const horaOpt = toolArgs.hora != null ? String(toolArgs.hora).trim() : '';

          if (!titulo) {
            return { error: 'El título del recordatorio es obligatorio' };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
            return { error: 'La fecha debe tener formato YYYY-MM-DD' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const insertPayload: {
            business_id: string;
            titulo: string;
            fecha: string;
            hora?: string;
          } = {
            business_id: businessIdBody,
            titulo,
            fecha: fechaRaw,
          };
          if (horaOpt) {
            insertPayload.hora = horaOpt;
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .insert(insertPayload)
            .select('id')
            .single();

          if (error || !row?.id) {
            return { error: error?.message ?? 'No se pudo crear el recordatorio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'editar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const updates: { titulo?: string; fecha?: string; hora?: string | null } = {};
          if (toolArgs.titulo !== undefined) {
            const t = String(toolArgs.titulo ?? '').trim();
            if (!t) {
              return { error: 'El título no puede estar vacío' };
            }
            updates.titulo = t;
          }
          if (toolArgs.fecha !== undefined) {
            const f = String(toolArgs.fecha ?? '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
              return { error: 'La fecha debe tener formato YYYY-MM-DD' };
            }
            updates.fecha = f;
          }
          if (toolArgs.hora !== undefined) {
            const h = String(toolArgs.hora ?? '').trim();
            updates.hora = h.length > 0 ? h : null;
          }

          if (Object.keys(updates).length === 0) {
            return { error: 'Indica al menos un campo a actualizar (titulo, fecha u hora)' };
          }

          const { data: row, error } = await supabase
            .from('agenda')
            .update(updates)
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!row?.id) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'eliminar_recordatorio': {
          const id = String(toolArgs.id ?? '').trim();
          if (!id) {
            return { error: 'id es obligatorio' };
          }

          const businessIdBody =
            typeof body.business_id === 'string'
              ? body.business_id
              : String(body.business_id ?? '');
          if (!businessIdBody) {
            return { error: 'business_id es requerido' };
          }

          const { data: deleted, error } = await supabase
            .from('agenda')
            .delete()
            .eq('id', id)
            .eq('business_id', businessIdBody)
            .select('id')
            .maybeSingle();

          if (error) {
            return { error: error.message };
          }
          if (!deleted) {
            return { error: 'No se encontró el evento o no pertenece a este negocio' };
          }
          return { ok: true };
        }
        case 'calcular_medicion': {
          return calcularMedicionObra(toolArgs);
        }
        case 'registrar_gasto_ticket': {
          const proveedor = String(toolArgs.proveedor ?? '').trim();
          const importe = Number(toolArgs.importe);
          const iva = Number(toolArgs.iva);
          const importeTotal = Number(toolArgs.importe_total);
          const fecha = String(toolArgs.fecha ?? '').trim();
          const descripcion = String(toolArgs.descripcion ?? '').trim();

          if (!proveedor) {
            return { error: 'El proveedor es obligatorio' };
          }
          if (
            !Number.isFinite(importe) ||
            !Number.isFinite(iva) ||
            !Number.isFinite(importeTotal)
          ) {
            return { error: 'importe, iva e importe_total deben ser números válidos' };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return { error: 'La fecha debe tener formato YYYY-MM-DD' };
          }

          const businessIdGasto =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdGasto) {
            return { error: 'business_id es requerido' };
          }

          const { data: row, error } = await supabase
            .from('gastos')
            .insert({
              business_id: businessIdGasto,
              proveedor,
              importe,
              iva,
              importe_total: importeTotal,
              fecha,
              descripcion: descripcion.length > 0 ? descripcion : null,
            })
            .select('id')
            .single();

          if (error || !row?.id) {
            return { error: error?.message ?? 'No se pudo registrar el gasto' };
          }
          return { ok: true, id: row.id as string };
        }
        case 'vincular_gasto': {
          const gastoId = String(toolArgs.gasto_id ?? '').trim();
          const documentosRaw = toolArgs.documentos;

          const businessIdVinc =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdVinc) {
            return { error: 'business_id es requerido' };
          }

          const uuidRe =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (!gastoId || !uuidRe.test(gastoId)) {
            return { error: 'gasto_id debe ser un UUID válido' };
          }
          if (!Array.isArray(documentosRaw) || documentosRaw.length === 0) {
            return { error: 'documentos debe ser un array con al menos un elemento' };
          }

          const { data: gastoRow, error: gastoErr } = await supabase
            .from('gastos')
            .select('id')
            .eq('id', gastoId)
            .eq('business_id', businessIdVinc)
            .maybeSingle();

          if (gastoErr) {
            return { error: `No se pudo comprobar el gasto: ${gastoErr.message}` };
          }
          if (!gastoRow?.id) {
            return { error: 'No se encontró el gasto o no pertenece a este negocio' };
          }

          type DocItem = { tipo: 'factura' | 'albaran'; id: string };
          const documentos: DocItem[] = [];
          for (let i = 0; i < documentosRaw.length; i++) {
            const item = documentosRaw[i];
            if (!item || typeof item !== 'object') {
              return { error: `documentos[${i}] debe ser un objeto con tipo e id` };
            }
            const o = item as Record<string, unknown>;
            const tipo = String(o.tipo ?? '').toLowerCase();
            const docId = String(o.id ?? '').trim();
            if (tipo !== 'factura' && tipo !== 'albaran') {
              return {
                error: `documentos[${i}].tipo debe ser "factura" o "albaran"`,
              };
            }
            if (!docId || !uuidRe.test(docId)) {
              return { error: `documentos[${i}].id debe ser un UUID válido` };
            }
            documentos.push({ tipo: tipo as 'factura' | 'albaran', id: docId });
          }

          for (let i = 0; i < documentos.length; i++) {
            const d = documentos[i];
            const tabla = d.tipo === 'factura' ? 'facturas' : 'albaranes';
            const { data: docRow, error: docErr } = await supabase
              .from(tabla)
              .select('id')
              .eq('id', d.id)
              .eq('business_id', businessIdVinc)
              .maybeSingle();

            if (docErr) {
              return {
                error: `No se pudo comprobar el documento (${d.tipo}): ${docErr.message}`,
              };
            }
            if (!docRow?.id) {
              return {
                error: `No se encontró la ${d.tipo} indicada o no pertenece a este negocio`,
              };
            }
          }

          const filas = documentos.map((d) => ({
            business_id: businessIdVinc,
            gasto_id: gastoId,
            documento_tipo: d.tipo,
            documento_id: d.id,
          }));

          const { error: insErr } = await supabase.from('gastos_documentos').insert(filas);

          if (insErr) {
            return {
              error: `No se pudo vincular el gasto: ${insErr.message}`,
            };
          }

          const n = documentos.length;
          return {
            mensaje: `Gasto vinculado correctamente a ${n} documento(s).`,
          };
        }
        case 'crear_entrada_diario': {
          const obraNombreDiario = String(toolArgs.obra_nombre ?? '').trim();
          if (!obraNombreDiario) {
            return { error: 'obra_nombre es obligatorio' };
          }
          const businessIdDiario =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdDiario) {
            return { error: 'business_id es requerido' };
          }
          const obraDireccionDiario =
            toolArgs.obra_direccion != null
              ? String(toolArgs.obra_direccion).trim()
              : undefined;
          const textoDiario =
            toolArgs.texto != null ? String(toolArgs.texto).trim() : undefined;
          const fotosDiario = Array.isArray(toolArgs.fotos)
            ? toolArgs.fotos.filter(
                (u): u is string => typeof u === 'string' && u.trim().length > 0
              )
            : undefined;
          const videosDiario = Array.isArray(toolArgs.videos)
            ? toolArgs.videos.filter(
                (u): u is string => typeof u === 'string' && u.trim().length > 0
              )
            : undefined;

          const { data: entradaCreada, error: errDiario } = await insertDiarioObraEntry(
            supabase,
            {
              business_id: businessIdDiario,
              obra_nombre: obraNombreDiario,
              obra_direccion: obraDireccionDiario || null,
              texto: textoDiario || null,
              fotos: fotosDiario ?? null,
              videos: videosDiario ?? null,
            }
          );

          if (errDiario || !entradaCreada) {
            return {
              error: errDiario?.message ?? 'No se pudo crear la entrada del diario',
            };
          }

          const fechaLargaDiario = new Date(entradaCreada.fecha).toLocaleDateString('es-ES', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });

          return {
            mensaje: `Entrada registrada en el diario de '${entradaCreada.obra_nombre}' para el ${fechaLargaDiario}. ¿Quieres generar el PDF del diario completo de esta obra?`,
            id: entradaCreada.id,
          };
        }
        case 'mostrar_vista_visual': {
          const tipoRaw = String(toolArgs.tipo ?? '').trim();
          const titulo = String(toolArgs.titulo ?? '').trim();
          const datosRaw = toolArgs.datos;
          const allowed = new Set([
            'presupuestos',
            'facturas',
            'albaranes',
            'emails',
            'gastos',
            'diario',
          ]);
          if (!allowed.has(tipoRaw)) {
            return {
              error: `tipo inválido; use uno de: ${[...allowed].join(', ')}`,
            };
          }
          if (!titulo) {
            return { error: 'titulo es obligatorio' };
          }
          let datosNorm = normalizarDatosCanvasVista(datosRaw);

          const extraerItems = (r: unknown): unknown[] | null => {
            if (!r || typeof r !== 'object') return null;
            const o = r as Record<string, unknown>;
            if (Array.isArray(o.items)) return o.items;
            return null;
          };

          if (datosNorm.length === 0) {
            switch (tipoRaw) {
              case 'presupuestos': {
                const r = await runTool('listar_presupuestos', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback presupuestos:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'facturas': {
                const r = await runTool('listar_facturas', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback facturas:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'albaranes': {
                const r = await runTool('listar_albaranes', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback albaranes:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'emails': {
                const r = await runTool('leer_emails_recientes', {});
                const items = extraerItems(r);
                if (items) datosNorm = items;
                else if (r && typeof r === 'object' && 'error' in r) {
                  console.error(
                    '[agente] mostrar_vista_visual fallback emails:',
                    (r as { error: string }).error
                  );
                }
                break;
              }
              case 'gastos': {
                const bid =
                  typeof business_id === 'string'
                    ? business_id
                    : String(business_id ?? '');
                if (!bid) break;
                const { data, error } = await supabase
                  .from('gastos')
                  .select('id, proveedor, importe, iva, importe_total, fecha, descripcion')
                  .eq('business_id', bid)
                  .order('fecha', { ascending: false })
                  .limit(10);
                if (error) {
                  console.error('[agente] mostrar_vista_visual fallback gastos:', error);
                } else {
                  datosNorm = data ?? [];
                }
                break;
              }
              case 'diario': {
                const bid =
                  typeof business_id === 'string'
                    ? business_id
                    : String(business_id ?? '');
                if (!bid) break;
                const { data, error } = await supabase
                  .from('diario_obra')
                  .select(
                    'id, obra_nombre, obra_direccion, texto, fotos, videos, fecha, created_at'
                  )
                  .eq('business_id', bid)
                  .order('fecha', { ascending: false })
                  .limit(10);
                if (error) {
                  console.error('[agente] mostrar_vista_visual fallback diario:', error);
                } else {
                  datosNorm = data ?? [];
                }
                break;
              }
              default:
                break;
            }
          }

          return {
            accion: 'abrir_canvas',
            tipo: tipoRaw,
            titulo,
            datos: datosNorm,
          };
        }
        case 'generar_pdf_diario': {
          const obraNombrePdf = String(toolArgs.obra_nombre ?? '').trim();
          if (!obraNombrePdf) {
            return { error: 'obra_nombre es obligatorio' };
          }
          const businessIdPdfDiario =
            typeof business_id === 'string'
              ? business_id
              : String(business_id ?? '');
          if (!businessIdPdfDiario) {
            return { error: 'business_id es requerido' };
          }

          const { data: entradasPdf, error: listPdfErr } = await fetchDiarioObraEntries(
            supabase,
            businessIdPdfDiario,
            obraNombrePdf
          );
          if (listPdfErr || !entradasPdf) {
            return { error: listPdfErr?.message ?? 'No se pudieron leer las entradas' };
          }
          if (entradasPdf.length === 0) {
            return { error: 'No hay entradas en el diario para esa obra' };
          }

          let pdfBytes: Uint8Array;
          try {
            pdfBytes = await buildDiarioObraPdf(entradasPdf);
          } catch (e) {
            console.error('buildDiarioObraPdf', e);
            return { error: 'No se pudo generar el PDF' };
          }

          const dateTagPdf = new Date().toISOString().slice(0, 10);
          const safeObraPdf = sanitizeDiarioFilePart(obraNombrePdf);
          const pdfPath = `${businessIdPdfDiario}/pdfs/diario_${safeObraPdf}_${dateTagPdf}.pdf`;

          const { error: upPdfErr } = await supabase.storage
            .from('diario-obra')
            .upload(pdfPath, pdfBytes, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (upPdfErr) {
            return { error: `No se pudo guardar el PDF: ${upPdfErr.message}` };
          }

          const { data: signedPdf, error: signPdfErr } = await supabase.storage
            .from('diario-obra')
            .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);

          if (signPdfErr || !signedPdf?.signedUrl) {
            return {
              error: signPdfErr?.message ?? 'No se pudo generar enlace de descarga del PDF',
            };
          }

          return {
            mensaje:
              'PDF del diario generado. El usuario puede descargarlo con el enlace (válido varios días).',
            url: signedPdf.signedUrl,
          };
        }
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

    /** Máximo de rondas tool → API; la última usa tool_choice "none" para obligar respuesta en texto. */
    const MAX_TOOL_ROUNDS = 12;

    let emailPendienteParaCliente: { para: string; asunto: string; cuerpo: string } | null = null;

    let canvasParaCliente: { tipo: string; titulo: string; datos: unknown[] } | null = null;

    const capturarCanvas = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.accion !== 'abrir_canvas') return;
      const tipo = String(o.tipo ?? '').trim();
      const titulo = String(o.titulo ?? '').trim();
      if (!tipo || !titulo) return;
      const datos = normalizarDatosCanvasVista(o.datos);
      canvasParaCliente = { tipo, titulo, datos };
    };

    const capturarEmailPendiente = (toolResult: unknown) => {
      if (!toolResult || typeof toolResult !== 'object') return;
      const o = toolResult as Record<string, unknown>;
      if (o.tipo !== 'email_pendiente_aprobacion') return;
      if (
        typeof o.para !== 'string' ||
        typeof o.asunto !== 'string' ||
        typeof o.cuerpo !== 'string'
      ) {
        return;
      }
      emailPendienteParaCliente = {
        para: o.para,
        asunto: o.asunto,
        cuerpo: o.cuerpo,
      };
    };

    let assistantMessage = firstMessage;
    let respuesta = assistantMessage?.content ?? '';

    for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound++) {
      const toolCalls = assistantMessage?.tool_calls;
      if (!toolCalls?.length) break;

      messages.push({
        role: 'assistant',
        content: assistantMessage!.content ?? null,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch (e) {
          console.error('[agente] JSON.parse tool arguments:', toolCall.function.name, e);
          parsedArgs = {};
        }
        let toolResult: unknown;
        try {
          toolResult = await runTool(toolCall.function.name, parsedArgs);
        } catch (e) {
          console.error('[agente] runTool:', toolCall.function.name, e);
          toolResult = {
            error: e instanceof Error ? e.message : 'Error al ejecutar la herramienta',
          };
        }
        capturarEmailPendiente(toolResult);
        capturarCanvas(toolResult);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      const isLastToolRound = toolRound >= MAX_TOOL_ROUNDS - 1;
      const nextCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: isLastToolRound ? 'none' : 'auto',
        temperature: 0.7,
        max_tokens: maxTokensAgente,
      });

      assistantMessage = nextCompletion.choices[0]?.message;
      const nextContent = assistantMessage?.content;
      if (typeof nextContent === 'string' && nextContent.trim().length > 0) {
        respuesta = nextContent;
      }
    }

    if (!String(respuesta ?? '').trim()) {
      respuesta =
        'No he podido generar una respuesta en texto. Prueba a reformular la pregunta o inténtalo de nuevo.';
    }

    return NextResponse.json({
      respuesta,
      email_pendiente: emailPendienteParaCliente,
      canvas: canvasParaCliente,
    });
  } catch (error) {
    console.error('Error en /api/agente:', error);
    return NextResponse.json(
      { error: 'Error al generar la respuesta del agente' },
      { status: 500 }
    );
  }
}
