import type { McpContext } from '@/lib/mcp/context';
import {
  DIARIO_FOTO_INGEST_MAX_ITEMS,
  createDiarioObraSignedUpload,
  ingestDiarioObraFotos,
  type DiarioObraFotoSource,
} from '@/lib/diario-obra-ingest';
import { crearCitaAgenda, listarCitasAgenda } from '@/lib/mcp/citas';
import { obtenerEnlacePdfPresupuesto } from '@/lib/presupuestos/enlace-pdf';
import { listarPresupuestos, verPresupuesto } from '@/lib/presupuestos/lectura';
import { insertarPresupuestoConNumeroCorrelativo } from '@/lib/presupuestos/numero';
import {
  calcularPreviewPresupuesto,
  guardarPreviewPresupuesto,
  confirmarPreviewPresupuesto,
  type PreviewPresupuestoInput,
  type AvisoPreview,
} from '@/lib/presupuestos/preview';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import {
  generarTextoCanonico,
  TOLERANCIA_IMPORTE,
  type PartidaCanonicaEntrada,
} from '@/lib/presupuestos/texto-canonico';

function escapeIlikePattern(s: string): string {
  return s.replace(/[%_*]/g, '');
}

function ymdTodayMadrid(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
}

function parseYmdOptional(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function buscarObraPorNombre(
  ctx: McpContext,
  obraNombre: string
): Promise<{ ok: true; id: string; nombre: string; direccion: string | null } | { ok: false; error: string }> {
  const safe = escapeIlikePattern(obraNombre).trim();
  if (!safe) return { ok: false, error: 'obra_nombre es obligatorio' };
  const { data, error } = await ctx.supabase
    .from('obras')
    .select('id, nombre, direccion')
    .eq('business_id', ctx.businessId)
    .ilike('nombre', `%${safe}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return { ok: false, error: error.message };
  const rows = data ?? [];
  if (rows.length === 0) {
    return { ok: false, error: `No se encontró ninguna obra que coincida con «${obraNombre}».` };
  }
  if (rows.length > 1) {
    const lista = rows.map((r: { nombre?: string | null }, i: number) => `${i + 1}. ${r.nombre ?? '—'}`).join('\n');
    return {
      ok: false,
      error: `Hay varias obras que encajan:\n${lista}\nIndica un nombre más concreto.`,
    };
  }
  const row = rows[0] as { id: string; nombre: string | null; direccion: string | null };
  return {
    ok: true,
    id: row.id,
    nombre: String(row.nombre ?? '').trim() || obraNombre,
    direccion: row.direccion ?? null,
  };
}

/**
 * Valida un obra_id opcional contra la tabla `obras` del negocio. Devuelve
 * `obraId: null` si no se pasó ninguno; error si no existe o es de otro negocio.
 */
async function resolverObraId(
  ctx: McpContext,
  obraIdRaw: string | null
): Promise<{ ok: true; obraId: string | null } | { ok: false; error: string }> {
  if (!obraIdRaw) return { ok: true, obraId: null };
  const { data: obraRow, error: obraErr } = await ctx.supabase
    .from('obras')
    .select('id')
    .eq('business_id', ctx.businessId)
    .eq('id', obraIdRaw)
    .maybeSingle();
  if (obraErr) return { ok: false, error: obraErr.message };
  if (!obraRow?.id) {
    return { ok: false, error: 'obra_id no existe o no pertenece a este negocio' };
  }
  return { ok: true, obraId: obraRow.id as string };
}

export async function executeMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: McpContext
): Promise<unknown> {
  switch (toolName) {
    case 'crear_cita':
      return crearCitaAgenda(ctx, toolArgs);
    case 'ver_citas':
      return listarCitasAgenda(ctx, toolArgs);
    case 'ver_presupuestos':
      return listarPresupuestos(ctx, toolArgs);
    case 'ver_presupuesto':
      return verPresupuesto(ctx, toolArgs);
    case 'obtener_enlace_pdf_presupuesto':
      return obtenerEnlacePdfPresupuesto(ctx, toolArgs);
    case 'ver_obras_activas': {
      const { data, error } = await ctx.supabase
        .from('obras')
        .select('id, nombre, direccion, estado, created_at')
        .eq('business_id', ctx.businessId)
        .neq('estado', 'cerrada')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { items: data ?? [] };
    }
    case 'ver_facturas_pendientes': {
      const { data, error } = await ctx.supabase
        .from('facturas')
        .select('id, numero_factura, cliente_nombre, total, estado, created_at')
        .eq('business_id', ctx.businessId)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { items: data ?? [] };
    }
    case 'crear_presupuesto': {
      const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
      if (!clienteNombre) return { ok: false, code: 'validacion', error: 'cliente_nombre es obligatorio' };

      const obraIdRaw =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? toolArgs.obra_id.trim()
          : null;
      const obraResuelta = await resolverObraId(ctx, obraIdRaw);
      if (!obraResuelta.ok) return { ok: false, code: 'validacion', error: obraResuelta.error };
      const obraId = obraResuelta.obraId;

      const tieneCapitulos = Array.isArray(toolArgs.capitulos) && toolArgs.capitulos.length > 0;

      if (tieneCapitulos) {
        // --- Camino nuevo: mismo cálculo que previsualizar_presupuesto, pero
        // guarda la preview y la confirma en la misma llamada (atajo sin
        // revisión humana).
        const input: PreviewPresupuestoInput = {
          cliente_nombre: clienteNombre,
          obra_id: obraId,
          iva_porcentaje: typeof toolArgs.iva_porcentaje === 'number' ? toolArgs.iva_porcentaje : undefined,
          capitulos: toolArgs.capitulos as PreviewPresupuestoInput['capitulos'],
          total_declarado: typeof toolArgs.total === 'number' ? toolArgs.total : undefined,
        };
        const resultado = calcularPreviewPresupuesto(input);
        if (!resultado.ok) return { ok: false, code: 'validacion', error: resultado.error };
        if (!resultado.confirmable) {
          return {
            ok: false,
            code: 'validacion',
            error:
              'No se puede crear: hay partidas sin precio. Usa previsualizar_presupuesto para revisarlas.',
          };
        }
        const guardado = await guardarPreviewPresupuesto(
          ctx.supabase,
          ctx.businessId,
          ctx.userId,
          input,
          resultado,
          new Date()
        );
        if (!guardado.ok) return { ok: false, code: 'validacion', error: guardado.error };
        const confirmado = await confirmarPreviewPresupuesto(
          ctx.supabase,
          ctx.businessId,
          guardado.previewId,
          new Date()
        );
        if (!confirmado.ok) return { ok: false, code: confirmado.code, error: confirmado.error };
        return {
          ok: true,
          presupuesto: {
            id: confirmado.presupuestoId,
            numero_presupuesto: confirmado.numeroPresupuesto,
            cliente_nombre: confirmado.clienteNombre,
            importe_total: confirmado.total,
            estado: confirmado.estado,
            fecha: confirmado.fecha,
          },
          avisos: resultado.avisos,
        };
      }

      // --- Camino legacy: descripcion + total sueltos.
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      if (!descripcion) return { error: 'descripcion o capitulos es obligatorio' };

      const parsed = parsePresupuestoGenerado(descripcion);
      const partidasEncontradas = parsed.capitulos.flatMap((c) => c.partidas);
      if (partidasEncontradas.length === 0) {
        return {
          ok: false,
          code: 'validacion',
          error:
            'No se pudieron interpretar partidas en descripcion (texto libre ya no se acepta). Usa previsualizar_presupuesto con capitulos estructurados.',
        };
      }

      // Recalcula desde las partidas ya interpretadas; nunca confía en el total suelto.
      const partidasCanonicas: PartidaCanonicaEntrada[] = parsed.capitulos.flatMap((cap) =>
        cap.partidas.map((p) => ({
          concepto: p.concepto,
          cantidad: p.cantidad,
          precio: p.precio,
          capitulo: cap.nombre.replace(/^CAP[IÍ]TULO\s+/i, ''),
        }))
      );
      const ivaPct = parsed.porcentajeIva;
      const recalculo = generarTextoCanonico(partidasCanonicas, ivaPct);
      if (!recalculo.ok) return { error: recalculo.error };

      const avisos: AvisoPreview[] = [];
      const totalDeclarado = Number(toolArgs.total);
      if (
        Number.isFinite(totalDeclarado) &&
        Math.abs(totalDeclarado - recalculo.total) > TOLERANCIA_IMPORTE + 1e-9
      ) {
        avisos.push({ tipo: 'total_corregido', declarado: totalDeclarado, calculado: recalculo.total });
      }

      const creado = await insertarPresupuestoConNumeroCorrelativo(
        ctx.supabase,
        ctx.businessId,
        {
          cliente_nombre: clienteNombre,
          presupuesto_generado: recalculo.texto,
          importe_total: recalculo.total,
          fecha: ymdTodayMadrid(),
          estado: 'borrador',
          ...(obraId ? { obra_id: obraId } : {}),
        },
        'id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha'
      );
      if (!creado.ok) return { error: creado.error };
      return { ok: true, presupuesto: creado.data, avisos };
    }
    case 'previsualizar_presupuesto': {
      const clienteNombre = String(toolArgs.cliente_nombre ?? '').trim().slice(0, 255);
      if (!clienteNombre) return { ok: false, code: 'validacion', error: 'cliente_nombre es obligatorio' };

      const obraIdRaw =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? toolArgs.obra_id.trim()
          : null;
      const obraResuelta = await resolverObraId(ctx, obraIdRaw);
      if (!obraResuelta.ok) return { ok: false, code: 'validacion', error: obraResuelta.error };

      const input: PreviewPresupuestoInput = {
        cliente_nombre: clienteNombre,
        obra_id: obraResuelta.obraId,
        iva_porcentaje: typeof toolArgs.iva_porcentaje === 'number' ? toolArgs.iva_porcentaje : undefined,
        observaciones: typeof toolArgs.observaciones === 'string' ? toolArgs.observaciones : undefined,
        capitulos: Array.isArray(toolArgs.capitulos)
          ? (toolArgs.capitulos as PreviewPresupuestoInput['capitulos'])
          : [],
        total_declarado:
          typeof toolArgs.total_declarado === 'number' ? toolArgs.total_declarado : undefined,
      };

      const resultado = calcularPreviewPresupuesto(input);
      if (!resultado.ok) {
        return { ok: false, code: 'validacion', error: resultado.error };
      }

      const base = {
        ok: true as const,
        confirmable: resultado.confirmable,
        avisos: resultado.avisos,
        capitulos: resultado.capitulos,
        base_imponible: resultado.base_imponible,
        iva_importe: resultado.iva_importe,
        total: resultado.total,
        texto_canonico: resultado.texto_canonico,
        cliente_nombre: input.cliente_nombre,
        obra_id: input.obra_id,
        iva_porcentaje: input.iva_porcentaje ?? 21,
      };

      if (!resultado.confirmable) {
        return {
          ...base,
          preview_id: null,
          expires_at: null,
          siguiente_paso:
            'Corrige los avisos (falta precio en alguna partida) antes de poder previsualizar de nuevo.',
        };
      }

      const guardado = await guardarPreviewPresupuesto(
        ctx.supabase,
        ctx.businessId,
        ctx.userId,
        input,
        resultado,
        new Date()
      );
      if (!guardado.ok) {
        return { ok: false, code: 'validacion', error: guardado.error };
      }

      return {
        ...base,
        preview_id: guardado.previewId,
        expires_at: guardado.expiresAt,
        siguiente_paso:
          'Enseña este resumen (capítulos, avisos y total) al usuario. Si lo aprueba explícitamente, llama a confirmar_presupuesto con este preview_id.',
      };
    }
    case 'confirmar_presupuesto': {
      const previewId = typeof toolArgs.preview_id === 'string' ? toolArgs.preview_id.trim() : '';
      if (!previewId) {
        return { ok: false, code: 'validacion', error: 'preview_id es obligatorio' };
      }
      const r = await confirmarPreviewPresupuesto(ctx.supabase, ctx.businessId, previewId, new Date());
      if (!r.ok) {
        return { ok: false, code: r.code, error: r.error };
      }
      return {
        ok: true,
        presupuesto_id: r.presupuestoId,
        numero_presupuesto: r.numeroPresupuesto,
        cliente_nombre: r.clienteNombre,
        base_imponible: r.baseImponible,
        iva_importe: r.ivaImporte,
        total: r.total,
        estado: r.estado,
        fecha: r.fecha,
      };
    }
    case 'registrar_horas': {
      const operarioNombre = String(toolArgs.operario_nombre ?? '').trim();
      const obraNombre = String(toolArgs.obra_nombre ?? '').trim();
      const horas = Number(toolArgs.horas);
      if (!operarioNombre) return { error: 'operario_nombre es obligatorio' };
      if (!obraNombre) return { error: 'obra_nombre es obligatorio' };
      if (!Number.isFinite(horas) || horas < 0) {
        return { error: 'horas debe ser un número válido ≥ 0' };
      }
      const fecha = parseYmdOptional(toolArgs.fecha) ?? ymdTodayMadrid();
      const horasN = Math.round(horas * 100) / 100;

      const safeOp = escapeIlikePattern(operarioNombre).trim();
      const { data: opRows, error: opErr } = await ctx.supabase
        .from('operarios')
        .select('id, nombre')
        .eq('business_id', ctx.businessId)
        .eq('activo', true)
        .ilike('nombre', `%${safeOp}%`)
        .limit(5);
      if (opErr) return { error: opErr.message };
      const operarios = opRows ?? [];
      if (operarios.length === 0) {
        return { error: `No encontré un operario activo que coincida con «${operarioNombre}».` };
      }
      if (operarios.length > 1) {
        const lista = operarios
          .map((o: { nombre?: string | null }, i: number) => `${i + 1}. ${o.nombre ?? '—'}`)
          .join('\n');
        return { error: `Hay varios operarios que encajan:\n${lista}` };
      }
      const operario = operarios[0] as { id: string; nombre: string | null };

      const obraRes = await buscarObraPorNombre(ctx, obraNombre);
      if (!obraRes.ok) return { error: obraRes.error };

      const { data: existente } = await ctx.supabase
        .from('registros_jornada')
        .select('id')
        .eq('business_id', ctx.businessId)
        .eq('operario_id', operario.id)
        .eq('obra_id', obraRes.id)
        .eq('fecha', fecha)
        .maybeSingle();

      if (existente?.id) {
        const { data: updated, error: updErr } = await ctx.supabase
          .from('registros_jornada')
          .update({
            horas_reales: horasN,
            horas_convenio: horasN,
          })
          .eq('id', existente.id)
          .eq('business_id', ctx.businessId)
          .select('id')
          .maybeSingle();
        if (updErr) return { error: updErr.message };
        return { ok: true, actualizado: true, id: updated?.id ?? existente.id };
      }

      const { data: inserted, error: insErr } = await ctx.supabase
        .from('registros_jornada')
        .insert({
          business_id: ctx.businessId,
          operario_id: operario.id,
          obra_id: obraRes.id,
          fecha,
          horas_reales: horasN,
          horas_convenio: horasN,
        })
        .select('id')
        .single();
      if (insErr) return { error: insErr.message };
      return { ok: true, id: (inserted as { id: string }).id };
    }
    case 'crear_entrada_diario': {
      const obraNombre = String(toolArgs.obra_nombre ?? '').trim();
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      if (!obraNombre) return { error: 'obra_nombre es obligatorio' };
      if (!descripcion) return { error: 'descripcion es obligatoria' };
      const fecha = parseYmdOptional(toolArgs.fecha) ?? ymdTodayMadrid();

      const obraRes = await buscarObraPorNombre(ctx, obraNombre);
      if (!obraRes.ok) return { error: obraRes.error };

      const { data: inserted, error: insErr } = await ctx.supabase
        .from('diario_obra')
        .insert({
          business_id: ctx.businessId,
          obra_id: obraRes.id,
          obra_nombre: obraRes.nombre,
          obra_direccion: obraRes.direccion,
          texto: descripcion,
          fecha,
        })
        .select('id, obra_nombre, texto, fecha')
        .single();
      if (insErr) return { error: insErr.message };
      return { ok: true, entrada: inserted };
    }
    case 'crear_upload_firmado_diario': {
      return createDiarioObraSignedUpload(ctx.supabase, {
        businessId: ctx.businessId,
        mimeType: typeof toolArgs.mime_type === 'string' ? toolArgs.mime_type : '',
        fileName: typeof toolArgs.nombre_archivo === 'string' ? toolArgs.nombre_archivo : undefined,
        entradaId:
          typeof toolArgs.entrada_diario_id === 'string' ? toolArgs.entrada_diario_id : undefined,
      });
    }
    case 'adjuntar_foto_diario': {
      if (toolArgs.foto_base64 != null) {
        return {
          error:
            'foto_base64 ya no se admite. Crea una subida firmada con crear_upload_firmado_diario y adjunta storage_paths, o envía foto_urls (1 a 8 URLs https).',
        };
      }
      const hasPaths = toolArgs.storage_paths != null;
      const hasUrls = toolArgs.foto_urls != null;
      if (hasPaths && hasUrls) {
        return { error: 'Indica solo storage_paths o solo foto_urls, no ambos.' };
      }
      if (!hasPaths && !hasUrls) {
        return {
          error: `Indica storage_paths (1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} rutas del bucket diario-obra) o, en integraciones, foto_urls (1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} URLs https).`,
        };
      }

      const entradaId =
        typeof toolArgs.entrada_diario_id === 'string' ? toolArgs.entrada_diario_id : '';
      if (hasPaths) {
        const paths = stringList(toolArgs.storage_paths);
        if (!paths) {
          return {
            error: `storage_paths debe ser un array de 1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} rutas.`,
          };
        }
        if (paths.length < 1 || paths.length > DIARIO_FOTO_INGEST_MAX_ITEMS) {
          return {
            error: `storage_paths admite de 1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} rutas del bucket diario-obra.`,
          };
        }
        const sources: DiarioObraFotoSource[] = paths.map((path) => ({
          type: 'storage_path',
          path,
        }));
        return ingestDiarioObraFotos(ctx.supabase, {
          businessId: ctx.businessId,
          entradaId,
          sources,
        });
      }

      const urls = stringList(toolArgs.foto_urls);
      if (!urls) {
        return {
          error: `foto_urls es obligatorio (array de 1 a ${DIARIO_FOTO_INGEST_MAX_ITEMS} URLs https).`,
        };
      }
      const sources: DiarioObraFotoSource[] = urls.map((url) => ({ type: 'url', url }));
      return ingestDiarioObraFotos(ctx.supabase, {
        businessId: ctx.businessId,
        entradaId,
        sources,
      });
    }
    default:
      return { error: `Tool no soportada: ${toolName}` };
  }
}
