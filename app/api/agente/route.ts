import { formatYmdInTimeZone, sumarDiasYmd } from '@/lib/fechas-madrid';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import {
  capturarEmailPendiente,
  CORREO_AGENT_TOOLS,
  CORREO_HANDLED_TOOLS,
  handleCorreoAgent,
} from '@/lib/agente/modules/correo';
import { enriquecerTextoConMaps, generarLinkMaps } from '@/lib/maps';
import {
  type PrediccionMeteo,
  formatearMensajeConsultaTiempo,
  geocodeDireccion,
  getPrediccionPorCiudad,
  getPrediccionPorCoordenadas,
} from '@/lib/weather';
import {
  buildMemoriaNegocioPromptBlock,
  deleteMemoriaNegocioByClave,
  esCategoriaMemoriaValida,
  MEMORIA_CATEGORIAS,
  upsertMemoriaNegocio,
} from '@/lib/memoria-negocio';
import {
  OPERARIOS_AGENT_SYSTEM_PROMPT,
  OPERARIOS_AGENT_TOOLS,
  ejecutarConsultarHorasObra,
  ejecutarConsultarHorasOperario,
  ejecutarEliminarRegistroJornada,
  ejecutarListarOperarios,
  ejecutarRegistrarJornada,
} from '@/lib/agente/modules/operarios';
import {
  DIARIO_AGENT_SYSTEM_PROMPT,
  DIARIO_AGENT_TOOLS,
  DIARIO_HANDLED_TOOLS,
  handleDiario,
} from '@/lib/agente/modules/diario';
import {
  handlePresupuestos,
  PRESUPUESTOS_AGENT_SYSTEM_PROMPT,
  PRESUPUESTOS_AGENT_TOOLS,
  PRESUPUESTOS_HANDLED_TOOLS,
} from '@/lib/agente/modules/presupuestos';
import {
  AGENDA_AGENT_TOOLS,
  AGENDA_AGENT_SYSTEM_PROMPT,
  AGENDA_HANDLED_TOOLS,
  handleAgenda,
} from '@/lib/agente/modules/agenda';
import {
  GASTOS_AGENT_SYSTEM_PROMPT,
  GASTOS_AGENT_TOOLS,
  GASTOS_HANDLED_TOOLS,
  handleGastosAgent,
} from '@/lib/agente/modules/gastos';
import {
  DOCUMENTOS_AGENT_TOOLS,
  DOCUMENTOS_HANDLED_TOOLS,
  handleDocumentosAgent,
} from '@/lib/agente/modules/documentos';
import {
  OBRAS_CLIENTES_AGENT_TOOLS,
  OBRAS_CLIENTES_HANDLED_TOOLS,
  capturarObraFicha,
  handleObrasClientesAgent,
} from '@/lib/agente/modules/obras-clientes';
import {
  CANVAS_AGENT_TOOLS,
  handleMostrarVistaVisual,
  normalizarDatosCanvasVista,
} from '@/lib/agente/modules/canvas';
import {
  CALCULO_AGENT_TOOLS,
  handleCalcularMedicion,
} from '@/lib/agente/modules/calculo';
import { cancelarOrdenJev, confirmarOrdenJev, procesarMensajeJev } from '@/lib/jev/motor';
import { crearPendiente } from '@/lib/jev/pendientes';
import { applyPerfilioGuardrails } from '@/lib/agente/guardrails';
import { modeloAgente, parametrosGeneracion } from '@/lib/agente/modelo';
import {
  ENLACES_PDF_AGENT_TOOLS,
  ENLACES_PDF_HANDLED_TOOLS,
  handleEnlacesPdf,
} from '@/lib/agente/modules/enlaces-pdf';
import {
  TOOLS_CON_VISTA_PREVIA,
  confirmacionActiva,
  describirAccionGenerica,
  fraseHechoConDatos,
  limpiarTextoVistaPrevia,
  preguntaConfirmacion,
  prepararAccionPendiente,
  requiereConfirmacion,
  validarAccionConfirmada,
  type AccionPendiente,
} from '@/lib/agente/confirmacion';
import { construirPromptSistema, promptEspecialidad } from '@/lib/agente/prompt-sistema';
import {
  AGENTE_PROSA_TEMPERATURE,
  AGENTE_TOOLS_TEMPERATURE,
  anclarProsaAHechos,
  buildMensajeSistemaProsaAnclada,
  buildToolLoopMessages,
  esToolMutacion,
  prometeSinHacer,
  hechosMutacionDesdeEjecutado,
  idsParaPlanEjecutado,
  logAgenteTurno,
  marcaOpcionesParaHistorial,
  marcaUltimoPresupuesto,
  marcaUltimoEvento,
  leerUltimoEventoDeHistorial,
  ultimoEventoDeResultados,
  marcaUltimaFactura,
  leerUltimaFacturaDeHistorial,
  ultimaFacturaDeResultados,
  esAfirmacionSuelta,
  asistentePreguntoAlgo,
  MENSAJE_NADA_PENDIENTE,
  REGLA_SI_SUELTO,
  leerUltimoPresupuestoDeHistorial,
  ultimoPresupuestoDeResultados,
  inyectarUltimoPresupuesto,
  opcionesDeResultados,
  pareceAccionQueRequiereTool,
  plannedToolsFromAssistantToolCalls,
  prosaAncladaDirectaSiAplica,
  resolverEleccionOpcion,
  resumirToolResultParaLog,
  type PlanFuente,
} from '@/lib/agente/orquestacion';
import { extractDiarioObraObjectPath } from '@/lib/diario-obra';
import { GROUNDING_REGLAS_SISTEMA } from '@/lib/agente/modules/grounding';
import { comprobarLimiteIAAgente, respuestaLimiteIA } from '@/lib/ia/limite-uso';
import {
  type AgentIntentCategory,
  PRESUPUESTOS_AGENT_SYSTEM_PROMPT_PREFIX,
  intentPorPalabrasClave,
  intentPorSenalExplicita,
  parseAgentIntentCategory,
  toolsForAgentIntent,
  pideBorrar,
  quitarToolsDestructivasSiNoPideBorrar,
  quitarToolsCubiertasPorOrdenes,
  TOOLS_DESTRUCTIVAS,
} from '@/lib/agente/router';

let openaiCliente: OpenAI | null = null;

/** Cliente de OpenAI creado la primera vez que se usa (no al importar el módulo): así `next build` no exige OPENAI_API_KEY. */
function getOpenAI(): OpenAI {
  openaiCliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiCliente;
}

/** Suma días a una fecha civil YYYY-MM-DD. */
const addDaysToYmd = sumarDiasYmd;

const IMAGEN_VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGEN_DECODED_BYTES = 4 * 1024 * 1024;

