import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDiarioObraPdf,
  collectDiarioObraStoragePathsFromEntry,
  decodeDataUrlImageForDiarioUpload,
  extractDiarioObraObjectPath,
  fetchDiarioObraEntries,
  insertDiarioObraEntry,
  normalizeDiarioObraRowMediaForInsert,
  removeDiarioObraStorageObjects,
  sanitizeDiarioFilePart,
  signDiarioObraEntriesMedia,
  uploadDiarioObraMediaToBucket,
} from '@/lib/diario-obra';
import { formatYmdInTimeZone, parseFechaNatural, ymdHoyMadrid } from '@/lib/fechas-madrid';
import { resolverObraDocumentoAgente, aclaracionObra } from '@/lib/obras-context';


export const DIARIO_HANDLED_TOOLS = new Set([
  'crear_entrada_diario',
  'eliminar_entrada_diario',
  'generar_pdf_diario',
]);

export const DIARIO_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'crear_entrada_diario',
      description:
        'Anota una entrada en el diario de obra (texto y, si las hay, fotos). Pasa obra_id (uuid, si lo sabes por una consulta previa con buscar_obra) u obra_nombre. Si la obra está clara, llama a la tool directamente; si encaja con varias obras, la tool devuelve las opciones y entonces preguntas al usuario cuál es. Si el usuario adjuntó imágenes en este mensaje, el servidor las gestiona solo: NO pongas nada en fotos. Para rutas que el usuario pegue a mano usa fotos. NO inventes URLs.',
      parameters: {
        type: 'object',
        properties: {
          obra_nombre: {
            type: 'string',
            description:
              "Nombre de la obra tal como lo dijo el usuario (ej: 'Reforma Calle Mayor'). Alternativa a obra_id.",
          },
          obra_id: {
            type: 'string',
            description:
              'UUID exacto de la obra (de buscar_obra o de OBRAS ABIERTAS). Si lo pasas, manda sobre obra_nombre.',
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
          fecha: {
            type: 'string',
            description:
              'Día en que se hizo el trabajo, si NO es hoy: «ayer», «anteayer», «el lunes», «el 3», «3 de octubre» o YYYY-MM-DD (hora de Madrid). Si el usuario dice «ayer desmontamos…», pasa fecha: "ayer". No admite fechas futuras. Omítelo si es hoy.',
          },
          fotos: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Solo rutas/URLs reales del bucket diario-obra si el usuario las pegó manualmente. NUNCA pongas URLs inventadas ni de ejemplo. Si no tienes rutas reales del bucket, omite este campo completamente (no lo incluyas en el JSON). Si el usuario adjuntó imágenes en este mensaje, el servidor las gestiona automáticamente: NO pongas nada en el campo fotos.',
          },
          videos: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Solo rutas/URLs reales del bucket para vídeos ya subidos; no inventes enlaces.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_pdf_diario',
      description: 'PDF con todas las entradas de una obra (por nombre de obra).',
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
      name: 'eliminar_entrada_diario',
      description:
        'Elimina una entrada del diario de obra (diario_obra). Busca por nombre de obra y opcionalmente fecha o texto en la descripción. SDD: solo_vista_previa true primero (resumen o candidatos); tras confirmación, solo_vista_previa false con entrada_id. Elimina también fotos/vídeos del bucket Storage.',
      parameters: {
        type: 'object',
        properties: {
          obra_nombre: {
            type: 'string',
            description: 'Nombre o texto para identificar la obra (p. ej. Reforma Paqui)',
          },
          obra_id: { type: 'string', description: 'UUID de la obra si se conoce' },
          fecha: { type: 'string', description: 'Fecha de la entrada YYYY-MM-DD (opcional)' },
          texto_fragmento: {
            type: 'string',
            description: 'Fragmento del texto de la entrada (opcional, búsqueda aproximada)',
          },
          entrada_id: { type: 'string', description: 'UUID de la fila diario_obra a eliminar' },
          solo_vista_previa: {
            type: 'boolean',
            description:
              'True: solo muestra vista previa o lista de candidatos. False u omitido: ejecuta el borrado con entrada_id.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

export const DIARIO_AGENT_SYSTEM_PROMPT = `Eres el especialista en diario de obra. Tu trabajo es anotar entradas en el diario de la obra correcta.

Reglas:
1. No digas «Anotado», «Registrado» ni «Guardado» hasta recibir el resultado de crear_entrada_diario con ok:true.
2. Si la obra está clara (la nombra el usuario o hay un obra_id en las OBRAS ABIERTAS), llama a crear_entrada_diario con obra_id u obra_nombre. No pidas aclaraciones de más.
3. Si la tool devuelve varias obras candidatas, pregunta al usuario cuál es y muestra las opciones numeradas. Si no sabes de qué obra habla («anota esto»), pregunta qué quiere anotar y en qué obra.
4. Si no tienes el id y dudas, usa antes buscar_obra para encontrarlo. Nunca inventes una obra.
5. Si hay imágenes en el mensaje, van incluidas en la entrada (las gestiona el servidor). Nunca las ignores.
6. Haz una acción cada vez: primero la obra, luego la entrada.
7. Si una tool devuelve un error, díselo al usuario con claridad.
8. Al confirmar, usa este formato: «Anotado en el diario de [obra] ([fecha]): [resumen breve]».`;

export type HandleDiarioCtx = {
  mensajeTrim?: string;
  imagenesNormalizadas?: string[];
  fotosAdjuntasStorage?: string[];
};

/** Descarta URLs inventadas del modelo; solo paths relativos o URLs de Storage Supabase. */
function filtrarFotosToolConfiables(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (!s) continue;
    if (!/^https?:\/\//i.test(s)) {
      if (/^[a-f0-9-]{8,}\/.+/i.test(s)) out.push(s);
      continue;
    }
    if (!/supabase\.co/i.test(s)) continue;
    const p = extractDiarioObraObjectPath(s);
    if (p) out.push(p);
  }
  return out;
}

export async function handleDiario(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient,
  _openai: OpenAI,
  ctx: HandleDiarioCtx = {}
): Promise<Record<string, unknown>> {
  void userId;
  void _openai;
  const mensajeTrim = ctx.mensajeTrim ?? '';
  const imagenesNormalizadas = ctx.imagenesNormalizadas ?? [];
  const fotosAdjuntasStorage = ctx.fotosAdjuntasStorage ?? [];

  switch (toolName) {
    case 'eliminar_entrada_diario': {
      const bidDiarioDel =
        typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!bidDiarioDel) return { error: 'business_id es requerido' };
      const soloVistaDiario =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const entradaIdDiario =
        typeof toolArgs.entrada_id === 'string' && toolArgs.entrada_id.trim()
          ? toolArgs.entrada_id.trim()
          : '';
      const obraNombreDiarioArg = String(toolArgs.obra_nombre ?? '').trim();
      const obraIdDiarioArg =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? toolArgs.obra_id.trim()
          : undefined;
      const fechaDiarioArg = String(toolArgs.fecha ?? '').trim();
      const textoFragDiario = String(toolArgs.texto_fragmento ?? '').trim();

      const ymdRowDiario = (iso: string | null | undefined) =>
        formatYmdInTimeZone(new Date(iso ?? 0), 'Europe/Madrid');

      const previewDiario = async (row: {
        id: string;
        obra_nombre: string | null;
        texto: string | null;
        fecha: string | null;
      }) => {
        const tituloTxt = String(row.texto ?? '')
          .trim()
          .slice(0, 80);
        const fechaFmt = row.fecha
          ? new Date(row.fecha).toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '—';
        const frag = tituloTxt || '(sin texto)';
        return {
          mensaje:
            `¿Eliminar esta entrada del diario?\n` +
            `• Obra: ${String(row.obra_nombre ?? '').trim() || '—'}\n` +
            `• Fecha: ${fechaFmt}\n` +
            `• Texto: ${frag}${String(row.texto ?? '').trim().length > 80 ? '…' : ''}\n\n` +
            `Si el usuario confirma, vuelve a llamar a eliminar_entrada_diario con entrada_id "${row.id}" y solo_vista_previa false (u omítelo).`,
          pendiente_confirmacion: true,
          entrada_id: row.id,
        };
      };

      const ejecutarBorradoDiario = async (id: string) => {
        const { data: rowD, error: feD } = await supabase
          .from('diario_obra')
          .select('id, fotos, videos')
          .eq('id', id)
          .eq('business_id', bidDiarioDel)
          .maybeSingle();
        if (feD) return { error: feD.message };
        if (!rowD?.id) {
          return { mensaje: 'No he encontrado ninguna entrada del diario que coincida.' };
        }
        const paths = collectDiarioObraStoragePathsFromEntry(
          {
            fotos: rowD.fotos as string[] | null,
            videos: rowD.videos as string[] | null,
          },
          bidDiarioDel
        );
        await removeDiarioObraStorageObjects(supabase, paths);
        const { error: deD } = await supabase
          .from('diario_obra')
          .delete()
          .eq('id', id)
          .eq('business_id', bidDiarioDel);
        if (deD) return { error: deD.message };
        return { mensaje: 'Entrada del diario eliminada.', ok: true };
      };

      if (entradaIdDiario) {
        if (soloVistaDiario) {
          const { data: row1, error: e1 } = await supabase
            .from('diario_obra')
            .select('id, obra_nombre, texto, fecha')
            .eq('id', entradaIdDiario)
            .eq('business_id', bidDiarioDel)
            .maybeSingle();
          if (e1) return { error: e1.message };
          if (!row1?.id) {
            return { mensaje: 'No he encontrado ninguna entrada del diario que coincida.' };
          }
          return previewDiario(row1 as { id: string; obra_nombre: string | null; texto: string | null; fecha: string | null });
        }
        return ejecutarBorradoDiario(entradaIdDiario);
      }

      const textoBusObraDiario = [obraNombreDiarioArg, mensajeTrim].filter(Boolean).join(' ').trim();
      const obraResDiario = await resolverObraDocumentoAgente(
        supabase,
        bidDiarioDel,
        obraIdDiarioArg,
        textoBusObraDiario,
        'entrada_diario',
        { incluirCerradas: true }
      );
      if (!obraResDiario.ok) return aclaracionObra(obraResDiario);
      if (!obraResDiario.obra_id) {
        return { error: 'Indica la obra (obra_nombre u obra_id) para localizar la entrada del diario.' };
      }

      let qDiario = supabase
        .from('diario_obra')
        .select('id, obra_nombre, texto, fecha, created_at')
        .eq('business_id', bidDiarioDel)
        .eq('obra_id', obraResDiario.obra_id)
        .order('fecha', { ascending: false })
        .limit(80);

      if (textoFragDiario) {
        const safeTx = textoFragDiario.replace(/[%_*]/g, '').slice(0, 200);
        if (safeTx) {
          qDiario = qDiario.ilike('texto', `%${safeTx}%`);
        }
      }

      const { data: filasD, error: errD } = await qDiario;
      if (errD) return { error: errD.message };

      let candidatosD = (filasD ?? []) as Array<{
        id: string;
        obra_nombre: string | null;
        texto: string | null;
        fecha: string | null;
      }>;

      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaDiarioArg)) {
        candidatosD = candidatosD.filter((r) => ymdRowDiario(r.fecha) === fechaDiarioArg);
      }

      if (candidatosD.length === 0) {
        return { mensaje: 'No he encontrado ninguna entrada del diario que coincida.' };
      }

      if (candidatosD.length > 1) {
        const lista = candidatosD.slice(0, 15).map((r, i) => {
          const frag = String(r.texto ?? '')
            .trim()
            .slice(0, 60);
          const f = r.fecha
            ? new Date(r.fecha).toLocaleDateString('es-ES', { dateStyle: 'short' })
            : '—';
          return `${i + 1}. ${f} — ${frag || '(sin texto)'} — id ${r.id}`;
        });
        return {
          mensaje:
            `Hay varias entradas que encajan:\n${lista.join('\n')}\nIndica cuál eliminar pasando entrada_id (luego solo_vista_previa true y confirmación).`,
          candidatos: candidatosD.map((c) => c.id),
        };
      }

      const unoD = candidatosD[0]!;
      if (!soloVistaDiario) {
        return {
          error:
            'Para borrar con seguridad, primero muestra la vista prevía con solo_vista_previa true.',
        };
      }
      return previewDiario(unoD);
    }
    case 'crear_entrada_diario': {
      console.log(
        '[agente] crear_entrada_diario — argumentos del modelo:',
        JSON.stringify(
          {
            obra_id: toolArgs.obra_id,
            obra_nombre: toolArgs.obra_nombre,
            obra_direccion: toolArgs.obra_direccion,
            texto: toolArgs.texto,
            fotos: toolArgs.fotos,
            videos: toolArgs.videos,
          },
          null,
          2
        )
      );

      let fechaDiario: string | null = null;
      if (String(toolArgs.fecha ?? '').trim()) {
        const f = parseFechaNatural(toolArgs.fecha);
        if (!f.ok) return { ok: false, error: f.error };
        if (f.ymd !== ymdHoyMadrid()) fechaDiario = f.ymd;
      }

      const obraNombreDiario = String(toolArgs.obra_nombre ?? '').trim();
      const obraIdDiarioArg = typeof toolArgs.obra_id === 'string' ? toolArgs.obra_id.trim() : '';
      if (!obraNombreDiario && !obraIdDiarioArg) {
        return { error: 'Indica obra_id u obra_nombre' };
      }
      const businessIdDiario =
        typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!businessIdDiario) {
        return { error: 'business_id es requerido' };
      }
      const obraDireccionDiario =
        toolArgs.obra_direccion != null ? String(toolArgs.obra_direccion).trim() : undefined;
      const textoDiario =
        toolArgs.texto != null ? String(toolArgs.texto).trim() : undefined;
      const fotosDiarioRaw = Array.isArray(toolArgs.fotos)
        ? toolArgs.fotos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [];
      const fotosDiarioConfiables = filtrarFotosToolConfiables(fotosDiarioRaw);
      const videosDiario = Array.isArray(toolArgs.videos)
        ? toolArgs.videos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : undefined;

      const toolMedia = normalizeDiarioObraRowMediaForInsert({
        fotos: fotosDiarioConfiables.length > 0 ? fotosDiarioConfiables : null,
        videos: videosDiario ?? null,
      });
      const fotosDesdeTool = (toolMedia.fotos ?? []).filter((p) =>
        /^[a-f0-9-]{8,}\/.+/i.test(p)
      );
      const videosDesdeTool = toolMedia.videos ?? [];

      const explicitObraDiario =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;
      const textoDetDiario = [obraNombreDiario, textoDiario, mensajeTrim]
        .filter(Boolean)
        .join(' ')
        .trim();
      const obraDiarioRes = await resolverObraDocumentoAgente(
        supabase,
        businessIdDiario,
        explicitObraDiario,
        textoDetDiario,
        'entrada_diario',
        { nombreEsperado: obraNombreDiario || undefined }
      );
      if (!obraDiarioRes.ok) return aclaracionObra(obraDiarioRes);
      if (obraIdDiarioArg && !obraNombreDiario && !obraDiarioRes.obra_id) {
        return { ok: false, error: 'obra_id no existe, no está abierta o no pertenece a este negocio.' };
      }

      const pathsSubidaAdjunto: string[] = [];
      for (let ix = 0; ix < imagenesNormalizadas.length; ix++) {
        const dataUrl = imagenesNormalizadas[ix];
        const decoded = decodeDataUrlImageForDiarioUpload(dataUrl);
        if (!decoded) {
          return {
            error:
              'Una de las imágenes adjuntas no es válida para el diario (usa jpg, png, gif o webp).',
          };
        }
        const up = await uploadDiarioObraMediaToBucket(supabase, {
          businessId: businessIdDiario,
          buffer: decoded.buffer,
          contentType: decoded.contentType,
          stem: sanitizeDiarioFilePart(`diario_adjunto_${ix}`),
        });
        if ('error' in up) {
          return {
            error: `No se pudo subir la foto al almacenamiento del diario: ${up.error}`,
          };
        }
        pathsSubidaAdjunto.push(up.path);
      }

      const fotosCombinadas = [
        ...new Set([...pathsSubidaAdjunto, ...fotosDesdeTool, ...fotosAdjuntasStorage]),
      ];
      const fotosParaInsertar = fotosCombinadas.length > 0 ? fotosCombinadas : null;
      const videosParaInsertar = videosDesdeTool.length > 0 ? videosDesdeTool : null;

      const obraIdFinal = obraDiarioRes.obra_id ?? '';
      const nombreObraDiario = obraDiarioRes.obra_nombre ?? obraNombreDiario;

      let clienteIdDiario: string | null = null;
      if (obraIdFinal) {
        const { data: obraRowCli } = await supabase
          .from('obras')
          .select('cliente_id')
          .eq('id', obraIdFinal)
          .eq('business_id', businessIdDiario)
          .maybeSingle();
        const cid = (obraRowCli as { cliente_id?: string | null } | null)?.cliente_id;
        clienteIdDiario = cid != null && String(cid).trim() ? String(cid).trim() : null;
      }

      const { data: entradaCreada, error: errDiario } = await insertDiarioObraEntry(supabase, {
        business_id: businessIdDiario,
        cliente_id: clienteIdDiario,
        obra_nombre: nombreObraDiario,
        obra_id: obraIdFinal || null,
        obra_direccion: obraDireccionDiario || null,
        texto: textoDiario || null,
        fotos: fotosParaInsertar,
        videos: videosParaInsertar,
        fecha: fechaDiario,
      });

      if (errDiario || !entradaCreada) {
        return {
          error: errDiario?.message ?? 'No se pudo crear la entrada del diario',
        };
      }

      const fechaLargaDiario = new Date(entradaCreada.fecha).toLocaleDateString('es-ES', {
        timeZone: 'Europe/Madrid',
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
    case 'generar_pdf_diario': {
      const obraNombrePdf = String(toolArgs.obra_nombre ?? '').trim();
      if (!obraNombrePdf) {
        return { error: 'obra_nombre es obligatorio' };
      }
      const businessIdPdfDiario =
        typeof businessId === 'string' ? businessId : String(businessId ?? '');
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
        const entradasConUrls = await signDiarioObraEntriesMedia(supabase, entradasPdf, businessIdPdfDiario);
        pdfBytes = await buildDiarioObraPdf(entradasConUrls);
      } catch (e) {
        console.error('buildDiarioObraPdf', e);
        return { error: 'No se pudo generar el PDF' };
      }

      const dateTagPdf = ymdHoyMadrid();
      const safeObraPdf = sanitizeDiarioFilePart(obraNombrePdf);
      const pdfPath = `${businessIdPdfDiario}/pdfs/diario_${safeObraPdf}_${dateTagPdf}.pdf`;

      const { error: upPdfErr } = await supabase.storage.from('diario-obra').upload(pdfPath, pdfBytes, {
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
      return { error: `Tool de diario no soportada: ${toolName}` };
  }
}
