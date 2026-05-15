import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDiarioObraPdf,
  collectDiarioObraStoragePathsFromEntry,
  decodeDataUrlImageForDiarioUpload,
  fetchDiarioObraEntries,
  insertDiarioObraEntry,
  normalizeDiarioObraRowMediaForInsert,
  removeDiarioObraStorageObjects,
  sanitizeDiarioFilePart,
  signDiarioObraEntriesMedia,
  uploadDiarioObraMediaToBucket,
} from '@/lib/diario-obra';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';

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

export const DIARIO_HANDLED_TOOLS = new Set([
  'crear_entrada_diario',
  'eliminar_entrada_diario',
  'generar_pdf_diario',
]);

export const DIARIO_AGENT_SYSTEM_PROMPT = `Tu nombre es Bicho. Si el usuario te llama por tu nombre al inicio de una petición ('Oye Bicho...', 'Bicho escucha...', 'Bicho añade...', 'Eh Bicho...' o similar), ignora el nombre y ejecuta directamente lo que pide a continuación. No respondas al nombre, no lo confirmes, simplemente actúa.

ERES EL ESPECIALISTA EN DIARIO DE OBRA DE PERFILIO. TU ÚNICO TRABAJO ES REGISTRAR ENTRADAS EN EL DIARIO.

REGLAS ABSOLUTAS — NUNCA LAS INCUMPLAS:

1. NUNCA digas 'Anotado', 'Registrado', 'Guardado' ni ninguna confirmación SIN haber recibido TOOL RESULT de crear_entrada_diario con ok:true. Si no tienes el TOOL RESULT, no puedes confirmar. Llama a la tool primero.

2. NUNCA inventes ni asumas una obra. Si el usuario no especifica la obra claramente, pregunta: '¿En qué obra anoto esto? ¿Es [obra X] o [obra Y]?' Espera la respuesta antes de llamar a cualquier tool.

3. Si hay imágenes en el mensaje, SIEMPRE inclúyelas en la entrada. Nunca ignores fotos. Si no puedes procesarlas, dilo explícitamente.

4. NUNCA llames a crear_entrada_diario con obra_id null o vacío. Si no tienes el obra_id resuelto, usa primero la tool de búsqueda de obras para encontrarlo.

5. Después de cada entrada creada, confirma SIEMPRE con este formato exacto: 'Anotado en el diario de [nombre obra] ([fecha]): [resumen breve de lo anotado]'

6. Si recibes un error de cualquier tool, comunícalo al usuario de forma clara. NUNCA silencies un error.

7. NUNCA hagas dos acciones a la vez. Primero resuelve la obra, luego crea la entrada. Secuencial siempre. Usa parallel_tool_calls: false.

8. Si el usuario dice algo ambiguo como 'anota esto' sin más contexto, pregunta qué quiere anotar y en qué obra antes de actuar.`;

export type HandleDiarioCtx = {
  mensajeTrim?: string;
  imagenesNormalizadas?: string[];
  fotosAdjuntasStorage?: string[];
};

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
        const paths = collectDiarioObraStoragePathsFromEntry({
          fotos: rowD.fotos as string[] | null,
          videos: rowD.videos as string[] | null,
        });
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
        'entrada_diario'
      );
      if (!obraResDiario.ok) return { mensaje: obraResDiario.mensaje };
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

      const obraNombreDiario = String(toolArgs.obra_nombre ?? '').trim();
      if (!obraNombreDiario) {
        return { error: 'obra_nombre es obligatorio' };
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
      const fotosDiario = Array.isArray(toolArgs.fotos)
        ? toolArgs.fotos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : undefined;
      const videosDiario = Array.isArray(toolArgs.videos)
        ? toolArgs.videos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : undefined;

      const toolMedia = normalizeDiarioObraRowMediaForInsert({
        fotos: fotosDiario ?? null,
        videos: videosDiario ?? null,
      });
      const fotosDesdeTool = toolMedia.fotos ?? [];
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
        'entrada_diario'
      );
      if (!obraDiarioRes.ok) return { mensaje: obraDiarioRes.mensaje };

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
      });

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
        const entradasConUrls = await signDiarioObraEntriesMedia(supabase, entradasPdf);
        pdfBytes = await buildDiarioObraPdf(entradasConUrls);
      } catch (e) {
        console.error('buildDiarioObraPdf', e);
        return { error: 'No se pudo generar el PDF' };
      }

      const dateTagPdf = new Date().toISOString().slice(0, 10);
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
