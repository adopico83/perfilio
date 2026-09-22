import type { McpContext } from '@/lib/mcp/context';
import {
  DIARIO_FOTO_INGEST_MAX_ITEMS,
  createDiarioObraSignedUpload,
  ingestDiarioObraFotos,
  type DiarioObraFotoSource,
} from '@/lib/diario-obra-ingest';

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

export async function executeMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: McpContext
): Promise<unknown> {
  switch (toolName) {
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
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      const total = Number(toolArgs.total);
      if (!clienteNombre) return { error: 'cliente_nombre es obligatorio' };
      if (!descripcion) return { error: 'descripcion es obligatoria' };
      if (!Number.isFinite(total)) return { error: 'total debe ser un número válido' };

      let obraId: string | null = null;
      const obraIdRaw =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? toolArgs.obra_id.trim()
          : null;
      if (obraIdRaw) {
        const { data: obraRow, error: obraErr } = await ctx.supabase
          .from('obras')
          .select('id')
          .eq('business_id', ctx.businessId)
          .eq('id', obraIdRaw)
          .maybeSingle();
        if (obraErr) return { error: obraErr.message };
        if (!obraRow?.id) {
          return { error: 'obra_id no existe o no pertenece a este negocio' };
        }
        obraId = obraRow.id as string;
      }

      const { data: lastPres, error: lastPresErr } = await ctx.supabase
        .from('presupuestos')
        .select('numero_presupuesto')
        .eq('business_id', ctx.businessId)
        .order('numero_presupuesto', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPresErr) return { error: lastPresErr.message };
      const numeroPresupuesto =
        (Number((lastPres as { numero_presupuesto?: number | null } | null)?.numero_presupuesto) ||
          0) + 1;

      const { data: inserted, error: insErr } = await ctx.supabase
        .from('presupuestos')
        .insert({
          business_id: ctx.businessId,
          numero_presupuesto: numeroPresupuesto,
          cliente_nombre: clienteNombre,
          presupuesto_generado: descripcion,
          importe_total: total,
          fecha: ymdTodayMadrid(),
          estado: 'borrador',
          ...(obraId ? { obra_id: obraId } : {}),
        })
        .select('id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha')
        .single();
      if (insErr) {
        if (insErr.code === '23505') {
          return { error: 'Colisión al generar número de presupuesto. Inténtalo de nuevo.' };
        }
        return { error: insErr.message };
      }
      return { ok: true, presupuesto: inserted };
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
