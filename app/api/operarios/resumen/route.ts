import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabaseAuth
    .from('business_profiles')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.id);
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

function boundsForMonth(yyyyMm: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm.trim());
  if (!m) return null;
  const yStr = m[1]!;
  const moStr = m[2]!;
  const y = Number(yStr);
  const mo = Number(moStr);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  const start = `${yStr}-${moStr}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const end = `${yStr}-${moStr}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export type OperarioResumenPorObra = {
  obra_id: string;
  obra_nombre: string;
  horas_reales: number;
  horas_convenio: number;
};

export type OperarioResumenFila = {
  id: string;
  nombre: string;
  horas_reales_mes: number;
  horas_convenio_mes: number;
  por_obra: OperarioResumenPorObra[];
};

/**
 * GET ?business_id=UUID&mes=YYYY-MM
 * Resumen mensual de operarios activos y desglose por obra.
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const businessId = (searchParams.get('business_id') ?? '').trim();
    if (!businessId) {
      return NextResponse.json({ error: 'business_id es requerido' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const mesParam = (searchParams.get('mes') ?? '').trim();
    const mes = mesParam && boundsForMonth(mesParam) ? mesParam : ymdTodayMadrid().slice(0, 7);
    const bounds = boundsForMonth(mes);
    if (!bounds) {
      return NextResponse.json({ error: 'mes inválido (use YYYY-MM)' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: operariosRows, error: opErr } = await supabase
      .from('operarios')
      .select('id, nombre')
      .eq('business_id', businessId)
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (opErr) {
      return NextResponse.json({ error: opErr.message }, { status: 500 });
    }

    const { data: jornadas, error: jErr } = await supabase
      .from('registros_jornada')
      .select('operario_id, obra_id, horas_reales, horas_convenio, obras ( id, nombre )')
      .eq('business_id', businessId)
      .gte('fecha', bounds.start)
      .lte('fecha', bounds.end);

    if (jErr) {
      return NextResponse.json({ error: jErr.message }, { status: 500 });
    }

    type JRow = {
      operario_id: string;
      obra_id: string | null;
      horas_reales: number | string | null;
      horas_convenio: number | string | null;
      obras?: { id?: string; nombre?: string | null } | null;
    };

    const porOperario = new Map<
      string,
      {
        horas_reales: number;
        horas_convenio: number;
        porObra: Map<string, { obra_nombre: string; horas_reales: number; horas_convenio: number }>;
      }
    >();

    for (const raw of (jornadas ?? []) as JRow[]) {
      const oid = String(raw.operario_id ?? '').trim();
      if (!oid) continue;
      const hr = Number(raw.horas_reales ?? 0) || 0;
      const hc = Number(raw.horas_convenio ?? 0) || 0;
      const obraId = raw.obra_id != null && String(raw.obra_id).trim() ? String(raw.obra_id) : '';
      const obraNom =
        raw.obras && typeof raw.obras === 'object'
          ? String((raw.obras as { nombre?: string | null }).nombre ?? '').trim() || 'Obra'
          : 'Obra';

      let bucket = porOperario.get(oid);
      if (!bucket) {
        bucket = { horas_reales: 0, horas_convenio: 0, porObra: new Map() };
        porOperario.set(oid, bucket);
      }
      bucket.horas_reales += hr;
      bucket.horas_convenio += hc;

      const obKey = obraId || 'sin-obra';
      const prevOb = bucket.porObra.get(obKey);
      if (prevOb) {
        prevOb.horas_reales += hr;
        prevOb.horas_convenio += hc;
      } else {
        bucket.porObra.set(obKey, {
          obra_nombre: obraNom,
          horas_reales: hr,
          horas_convenio: hc,
        });
      }
    }

    const operarios = (operariosRows ?? []) as Array<{ id: string; nombre: string | null }>;
    const filas: OperarioResumenFila[] = operarios.map((op) => {
      const agg = porOperario.get(op.id);
      const por_obra: OperarioResumenPorObra[] = agg
        ? [...agg.porObra.entries()]
            .map(([k, v]) => ({
              obra_id: k === 'sin-obra' ? '' : k,
              obra_nombre: v.obra_nombre,
              horas_reales: v.horas_reales,
              horas_convenio: v.horas_convenio,
            }))
            .sort((a, b) => a.obra_nombre.localeCompare(b.obra_nombre, 'es'))
        : [];

      return {
        id: op.id,
        nombre: String(op.nombre ?? '').trim() || 'Sin nombre',
        horas_reales_mes: agg?.horas_reales ?? 0,
        horas_convenio_mes: agg?.horas_convenio ?? 0,
        por_obra,
      };
    });

    const totales = filas.reduce(
      (acc, o) => {
        acc.horas_reales += o.horas_reales_mes;
        acc.horas_convenio += o.horas_convenio_mes;
        return acc;
      },
      { horas_reales: 0, horas_convenio: 0 }
    );

    return NextResponse.json({
      mes,
      operarios: filas,
      totales,
    });
  } catch (e) {
    console.error('[api/operarios/resumen GET]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
