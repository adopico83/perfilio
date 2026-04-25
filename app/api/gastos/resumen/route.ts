import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { GASTO_CATEGORIAS, normalizeGastoCategoria, type GastoCategoria } from '@/lib/gastos-categoria';

async function assertUserOwnsBusiness(
  supabaseAuth: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  businessId: string
): Promise<boolean> {
  const businessUsersQuery = supabaseAuth.from('business_users') as {
    select?: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: { business_id?: string | null } | null }>;
        };
      };
    };
  };
  if (typeof businessUsersQuery.select === 'function') {
    const { data } = await businessUsersQuery
      .select('business_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data?.business_id);
  }

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

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type GastoResumenFila = {
  id: string;
  fecha: string;
  proveedor: string;
  descripcion: string | null;
  categoria: GastoCategoria;
  importe: number;
  iva: number;
  importe_total: number;
};

export type GastoResumenPorObra = {
  obra_id: string | null;
  obra_nombre: string;
  gastos: GastoResumenFila[];
  subtotal: number;
};

type RawRow = {
  id: string;
  fecha: string | null;
  proveedor: string | null;
  descripcion: string | null;
  categoria: string | null;
  importe: unknown;
  iva: unknown;
  importe_total: unknown;
  obra_id: string | null;
  obras?: { nombre?: string | null } | null;
};

/**
 * GET ?business_id=UUID&mes=YYYY-MM
 * Gastos del mes agrupados por obra y totales por categoría.
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

    const { data: rows, error: gErr } = await supabase
      .from('gastos')
      .select('id, fecha, proveedor, descripcion, categoria, importe, iva, importe_total, obra_id, obras ( nombre )')
      .eq('business_id', businessId)
      .gte('fecha', bounds.start)
      .lte('fecha', bounds.end)
      .order('fecha', { ascending: false });

    if (gErr) {
      return NextResponse.json({ error: gErr.message }, { status: 500 });
    }

    const porCategoria = new Map<GastoCategoria, number>();
    for (const c of GASTO_CATEGORIAS) porCategoria.set(c, 0);

    let totalMes = 0;
    const gruposMap = new Map<
      string,
      { obra_id: string | null; obra_nombre: string; gastos: GastoResumenFila[]; subtotal: number }
    >();

    for (const r of (rows ?? []) as RawRow[]) {
      const cat = normalizeGastoCategoria(r.categoria);
      const fila: GastoResumenFila = {
        id: String(r.id),
        fecha: r.fecha ? String(r.fecha).slice(0, 10) : '',
        proveedor: String(r.proveedor ?? '').trim() || '—',
        descripcion:
          r.descripcion != null && String(r.descripcion).trim() ? String(r.descripcion) : null,
        categoria: cat,
        importe: num(r.importe),
        iva: num(r.iva),
        importe_total: num(r.importe_total),
      };

      totalMes += fila.importe_total;
      porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + fila.importe_total);

      const oid = r.obra_id != null && String(r.obra_id).trim() ? String(r.obra_id).trim() : null;
      const key = oid ?? '__sin_obra__';
      const nombreJoin =
        r.obras && typeof r.obras === 'object'
          ? String((r.obras as { nombre?: string | null }).nombre ?? '').trim()
          : '';
      const obraNombre = oid ? (nombreJoin || 'Obra') : 'Sin obra asignada';

      let g = gruposMap.get(key);
      if (!g) {
        g = { obra_id: oid, obra_nombre: obraNombre, gastos: [], subtotal: 0 };
        gruposMap.set(key, g);
      }
      g.gastos.push(fila);
      g.subtotal += fila.importe_total;
    }

    const por_categoria = GASTO_CATEGORIAS.map((categoria) => ({
      categoria,
      total: porCategoria.get(categoria) ?? 0,
    })).filter((x) => x.total > 0);

    const por_obra: GastoResumenPorObra[] = [...gruposMap.values()].sort((a, b) => {
      const aSin = a.obra_id == null ? 1 : 0;
      const bSin = b.obra_id == null ? 1 : 0;
      if (aSin !== bSin) return aSin - bSin;
      return a.obra_nombre.localeCompare(b.obra_nombre, 'es');
    });

    return NextResponse.json({
      mes,
      total_mes: totalMes,
      por_categoria,
      por_obra,
    });
  } catch (e) {
    console.error('[api/gastos/resumen GET]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