/** URL http(s) para visión (p. ej. firmada de Storage); el sidebar envía imagenesUrls, no base64. */
function normalizarImagenUrlVision(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  return u;
}

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
    // Tras `data:` el tipo MIME va hasta el primer `;` o `,` (RFC 2397). Si usamos el índice de
    // `;base64,` como fin, un `;charset=utf-8` intermedio deja `image/jpeg;charset=utf-8` y falla la validación.
    const rest = s.slice('data:'.length);
    const idxSemi = rest.indexOf(';');
    const idxComma = rest.indexOf(',');
    let endMime = -1;
    if (idxSemi !== -1 && idxComma !== -1) endMime = Math.min(idxSemi, idxComma);
    else if (idxSemi !== -1) endMime = idxSemi;
    else if (idxComma !== -1) endMime = idxComma;
    else return null;
    mime = rest.slice(0, endMime).toLowerCase();
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

/** Máximo de rondas de tools por mensaje: la primera + hasta 3 de lectura. */
const MAX_RONDAS_TURNO = 4;

/** ¿Todos los pasos de la ronda solo leen (ninguno escribe ni pide confirmación)? */
function rondaSoloLectura(pasos: Array<{ tool: string; args: Record<string, unknown> }>): boolean {
  return pasos.every((p) => !esToolMutacion(p.tool) && !requiereConfirmacion(p.tool, p.args));
}

/** Motor de órdenes .jev (por defecto). `AGENTE_MOTOR=legacy` vuelve al tool calling libre (solo como vía de retorno). */
/** Marca invisible con la cita que se acaba de crear o mover (para «pásala al viernes»). */
function marcaEventoDe(resultado: Record<string, unknown> | undefined): string {
  const e = ultimoEventoDeResultados(resultado ? [resultado] : []);
  return e ? marcaUltimoEvento(e) : '';
}

const motorJevActivo = () => process.env.AGENTE_MOTOR?.trim().toLowerCase() !== 'legacy';

export async function POST(request: NextRequest) {
  try {
    const motorJev = motorJevActivo();
    const body = await request.json();
    const { mensaje, business_id, historial, imagen, imagen_mime, imagenesUrls } = body;
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

    // «la 2» / «la de Olabide» tras una pregunta con opciones: se reescribe con el id exacto de la
    // opción (viaja en el historial en un comentario invisible, ver marcaOpcionesParaHistorial).
    const ultimoAsistenteHistorial = [...historialValido]
      .reverse()
      .find((m) => m.role === 'assistant' && m.content.trim().length > 0);
    const ultimoPresupuestoConv = leerUltimoPresupuestoDeHistorial(historialValido);
    const ultimaFacturaConv = leerUltimaFacturaDeHistorial(historialValido);
    const ultimoEventoConv = leerUltimoEventoDeHistorial(historialValido);
    const mensajeOriginalTrim = typeof mensaje === 'string' ? mensaje.trim() : '';
    const mensajeTrim =
      resolverEleccionOpcion(mensajeOriginalTrim, ultimoAsistenteHistorial?.content) ?? mensajeOriginalTrim;
    const imagenesVisionUrls: string[] = [];
    if (Array.isArray(imagenesUrls)) {
      for (const raw of imagenesUrls) {
        const u = normalizarImagenUrlVision(raw);
        if (u) imagenesVisionUrls.push(u);
      }
    }
    const imagenesNormalizadas: string[] = [...imagenesVisionUrls];
    if (imagenesNormalizadas.length === 0) {
      const single = normalizarImagenVision(imagen, imagen_mime);
      if (single) imagenesNormalizadas.push(single);
    }

    const pathsAdjuntosStorage = imagenesVisionUrls
      .map((u) => extractDiarioObraObjectPath(u))
      .filter((p): p is string => Boolean(p));
    let mensajeTrimParaTools = mensajeTrim;
    if (pathsAdjuntosStorage.length > 0) {
      mensajeTrimParaTools = [
        mensajeTrim,
        `[Fotos adjuntas ya en almacenamiento. Al llamar a crear_entrada_diario, pasa el campo fotos con exactamente estas rutas: ${JSON.stringify(pathsAdjuntosStorage)}]`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    const imagenesParaDiarioCtx =
      imagenesVisionUrls.length > 0
        ? []
        : imagenesNormalizadas.filter((u) => u.startsWith('data:image/'));

    const hayConfirmarAccion = body?.confirmar_accion !== undefined && body?.confirmar_accion !== null;
    const ordenACancelar = typeof body?.cancelar_orden === 'string' ? body.cancelar_orden.trim() : '';
    if (!mensajeTrim && imagenesNormalizadas.length === 0 && !hayConfirmarAccion && !ordenACancelar) {
      return NextResponse.json(
        {
          error:
            'Envía un mensaje de texto o al menos una imagen (imagenesUrls con URL https)',
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


    const supabase = createServiceClient();
    const supabaseAuth = await createClient();
    const {
      data: { user: authUser },
    } = await supabaseAuth.auth.getUser();
    if (!authUser?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const businessIdStr = String(business_id ?? '').trim();
    const canAccess = await assertUserOwnsBusiness(supabase, authUser.id, businessIdStr);
    if (!canAccess) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }
    const { data: profile, error: profileError } = await supabase
      .from('business_profiles')
      .select(
        'nombre, sector, descripcion, servicios, tarifas, contexto_adicional, ciudad, direccion'
      )
      .eq('id', business_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'No se encontró el perfil del negocio' },
        { status: 404 }
      );
    }

    const runTool = async (toolName: string, toolArgs: Record<string, unknown>) => {
      const bidRun =
        typeof business_id === 'string' ? business_id : String(business_id ?? '');

      if (PRESUPUESTOS_HANDLED_TOOLS.has(toolName)) {
        return handlePresupuestos(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          getOpenAI(),
          { mensajeTrim }
        );
      }

      if (DIARIO_HANDLED_TOOLS.has(toolName)) {
        return handleDiario(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          getOpenAI(),
          {
            mensajeTrim: mensajeTrimParaTools,
            imagenesNormalizadas: imagenesParaDiarioCtx,
            fotosAdjuntasStorage: pathsAdjuntosStorage,
          }
        );
      }

      if (AGENDA_HANDLED_TOOLS.has(toolName)) {
        return handleAgenda(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          getOpenAI(),
          { mensajeTrim }
        );
      }

      if (GASTOS_HANDLED_TOOLS.has(toolName)) {
        return handleGastosAgent(
          toolName,
          toolArgs,
          typeof business_id === 'string' ? business_id : String(business_id ?? ''),
          authUser?.id ?? null,
          supabase,
          getOpenAI(),
          { mensajeTrim }
        );
      }

      if (OBRAS_CLIENTES_HANDLED_TOOLS.has(toolName)) {
        return handleObrasClientesAgent(
          toolName,
          toolArgs,
          bidRun,
          authUser?.id ?? null,
          supabase
        );
      }

      if (DOCUMENTOS_HANDLED_TOOLS.has(toolName)) {
        return handleDocumentosAgent(
          toolName,
          toolArgs,
          bidRun,
          authUser?.id ?? null,
          supabase,
          getOpenAI(),
          {
            mensajeTrim,
            mensaje: typeof mensaje === 'string' ? mensaje : mensajeTrim,
          }
        );
      }

      if (ENLACES_PDF_HANDLED_TOOLS.has(toolName)) {
        return handleEnlacesPdf(toolName, toolArgs, bidRun, authUser?.id ?? null, supabase);
      }

      if (CORREO_HANDLED_TOOLS.has(toolName)) {
        return handleCorreoAgent(toolName, toolArgs, authUser?.id);
      }

      if (toolName === 'calcular_medicion') {
        return handleCalcularMedicion(toolArgs);
      }

      if (toolName === 'mostrar_vista_visual') {
        return handleMostrarVistaVisual(toolArgs, bidRun, supabase, runTool);
      }

      switch (toolName) {
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
        case 'get_directions': {
          const direccion = String(toolArgs.direccion ?? '').trim();
          const nombreLugar =
            toolArgs.nombre_lugar != null ? String(toolArgs.nombre_lugar).trim() : '';
          if (!direccion) {
            return { error: 'direccion es obligatoria' };
          }
          const url = generarLinkMaps(direccion);
          const label = nombreLugar || direccion;
          return { mensaje: `📍 [${label}](${url})` };
        }
        case 'consultar_tiempo': {
          const ubicacion = String(toolArgs.ubicacion ?? '').trim();
          const diasRaw = toolArgs.dias;
          const dias = diasRaw === 2 ? 2 : 1;
          if (!ubicacion) {
            return { error: 'ubicacion es obligatoria' };
          }
          if (!process.env.OPENWEATHER_API_KEY?.trim()) {
            return {
              error: 'Servicio meteorológico no configurado (OPENWEATHER_API_KEY).',
            };
          }
          try {
            const geo = await geocodeDireccion(ubicacion);
            let preds: PrediccionMeteo[];
            let etiqueta = ubicacion;
            if (geo) {
              preds = await getPrediccionPorCoordenadas(geo.lat, geo.lon);
              etiqueta = geo.name;
            } else {
              preds = await getPrediccionPorCiudad(ubicacion);
            }
            const slice = preds.slice(0, dias);
            if (slice.length === 0) {
              return {
                mensaje: 'No se pudo obtener la previsión para esa ubicación.',
              };
            }
            const mensaje = formatearMensajeConsultaTiempo(slice, etiqueta);
            return { mensaje, items: slice };
          } catch (e) {
            return {
              error: e instanceof Error ? e.message : 'Error al consultar el tiempo',
            };
          }
        }
        case 'guardar_memoria': {
          const categoria = String(toolArgs.categoria ?? '').trim();
          const clave = String(toolArgs.clave ?? '').trim();
          const valor_texto = String(toolArgs.valor_texto ?? '').trim();
          if (!clave) return { error: 'clave es obligatoria' };
          if (!valor_texto) return { error: 'valor_texto es obligatorio' };
          if (/\b[XYZ]?\d{7,8}[-\s.]?[A-Z]\b|\b[ABCDEFGHJNPQRSUVW][-\s.]?\d{7}[-\s.]?[0-9A-J]\b/i.test(valor_texto)) {
            return {
              ok: false,
              error:
                'Eso parece un NIF/CIF. Los datos de un cliente van en su ficha (actualizar_cliente), no en la memoria del negocio. No he guardado nada.',
            };
          }
          if (!esCategoriaMemoriaValida(categoria)) {
            return {
              error: `categoria inválida. Usa: ${MEMORIA_CATEGORIAS.join(', ')}`,
            };
          }
          const r = await upsertMemoriaNegocio(
            supabase,
            business_id,
            categoria,
            clave,
            valor_texto
          );
          if (!r.ok) return { error: r.error };
          return { ok: true, mensaje: 'Memoria del negocio guardada (no es la ficha de ningún cliente).' };
        }
        case 'eliminar_memoria': {
          const claveDel = String(toolArgs.clave ?? '').trim();
          if (!claveDel) return { error: 'clave es obligatoria' };
          const r = await deleteMemoriaNegocioByClave(supabase, business_id, claveDel);
          if (!r.ok) return { error: r.error };
          return {
            ok: true,
            mensaje: r.deleted ? 'Entrada eliminada.' : 'No había entrada con esa clave.',
          };
        }
        case 'registrar_jornada': {
          return ejecutarRegistrarJornada(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        case 'listar_operarios': {
          return ejecutarListarOperarios(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? '')
          );
        }
        case 'consultar_horas_obra': {
          return ejecutarConsultarHorasObra(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        case 'consultar_horas_operario': {
          return ejecutarConsultarHorasOperario(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs
          );
        }
        case 'eliminar_registro_jornada': {
          return ejecutarEliminarRegistroJornada(
            supabase,
            typeof business_id === 'string' ? business_id : String(business_id ?? ''),
            toolArgs,
            mensajeTrim
          );
        }
        default:
          return { error: `Tool no soportada: ${toolName}` };
      }
    };

    let emailPendienteParaCliente: { para: string; asunto: string; cuerpo: string } | null = null;

    let canvasParaCliente: { tipo: string; titulo: string; datos: unknown[] } | null = null;

    let obraFichaParaCliente:
      | { obra_id: string; obra_nombre: string }
      | null = null;

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

    // ── Confirmación del usuario: «Sí, hazlo» en el panel ─────────────────────────────────────
    // El navegador reenvía la acción pendiente (`confirmar_accion`). Aquí, ya con el control de acceso
    // hecho, se comprueba que la tool está en la lista blanca de acciones confirmables y se ejecuta
    // directamente, sin volver a pasar por el modelo.
    // ── Motor .jev: el navegador solo manda el id de la orden pendiente; lo que se ejecuta es lo que el
    //    servidor guardó (y enseñó). Cualquier `tool`/`args` que mande el navegador se ignora.
    if (motorJev && ordenACancelar) {
      const out = await cancelarOrdenJev({ supabase, businessId: businessIdStr, userId: authUser.id, ordenId: ordenACancelar });
      return NextResponse.json({ respuesta: out.respuesta, email_pendiente: null, canvas: null, obra_modal: null });
    }
    if (motorJev && hayConfirmarAccion) {
      const ordenId = typeof body.confirmar_accion?.orden_id === 'string' ? body.confirmar_accion.orden_id.trim() : '';
      if (!ordenId) {
        return NextResponse.json({ error: 'Falta orden_id: la confirmación solo acepta el id de una orden pendiente.' }, { status: 400 });
      }
      const out = await confirmarOrdenJev({
        supabase,
        businessId: businessIdStr,
        userId: authUser.id,
        ordenId,
        runTool,
        validar: (a) => {
          const g = applyPerfilioGuardrails([{ tool: a.tool, args: a.args }], '');
          return g.ok ? null : g.error;
        },
      });
      const emailJev = capturarEmailPendiente(out.resultado);
      if (emailJev) emailPendienteParaCliente = emailJev;
      capturarCanvas(out.resultado);
      const obraJev = capturarObraFicha(out.resultado);
      if (obraJev) obraFichaParaCliente = obraJev;
      const presJev = ultimoPresupuestoDeResultados(out.resultado ? [out.resultado] : []);
      const facJev = ultimaFacturaDeResultados(out.resultado ? [out.resultado] : []);
      return NextResponse.json({
        respuesta: out.respuesta + (presJev ? marcaUltimoPresupuesto(presJev) : '') + (facJev ? marcaUltimaFactura(facJev) : '') + marcaEventoDe(out.resultado),
        email_pendiente: emailPendienteParaCliente,
        canvas: canvasParaCliente,
        obra_modal: obraFichaParaCliente,
        // Si la frase pedía varias cosas (o había que retomar una orden), la confirmación trae ya la siguiente.
        ...(out.accionPendiente ? { accion_pendiente: { ...out.accionPendiente, args: {} } } : {}),
        ...(out.opciones?.length ? { opciones: out.opciones } : {}),
      });
    }
    if (hayConfirmarAccion) {
      const valida = validarAccionConfirmada(body.confirmar_accion);
      if (!valida.ok) {
        return NextResponse.json({ error: valida.error }, { status: 400 });
      }
      const guardConfirm = applyPerfilioGuardrails([{ tool: valida.tool, args: valida.args }], '');
      if (!guardConfirm.ok) {
        return NextResponse.json({ respuesta: guardConfirm.error, email_pendiente: null, canvas: null, obra_modal: null });
      }
      let resultadoConfirmado: unknown;
      try {
        resultadoConfirmado = await runTool(valida.tool, valida.args);
      } catch (e) {
        console.error('[agente] confirmar_accion:', valida.tool, e);
        resultadoConfirmado = { error: e instanceof Error ? e.message : 'Error al ejecutar la acción' };
      }
      const emailConf = capturarEmailPendiente(resultadoConfirmado);
      if (emailConf) emailPendienteParaCliente = emailConf;
      capturarCanvas(resultadoConfirmado);
      const obraConf = capturarObraFicha(resultadoConfirmado);
      if (obraConf) obraFichaParaCliente = obraConf;

      const hechosConf = hechosMutacionDesdeEjecutado([{ tool: valida.tool, result: resultadoConfirmado }]);
      const prosaConf =
        prosaAncladaDirectaSiAplica(hechosConf) ??
        (typeof (resultadoConfirmado as { mensaje?: unknown })?.mensaje === 'string'
          ? String((resultadoConfirmado as { mensaje: string }).mensaje)
          : fraseHechoConDatos(valida.tool, valida.args));
      logAgenteTurno({
        evento: 'agente_turno',
        intent: 'confirmar_accion',
        tools_pedidas: [valida.tool],
        plan: { fuente: 'ninguno', ejecutado: [valida.tool] },
        result: { n: 1, resumen: [{ tool: valida.tool, result: resumirToolResultParaLog(resultadoConfirmado) }] },
      });
      const presConf = ultimoPresupuestoDeResultados([resultadoConfirmado]);
      return NextResponse.json({
        respuesta: enriquecerTextoConMaps(prosaConf) + (presConf ? marcaUltimoPresupuesto(presConf) : ''),
        email_pendiente: emailPendienteParaCliente,
        canvas: canvasParaCliente,
        obra_modal: obraFichaParaCliente,
      });
    }

    // Límite de uso de la IA del agente (cupo propio). Va DESPUÉS del bloque de `confirmar_accion` porque
    // confirmar no gasta OpenAI, y con el business_id ya validado por el control de acceso.
    const limite = await comprobarLimiteIAAgente(supabase, authUser.id, businessIdStr);
    if (!limite.permitido) return respuestaLimiteIA(limite);

    const nombre = profile.nombre ?? 'el negocio';
    const nombreUsuario = (() => {
      const md = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
      const candidatos = [md.nombre, md.name, md.full_name, md.first_name, authUser?.email];
      for (const c of candidatos) {
        const s = String(c ?? '').trim();
        if (s) return s;
      }
      return 'compa';
    })();
    const sector = profile.sector ?? 'no especificado';
    const descripcion = profile.descripcion ?? '';
    const servicios = profile.servicios ?? '';
    const tarifas = profile.tarifas ?? '';
    const contexto_adicional = profile.contexto_adicional ?? '';
    const ciudadNegocio = String(
      (profile as { ciudad?: string | null }).ciudad ?? ''
    ).trim();
    const ubicacionMeteoPrompt = ciudadNegocio
      ? `\n\nUbicación del negocio: ${ciudadNegocio}. Usa esta ciudad por defecto para consultas meteorológicas cuando el usuario no especifique otra ubicación.`
      : '';

    const fechaActual = new Date().toLocaleDateString('es-ES', {
      timeZone: 'Europe/Madrid',
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
    const tzAgenda = 'Europe/Madrid';
    const hoyYmd = formatYmdInTimeZone(new Date(), tzAgenda);
    const mananaYmd = addDaysToYmd(hoyYmd, 1);

    if (esPrimerMensajeConversacion) {
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

Al inicio de tu respuesta, antes de atender lo que pide el usuario, empieza con este formato: "Aupa ${nombreUsuario}, soy Bicho. [resumen breve y natural de lo relevante de hoy/mañana]". No hagas una lista numerada ni viñetas en ese saludo; después continúa con la petición del usuario.`;
      }
    }

    let memoriaRows: Array<{ categoria: string; clave: string; valor_texto: string }> = [];
    const { data: memoriaData, error: memoriaErr } = await supabase
      .from('memoria_negocio')
      .select('categoria, clave, valor_texto')
      .eq('business_id', business_id)
      .order('categoria', { ascending: true })
      .order('clave', { ascending: true });
    if (!memoriaErr && memoriaData) {
      memoriaRows = memoriaData as typeof memoriaRows;
    }
    const memoriaNegocioBlock = buildMemoriaNegocioPromptBlock(memoriaRows);

    const { data: obrasAbiertas } = await supabase
      .from('obras')
      .select('id, nombre, cliente_id, direccion')
      .eq('business_id', business_id)
      .in('estado', ['abierta', 'en_curso'])
      .order('created_at', { ascending: false })
      .limit(10);

    // Obras cerradas recientes: solo para CONSULTAR («¿cómo va la obra de Ane?» con la obra ya cerrada).
    const { data: obrasCerradas } = await supabase
      .from('obras')
      .select('id, nombre, cliente_id, direccion')
      .eq('business_id', business_id)
      .eq('estado', 'cerrada')
      .order('created_at', { ascending: false })
      .limit(5);

    // Nombre del cliente de cada obra del prompt: así «la obra de Ane» se asocia a la obra de Ane y no a otra.
    const idsClientesObras = [
      ...new Set([...(obrasAbiertas ?? []), ...(obrasCerradas ?? [])].map((o) => o.cliente_id).filter((x): x is string => Boolean(x))),
    ];
    const nombreClienteDeObra = new Map<string, string>();
    if (idsClientesObras.length > 0) {
      const { data: cliObras } = await supabase.from('clientes').select('id, nombre').eq('business_id', business_id).in('id', idsClientesObras);
      for (const c of (cliObras ?? []) as Array<{ id: string; nombre: string | null }>) {
        if (c.nombre) nombreClienteDeObra.set(c.id, c.nombre);
      }
    }
    const lineaObra = (o: { nombre: string; id: string; direccion?: string | null; cliente_id?: string | null }) =>
      `- ${o.nombre} (id: ${o.id})${o.cliente_id && nombreClienteDeObra.get(o.cliente_id) ? ', cliente: ' + nombreClienteDeObra.get(o.cliente_id) : ''}${o.direccion ? ', dir: ' + o.direccion : ''}`;

    const { data: clientesActivos } = await supabase
      .from('clientes')
      .select('id, nombre, email, telefono')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: operariosActivosRows } = await supabase
      .from('operarios')
      .select('nombre')
      .eq('business_id', business_id)
      .eq('activo', true)
      .order('nombre', { ascending: true });
    const nombresOperariosNegocio = (operariosActivosRows ?? [])
      .map((r: { nombre?: string | null }) => String(r.nombre ?? '').trim())
      .filter((n) => n.length > 0);
    const bloqueOperariosPrompt =
      nombresOperariosNegocio.length > 0
        ? `Tienes acceso a la gestión de operarios. Puedes registrar horas de trabajo por obra, listar operarios y consultar resúmenes de horas. Los operarios de este negocio son: ${nombresOperariosNegocio.join(', ')}. Cuando registres horas, si el usuario no distingue entre reales y convenio, guarda el mismo valor en ambos.`
        : `Tienes acceso a la gestión de operarios. Puedes registrar horas de trabajo por obra, listar operarios y consultar resúmenes de horas. Aún no hay operarios activos listados en el sistema para este negocio. Cuando registres horas, si el usuario no distingue entre reales y convenio, guarda el mismo valor en ambos.`;

    const obrasCtx =
      ((obrasAbiertas ?? []).length > 0
        ? `\nOBRAS ABIERTAS ACTUALES:\n${(obrasAbiertas ?? []).map(lineaObra).join('\n')}`
        : '\nNo hay obras abiertas actualmente.') +
      ((obrasCerradas ?? []).length > 0
        ? `\nOBRAS CERRADAS RECIENTES (solo para consultar; no se les añade nada):\n${(obrasCerradas ?? []).map(lineaObra).join('\n')}\nSi te preguntan por una obra de un cliente, usa la obra de ESE cliente (abierta o cerrada). Si no aparece aquí, búscala con buscar_obra o ver_ficha_obra; si no existe, dilo: NUNCA contestes con la obra de otro cliente.`
        : '');

    const clientesCtx =
      (clientesActivos ?? []).length > 0
        ? `\nCLIENTES REGISTRADOS:\n${(clientesActivos ?? [])
            .map(
              (c) =>
                `- ${c.nombre} (id: ${c.id})${c.email ? ', email: ' + c.email : ''}${c.telefono ? ', tel: ' + c.telefono : ''}`
            )
            .join('\n')}`
        : '\nNo hay clientes registrados.';

    const systemPrompt = construirPromptSistema({
      nombre,
      sector,
      descripcion,
      servicios,
      tarifas,
      contextoAdicional: contexto_adicional,
      ubicacionMeteoPrompt,
      ahora,
      fechaActual,
      obrasCtx,
      clientesCtx,
      bloqueOperarios: bloqueOperariosPrompt,
      agendaContextoPrimerMensaje,
      memoriaNegocioBlock,
    });

    const ALL_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      ...DOCUMENTOS_AGENT_TOOLS,
      ...OBRAS_CLIENTES_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'obtener_mensajes_pendientes',
          description:
            'Respuestas IA del negocio pendientes de aprobación (texto, borrador, conversación).',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      ...CORREO_AGENT_TOOLS,
      ...AGENDA_AGENT_TOOLS,
      ...CALCULO_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'get_directions',
          description:
            'Genera un enlace de Google Maps para una dirección. Usar cuando pregunten cómo llegar, indicaciones o ubicación de obra/cliente.',
          parameters: {
            type: 'object',
            properties: {
              direccion: {
                type: 'string',
                description: 'Dirección o ubicación a buscar en Maps',
              },
              nombre_lugar: {
                type: 'string',
                description: 'Etiqueta opcional (ej. Casa García, Cliente Martínez)',
              },
            },
            required: ['direccion'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'consultar_tiempo',
          description:
            'Previsión meteorológica para ciudad o dirección de obra. Tiempo, lluvia, obras en agenda.',
          parameters: {
            type: 'object',
            properties: {
              ubicacion: {
                type: 'string',
                description: 'Ciudad o dirección (ej. Madrid, Zarautz, Calle Mayor 1 Bilbao)',
              },
              dias: {
                type: 'number',
                description: '1 o 2 días de previsión (hoy y/o mañana)',
                enum: [1, 2],
              },
            },
            required: ['ubicacion'],
            additionalProperties: false,
          },
        },
      },
      ...GASTOS_AGENT_TOOLS,
      ...DIARIO_AGENT_TOOLS,
      {
        type: 'function',
        function: {
          name: 'guardar_memoria',
          description: `Guarda o actualiza un dato persistente del negocio (preferencia, corrección, proveedor habitual, formato, precio, etc.). Upsert por clave única por negocio. Llama sin pedir confirmación si el usuario corrige con claridad o declara preferencias duraderas. PROHIBIDO guardar aquí datos de un CLIENTE (NIF, dirección, teléfono, email): eso va en su ficha con actualizar_cliente. Nunca digas que has guardado algo que no hayas guardado de verdad. Categorías válidas: ${MEMORIA_CATEGORIAS.join(', ')}. Usa clave en snake_case corta (ej. cemento_exterior). Responde muy breve ("Anotado…").`,
          parameters: {
            type: 'object',
            properties: {
              categoria: {
                type: 'string',
                enum: [...MEMORIA_CATEGORIAS],
                description: 'Tipo de memoria',
              },
              clave: {
                type: 'string',
                description: 'Identificador único en snake_case por negocio (ej. cemento_exterior)',
              },
              valor_texto: {
                type: 'string',
                description: 'Texto completo del dato o preferencia a recordar',
              },
            },
            required: ['categoria', 'clave', 'valor_texto'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'eliminar_memoria',
          description:
            'Elimina una entrada de memoria del negocio por su clave (misma convención snake_case que al guardar). Usa cuando pida olvidar o quitar una clave concreta.',
          parameters: {
            type: 'object',
            properties: {
              clave: {
                type: 'string',
                description: 'Clave de la entrada a eliminar',
              },
            },
            required: ['clave'],
            additionalProperties: false,
          },
        },
      },
      ...OPERARIOS_AGENT_TOOLS,
      ...PRESUPUESTOS_AGENT_TOOLS,
      ...ENLACES_PDF_AGENT_TOOLS,
      ...CANVAS_AGENT_TOOLS,
    ];

    const textoUsuario =
      mensajeTrim ||
      '(El usuario adjuntó una imagen, posiblemente un ticket o factura. Analízala e indica qué datos ves.)';

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: textoUsuario },
    ];
    for (const u of imagenesNormalizadas) {
      userContent.push({
        type: 'image_url',
        image_url: { url: u, detail: 'auto' },
      });
    }

    let hasBorradorActivo = false;
    if (authUser?.id) {
      const borradorRes = await supabase
        .from('presupuesto_borrador')
        .select('id')
        .eq('business_id', business_id)
        .eq('user_id', authUser.id)
        .eq('estado', 'en_construccion')
        .limit(1);
      const rows = borradorRes.data;
      hasBorradorActivo = Array.isArray(rows)
        ? rows.length > 0 && Boolean((rows[0] as { id?: string } | undefined)?.id)
        : Boolean(
            rows &&
              typeof rows === 'object' &&
              'id' in (rows as object) &&
              String((rows as { id?: unknown }).id ?? '').trim().length > 0
          );
    }

    const ultimoAsistenteRouter = [...historialValido]
      .reverse()
      .find((m) => m.role === 'assistant' && m.content.trim().length > 0);

    const intentExplicito = intentPorSenalExplicita(mensajeTrim);
    const intentCategory: AgentIntentCategory =
      intentExplicito ??
      (await (async () => {
        const jev = await parseAgentIntentCategory(textoUsuario, {
          borradorActivo: hasBorradorActivo,
          ultimoAsistente: ultimoAsistenteRouter?.content,
        });
        // Sin Jev (o si falla / no está seguro) → respaldo local por palabras clave antes de `general`.
        return jev !== 'general' ? jev : (intentPorPalabrasClave(mensajeTrim) ?? 'general');
      })());
    const memoriaNegocioBlockNoPresupuestos =
      intentCategory === 'presupuesto' ? '' : memoriaNegocioBlock;

    // ── Motor .jev: el modelo SOLO traduce el mensaje a una orden cerrada; el ejecutor (sin modelo) resuelve
    //    clientes, obras, fechas e importes, pregunta si falta algo y guarda una orden pendiente. Con fotos
    //    adjuntas, o en correo/cálculo, sigue el camino de siempre (sin las herramientas de escritura ya cubiertas).
    if (motorJev && imagenesNormalizadas.length === 0 && intentCategory !== 'emails' && intentCategory !== 'calculo') {
      const hoyTextoJev = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const salidaJev = await procesarMensajeJev({
        supabase,
        businessId: businessIdStr,
        userId: authUser.id,
        mensaje: mensajeTrim,
        categoria: intentCategory,
        hoyTexto: hoyTextoJev,
        ultimoAsistente: ultimoAsistenteHistorial?.content,
        ultimoPresupuestoId: ultimoPresupuestoConv?.id ?? null,
        ultimaFacturaId: ultimaFacturaConv?.id ?? null,
        ultimoEventoId: ultimoEventoConv?.id ?? null,
        fotosAdjuntas: pathsAdjuntosStorage,
        runTool,
        validar: (a) => {
          const g = applyPerfilioGuardrails([{ tool: a.tool, args: a.args }], '');
          return g.ok ? null : g.error;
        },
      });
      if (!salidaJev.charla) {
        const obraFichaJev = capturarObraFicha(salidaJev.resultado);
        if (obraFichaJev) obraFichaParaCliente = obraFichaJev;
        const presJev = ultimoPresupuestoDeResultados(salidaJev.resultado ? [salidaJev.resultado] : []);
        const facJev = ultimaFacturaDeResultados(salidaJev.resultado ? [salidaJev.resultado] : []);
        return NextResponse.json({
          respuesta: salidaJev.respuesta + (presJev ? marcaUltimoPresupuesto(presJev) : '') + (facJev ? marcaUltimaFactura(facJev) : '') + marcaEventoDe(salidaJev.resultado),
          email_pendiente: null,
          canvas: canvasParaCliente,
          obra_modal: obraFichaParaCliente,
          ...(salidaJev.accionPendiente ? { accion_pendiente: { ...salidaJev.accionPendiente, args: {} } } : {}),
          ...(salidaJev.opciones?.length ? { opciones: salidaJev.opciones } : {}),
        });
      }
    }

    let tools = toolsForAgentIntent(intentCategory, ALL_AGENT_TOOLS);
    if (tools.length === 0) {
      tools = ALL_AGENT_TOOLS;
    }
    // Las herramientas que BORRAN solo se ofrecen si el mensaje pide claramente borrar o quitar: una
    // consulta («¿cuánto me he gastado en Saltoki?») nunca debe poder acabar en un borrado.
    tools = quitarToolsDestructivasSiNoPideBorrar(tools, mensajeTrim, ultimoAsistenteHistorial?.content);
    // Motor .jev: lo que ya se hace con órdenes no se deja al tool calling libre (salvo si hay fotos adjuntas).
    if (motorJev && imagenesNormalizadas.length === 0) tools = quitarToolsCubiertasPorOrdenes(tools);

    const fechaHoyMadrid = new Date().toLocaleDateString('es-ES', {
      timeZone: 'Europe/Madrid',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const systemPromptEfectivo =
      intentCategory === 'presupuesto'
        ? `${promptEspecialidad(`${PRESUPUESTOS_AGENT_SYSTEM_PROMPT_PREFIX}${PRESUPUESTOS_AGENT_SYSTEM_PROMPT}`)}\n\n${GROUNDING_REGLAS_SISTEMA}\n\n---\nContexto del negocio (solo referencia; mantén tus reglas de brevedad).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
        : intentCategory === 'diario'
          ? `${promptEspecialidad(DIARIO_AGENT_SYSTEM_PROMPT)}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
          : intentCategory === 'agenda'
            ? `Hoy es ${fechaHoyMadrid} (zona horaria de Madrid, España).\n\n${promptEspecialidad(AGENDA_AGENT_SYSTEM_PROMPT)}\n\nFecha actual: ${fechaActual}. Fecha hoy en formato ISO: ${hoyYmd}. Mañana en formato ISO: ${mananaYmd}.\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : intentCategory === 'operarios'
              ? `${promptEspecialidad(OPERARIOS_AGENT_SYSTEM_PROMPT)}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : intentCategory === 'gastos'
              ? `${promptEspecialidad(GASTOS_AGENT_SYSTEM_PROMPT)}\n\n---\nContexto del negocio (solo referencia).\nNegocio: ${nombre} (${sector}). Fecha: ${fechaActual}.${obrasCtx}${clientesCtx}\n${memoriaNegocioBlockNoPresupuestos}`
            : systemPrompt;

    // Un «sí» escrito sin confirmación pendiente (el botón ya lo gestiona `confirmar_accion`) no lanza otra
    // acción: si el asistente no había preguntado nada, se contesta que no hay nada pendiente.
    const afirmacionSuelta = esAfirmacionSuelta(mensajeTrim) && !hasBorradorActivo;
    if (afirmacionSuelta && !asistentePreguntoAlgo(ultimoAsistenteHistorial?.content)) {
      return NextResponse.json({ respuesta: MENSAJE_NADA_PENDIENTE, email_pendiente: null, canvas: null, obra_modal: null });
    }

    const historialLimitado = historialValido.slice(-10);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: afirmacionSuelta ? `${systemPromptEfectivo}\n\n${REGLA_SI_SUELTO}` : systemPromptEfectivo },
      ...historialLimitado.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    const maxTokensAgente = imagenesNormalizadas.length > 0 ? 1600 : 800;

    const mensajeLower = mensajeTrim.toLowerCase();
    const esConfirmacion = hasBorradorActivo && (
      mensajeLower.includes('confirma') ||
      mensajeLower.includes('finaliza') ||
      mensajeLower.includes('guarda') ||
      mensajeLower.includes('listo') ||
      mensajeLower.includes('ya está') ||
      mensajeLower.includes('cierra')
    );

    const parallelToolCallsOpt =
      intentCategory === 'presupuesto' ||
      intentCategory === 'diario' ||
      intentCategory === 'agenda' ||
      intentCategory === 'gastos'
        ? { parallel_tool_calls: false as const }
        : {};

    const modelo = modeloAgente();
    const paramsTools = parametrosGeneracion(modelo, {
      maxTokens: maxTokensAgente,
      temperature: AGENTE_TOOLS_TEMPERATURE,
    });

    const completion = await getOpenAI().chat.completions.create({
      model: modelo,
      messages,
      tools,
      tool_choice: esConfirmacion
        ? { type: 'function', function: { name: 'confirmar_borrador' } }
        : 'auto',
      ...parallelToolCallsOpt,
      ...paramsTools,
    });

    let firstMessage = completion.choices[0]?.message;
    let firstToolCalls = firstMessage?.tool_calls;
    let planFuente: PlanFuente = firstToolCalls?.length ? 'tool_calls_nativos' : 'ninguno';

    if (
      !firstToolCalls?.length &&
      !esConfirmacion &&
      (pareceAccionQueRequiereTool(mensajeTrim) ||
        // «Voy a comprobar…» sin haber llamado a nada: se reintenta forzando una tool en vez de dejar
        // al usuario esperando.
        prometeSinHacer(typeof firstMessage?.content === 'string' ? firstMessage.content : ''))
    ) {
      const retryMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...messages,
        {
          role: 'system',
          content:
            'El usuario pide una acción sobre datos del negocio. Debes invocar la herramienta correspondiente en este turno. No respondas solo con texto.',
        },
      ];
      const retryCompletion = await getOpenAI().chat.completions.create({
        model: modelo,
        messages: retryMessages,
        tools,
        tool_choice: 'required',
        ...parallelToolCallsOpt,
        ...paramsTools,
      });
      const retryMessage = retryCompletion.choices[0]?.message;
      if (retryMessage?.tool_calls?.length) {
        firstMessage = retryMessage;
        firstToolCalls = retryMessage.tool_calls;
        planFuente = 'reintento_required';
      }
    }

    let respuesta =
      typeof firstMessage?.content === 'string' ? firstMessage.content : '';

    const ejecutadoResumen: Array<{ tool: string; result: unknown }> = [];
    const resultadosDelTurno: unknown[] = [];
    let accionPendiente = null as AccionPendiente | null; // se asigna dentro de procesarPasos (TS no ve esas asignaciones)

    if (firstToolCalls?.length) {
      const planBruto = inyectarUltimoPresupuesto(plannedToolsFromAssistantToolCalls(firstToolCalls), mensajeTrim, ultimoPresupuestoConv);
      // Defensa en el servidor: aunque el modelo pida borrar, sin una petición clara de borrar no se ejecuta.
      const plan = pideBorrar(mensajeTrim, ultimoAsistenteHistorial?.content)
        ? planBruto
        : planBruto.filter((p) => !TOOLS_DESTRUCTIVAS.has(p.tool));
      const draftAssistant =
        typeof firstMessage?.content === 'string' ? firstMessage.content.trim() : '';

      if (plan.length === 0) {
        respuesta =
          planBruto.length > 0
            ? 'No he borrado nada: no me has pedido borrar ni quitar. Si quieres borrarlo, dímelo claro (por ejemplo «borra ese gasto»).'
            : draftAssistant || 'No hay acciones de herramientas para ejecutar.';
      } else {
        const guard = applyPerfilioGuardrails(plan, mensajeTrim);
        if (!guard.ok) {
          respuesta = guard.error;
        } else {
          const validated = guard.plan;
          const ids = idsParaPlanEjecutado(validated, firstToolCalls);
          const executed: Array<{
            id: string;
            tool: string;
            args: Record<string, unknown>;
            result: unknown;
          }> = [];

          /** Ejecuta (o retiene, si necesita confirmación) los pasos de UNA ronda. */
          const procesarPasos = async (
            validated: typeof guard.plan,
            ids: string[]
          ) => {
            for (let i = 0; i < validated.length; i++) {
              const step = validated[i];
              let toolResult: unknown;
              try {
                if (requiereConfirmacion(step.tool, step.args)) {
                  // BARRERA: no se ejecuta. Se prepara la acción y se le pregunta al usuario.
                  if (accionPendiente) {
                    toolResult = {
                      ok: false,
                      pendiente_confirmacion: true,
                      error: 'Una cosa cada vez: confirma primero la anterior y luego te preparo esta.',
                    };
                  } else {
                    const prep = await prepararAccionPendiente(step.tool, step.args, {
                      supabase,
                      businessId: businessIdStr,
                      runTool,
                      mensajeUsuario: mensajeTrim,
                      historialUsuario: historialValido
                        .filter((m: { role: string }) => m.role === 'user')
                        .slice(-3)
                        .map((m: { content: string }) => m.content),
                    });
                    if (prep.tipo === 'pendiente') {
                      accionPendiente = prep.accion;
                      toolResult = {
                        ok: false,
                        pendiente_confirmacion: true,
                        error: preguntaConfirmacion(prep.accion.resumen),
                      };
                    } else {
                      toolResult = prep.result;
                    }
                  }
                } else {
                  toolResult = await runTool(step.tool, step.args);
                  // Vista previa propia de la tool (p. ej. registrar_jornada con solo_vista_previa):
                  // se convierte en la misma acción pendiente con botones.
                  const r = toolResult as Record<string, unknown> | null;
                  if (
                    confirmacionActiva() &&
                    !accionPendiente &&
                    r?.pendiente_confirmacion === true &&
                    TOOLS_CON_VISTA_PREVIA.has(step.tool)
                  ) {
                    const texto = [r.mensaje, r.error].find((x) => typeof x === 'string' && x.trim());
                    const resumen =
                      limpiarTextoVistaPrevia(String(texto ?? '')) ||
                      describirAccionGenerica(step.tool, step.args);
                    accionPendiente = {
                      tool: step.tool,
                      args: { ...step.args, solo_vista_previa: false },
                      resumen,
                    };
                    // El usuario lee el resumen limpio (sin las instrucciones pensadas para el modelo).
                    toolResult = {
                      ...r,
                      ok: false,
                      pendiente_confirmacion: true,
                      error: preguntaConfirmacion(resumen),
                    };
                  }
                }
              } catch (e) {
                console.error('[agente] runTool:', step.tool, e);
                toolResult = {
                  error: e instanceof Error ? e.message : 'Error al ejecutar la herramienta',
                };
              }
              const emailCapturado = capturarEmailPendiente(toolResult);
              if (emailCapturado) emailPendienteParaCliente = emailCapturado;
              capturarCanvas(toolResult);
              const obraCapturada = capturarObraFicha(toolResult);
              if (obraCapturada) obraFichaParaCliente = obraCapturada;
              executed.push({
                id: ids[i],
                tool: step.tool,
                args: step.args,
                result: toolResult,
              });
              resultadosDelTurno.push(toolResult);
              ejecutadoResumen.push({
                tool: step.tool,
                result: resumirToolResultParaLog(toolResult),
              });
            }
          };

          await procesarPasos(validated, ids);

          // Varias rondas de LECTURA por turno (p. ej. buscar la obra y luego el cliente): tras cada ronda
          // que solo ha leído, se le devuelven los resultados al modelo por si necesita pedir más datos.
          // Se PARA en cuanto algo necesita confirmación (accionPendiente), en la primera escritura, si el
          // modelo ya no pide tools o al llegar a MAX_RONDAS_TURNO (nunca bucles infinitos ni gasto sin tope).
          let rondaActual = validated;
          let respuestaTrasLectura = '';
          for (let ronda = 1; ronda < MAX_RONDAS_TURNO; ronda++) {
            if (accionPendiente || !rondaSoloLectura(rondaActual)) break;
            const siguiente = await getOpenAI().chat.completions.create({
              model: modelo,
              messages: buildToolLoopMessages(messages, executed),
              tools,
              tool_choice: 'auto',
              ...parallelToolCallsOpt,
              ...paramsTools,
            });
            const llamadas = siguiente.choices[0]?.message?.tool_calls;
            if (!llamadas?.length) {
              // Ya no pide más tools: lo que escribe es la respuesta final (así no hace falta otra llamada).
              const texto = siguiente.choices[0]?.message?.content;
              if (typeof texto === 'string' && texto.trim()) respuestaTrasLectura = texto;
              break;
            }
            const planSig = inyectarUltimoPresupuesto(plannedToolsFromAssistantToolCalls(llamadas), mensajeTrim, ultimoPresupuestoConv);
            const guardSig = applyPerfilioGuardrails(planSig, mensajeTrim);
            if (planSig.length === 0 || !guardSig.ok) break;
            await procesarPasos(guardSig.plan, idsParaPlanEjecutado(guardSig.plan, llamadas));
            rondaActual = guardSig.plan;
          }

          const hechos = hechosMutacionDesdeEjecutado(executed);
          // Si hay una acción pendiente (vista previa de una tool que el prefijo no clasifica como
          // «mutación», p. ej. generar_presupuesto_por_dictado), la pregunta sale tal cual, sin modelo.
          const prosaDirecta =
            prosaAncladaDirectaSiAplica(hechos) ??
            (accionPendiente && hechos.exitos.length === 0
              ? preguntaConfirmacion(accionPendiente.resumen)
              : null);
          if (prosaDirecta) {
            respuesta = prosaDirecta;
          } else if (respuestaTrasLectura) {
            respuesta = anclarProsaAHechos(respuestaTrasLectura, hechos);
          } else {
            const finalMessages = [
              ...buildToolLoopMessages(messages, executed),
              { role: 'system' as const, content: buildMensajeSistemaProsaAnclada(hechos) },
            ];
            try {
              const finalCompletion = await getOpenAI().chat.completions.create({
                model: modelo,
                messages: finalMessages,
                ...parametrosGeneracion(modelo, {
                  maxTokens: maxTokensAgente,
                  temperature: AGENTE_PROSA_TEMPERATURE,
                }),
              });
              const finalText = finalCompletion.choices[0]?.message?.content;
              if (typeof finalText === 'string' && finalText.trim()) {
                respuesta = anclarProsaAHechos(finalText, hechos);
              } else {
                respuesta =
                  executed
                    .map((e) =>
                      typeof (e.result as { mensaje?: unknown })?.mensaje === 'string'
                        ? String((e.result as { mensaje: string }).mensaje)
                        : ''
                    )
                    .filter(Boolean)
                    .join('\n') || respuesta;
                respuesta = anclarProsaAHechos(respuesta, hechos);
              }
            } catch (e) {
              console.error('[agente] final completion:', e);
              respuesta = executed
                .map((e) =>
                  typeof (e.result as { mensaje?: unknown })?.mensaje === 'string'
                    ? String((e.result as { mensaje: string }).mensaje)
                    : `${e.tool} ejecutada`
                )
                .join('\n');
              respuesta = anclarProsaAHechos(respuesta, hechos);
            }
          }
        }
      }
    }

    logAgenteTurno({
      evento: 'agente_turno',
      intent: intentCategory,
      tools_pedidas: (firstToolCalls ?? [])
        .filter((tc) => tc.type === 'function')
        .map((tc) => tc.function.name),
      plan: {
        fuente: planFuente,
        ejecutado: ejecutadoResumen.map((e) => e.tool),
      },
      result: {
        n: ejecutadoResumen.length,
        resumen: ejecutadoResumen,
      },
    });

    if (!String(respuesta ?? '').trim()) {
      respuesta =
        'No he podido generar una respuesta en texto. Prueba a reformular la pregunta o inténtalo de nuevo.';
    }

    // El enlace al PDF debe verse sí o sí: si el modelo no lo copió en su texto, se añade.
    for (const r of resultadosDelTurno) {
      const o = (r && typeof r === 'object' ? r : {}) as { ok?: unknown; url?: unknown; mensaje?: unknown };
      if (o.ok === true && typeof o.url === 'string' && typeof o.mensaje === 'string' && !respuesta.includes(o.url)) {
        respuesta = `${respuesta}\n\n${o.mensaje}`.trim();
      }
    }

    respuesta = enriquecerTextoConMaps(String(respuesta ?? ''));

    // Opciones numeradas de las aclaraciones («¿cuál de estas obras?») con sus ids, en un comentario
    // HTML invisible: así «la 2» se resuelve al id exacto en el turno siguiente.
    const opciones = opcionesDeResultados(resultadosDelTurno);
    if (opciones.length > 0) respuesta += marcaOpcionesParaHistorial(opciones);
    const presTratado = ultimoPresupuestoDeResultados(resultadosDelTurno);
    if (presTratado) respuesta += marcaUltimoPresupuesto(presTratado);

    // Motor .jev: aunque la propuesta venga del camino de siempre (fotos, herramientas aún sin orden), se guarda
    // en el servidor y al navegador solo le llega su id: lo que se confirma es lo que se guardó.
    if (motorJev && accionPendiente) {
      const guardada = await crearPendiente(supabase, {
        businessId: businessIdStr,
        userId: authUser.id,
        orden: { accion: 'LEGACY', tool: accionPendiente.tool } as never,
        accion: { tool: accionPendiente.tool, args: accionPendiente.args },
        resumen: accionPendiente.resumen,
      });
      accionPendiente = guardada.ok
        ? ({ tool: accionPendiente.tool, args: {}, resumen: accionPendiente.resumen, orden_id: guardada.id } as unknown as AccionPendiente)
        : null;
    }

    return NextResponse.json({
      respuesta,
      email_pendiente: emailPendienteParaCliente,
      canvas: canvasParaCliente,
      obra_modal: obraFichaParaCliente,
      // Solo cuando existen (las claves de siempre no cambian): botones «Sí, hazlo / No» y opciones.
      ...(accionPendiente ? { accion_pendiente: accionPendiente } : {}),
      ...(opciones.length > 0 ? { opciones } : {}),
    });
  } catch (error) {
    console.error('Error en /api/agente:', error);
    return NextResponse.json(
      { error: 'Error al generar la respuesta del agente' },
      { status: 500 }
    );
  }
}
