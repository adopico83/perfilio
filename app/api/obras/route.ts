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

type ObraRow = {
  id: string;
  business_id: string;
  cliente_id: string | null;
  nombre: string;
  direccion: string | null;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  descripcion: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const business_id = request.nextUrl.searchParams.get('business_id')?.trim() ?? '';
    if (!business_id) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const estadoRaw = request.nextUrl.searchParams.get('estado')?.trim() ?? '';
    const estado = estadoRaw.length > 0 ? estadoRaw : undefined;

    const supabase = createServiceClient();

    let q = supabase
      .from('obras')
      .select(
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, fecha_fin, descripcion, created_at, updated_at'
      )
      .eq('business_id', business_id)
      .order('created_at', { ascending: false });

    if (estado) q = q.eq('estado', estado);

    const { data: obrasRows, error: obrasErr } = await q;
    if (obrasErr) {
      return NextResponse.json({ error: obrasErr.message }, { status: 500 });
    }

    const obras = (obrasRows ?? []) as ObraRow[];
    if (obras.length === 0) {
      return NextResponse.json({ obras: [] });
    }

    const obraIds = obras.map((o) => o.id);
    const clienteIds = obras.map((o) => o.cliente_id).filter((id0): id0 is string => Boolean(id0));

    const cliPromise =
      clienteIds.length > 0
        ? supabase.from('clientes').select('id, nombre').in('id', clienteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nombre: string }>, error: null });

    const [cliRes, presRes, facRes, albRes, dioRes, gasRes] = await Promise.all([
      cliPromise,
      supabase
        .from('presupuestos')
        .select('obra_id')
        .in('obra_id', obraIds),
      supabase
        .from('facturas')
        .select('obra_id')
        .in('obra_id', obraIds),
      supabase
        .from('albaranes')
        .select('obra_id')
        .in('obra_id', obraIds),
      supabase
        .from('diario_obra')
        .select('obra_id')
        .in('obra_id', obraIds),
      supabase
        .from('gastos')
        .select('obra_id')
        .in('obra_id', obraIds),
    ]);

    const clienteMap = new Map<string, string>();
    for (const r of (cliRes.data ?? []) as Array<{ id: string; nombre: string }>) {
      clienteMap.set(r.id, r.nombre);
    }

    const countMap = (rows: Array<{ obra_id: string | null }> | null) => {
      const m = new Map<string, number>();
      for (const id of obraIds) m.set(id, 0);
      for (const r of rows ?? []) {
        const oid = r.obra_id;
        if (!oid) continue;
        if (!m.has(oid)) m.set(oid, 0);
        m.set(oid, (m.get(oid) ?? 0) + 1);
      }
      return m;
    };

    const mp = countMap((presRes.data ?? []) as Array<{ obra_id: string | null }>);
    const mf = countMap((facRes.data ?? []) as Array<{ obra_id: string | null }>);
    const ma = countMap((albRes.data ?? []) as Array<{ obra_id: string | null }>);
    const md = countMap((dioRes.data ?? []) as Array<{ obra_id: string | null }>);
    const mg = countMap((gasRes.data ?? []) as Array<{ obra_id: string | null }>);

    const obrasConConteo = obras.map((o) => {
      const np = mp.get(o.id) ?? 0;
      const nf = mf.get(o.id) ?? 0;
      const na = ma.get(o.id) ?? 0;
      const nd = md.get(o.id) ?? 0;
      const ng = mg.get(o.id) ?? 0;
      const tiene_diario = nd > 0 ? 1 : 0;
      return {
        ...o,
        cliente_nombre: o.cliente_id ? clienteMap.get(o.cliente_id) ?? null : null,
        num_presupuestos: np,
        num_facturas: nf,
        num_albaranes: na,
        num_gastos: ng,
        tiene_diario,
        total_documentos: np + nf + na + ng + tiene_diario,
      };
    });

    return NextResponse.json({ obras: obrasConConteo });
  } catch (e) {
    console.error('[api/obras GET]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const business_id = typeof b.business_id === 'string' ? b.business_id.trim() : '';
    const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
    const cliente_id = typeof b.cliente_id === 'string' ? b.cliente_id.trim() : null;
    const direccion = typeof b.direccion === 'string' ? b.direccion.trim() : null;
    const estado = typeof b.estado === 'string' ? b.estado.trim() : null;
    const fecha_inicio = typeof b.fecha_inicio === 'string' ? b.fecha_inicio.trim() : null;
    const descripcion = typeof b.descripcion === 'string' ? b.descripcion.trim() : null;

    if (!business_id || !nombre) {
      return NextResponse.json({ error: 'business_id y nombre son obligatorios' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const payload: Record<string, unknown> = {
      business_id,
      nombre,
      ...(cliente_id ? { cliente_id } : { cliente_id: null }),
      ...(direccion !== null ? { direccion } : { direccion: null }),
      ...(estado ? { estado } : { estado: 'abierta' }),
      ...(fecha_inicio ? { fecha_inicio } : { fecha_inicio: null }),
      ...(descripcion !== null ? { descripcion } : { descripcion: null }),
    };

    const { data, error } = await supabase
      .from('obras')
      .insert(payload)
      .select(
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, descripcion, created_at, updated_at'
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudo crear la obra' },
        { status: 500 }
      );
    }

    return NextResponse.json({ obra: data });
  } catch (e) {
    console.error('[api/obras POST]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.trim() : '';

    const ESTADOS_PERMITIDOS = new Set(['abierta', 'en_curso', 'pausada', 'cerrada']);

    if (!id) {
      return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: obraRow, error: obraErr } = await supabase
      .from('obras')
      .select('id, business_id')
      .eq('id', id)
      .maybeSingle();

    if (obraErr || !obraRow?.business_id) {
      return NextResponse.json({ error: 'Obra no encontrada' }, { status: 404 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, String(obraRow.business_id));
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a esta obra' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};

    if (typeof b.estado === 'string' && b.estado.trim()) {
      const estado = b.estado.trim().toLowerCase();
      if (!ESTADOS_PERMITIDOS.has(estado)) {
        return NextResponse.json(
          { error: `estado inválido. Usa: ${Array.from(ESTADOS_PERMITIDOS).join(', ')}` },
          { status: 400 }
        );
      }
      updates.estado = estado;
    }

    if (typeof b.nombre === 'string') {
      const nombre = b.nombre.trim();
      if (!nombre) {
        return NextResponse.json({ error: 'nombre no puede estar vacío' }, { status: 400 });
      }
      updates.nombre = nombre;
    }

    if (b.direccion !== undefined) {
      updates.direccion =
        typeof b.direccion === 'string' && b.direccion.trim()
          ? b.direccion.trim()
          : null;
    }

    if (b.descripcion !== undefined) {
      updates.descripcion =
        typeof b.descripcion === 'string' && b.descripcion.trim()
          ? b.descripcion.trim()
          : null;
    }

    if (b.fecha_inicio !== undefined) {
      const fi = typeof b.fecha_inicio === 'string' ? b.fecha_inicio.trim() : '';
      updates.fecha_inicio = fi ? fi : null;
    }

    if (b.fecha_fin !== undefined) {
      const ff = typeof b.fecha_fin === 'string' ? b.fecha_fin.trim() : '';
      updates.fecha_fin = ff ? ff : null;
    }

    if (b.cliente_id !== undefined) {
      if (b.cliente_id === null || b.cliente_id === '') {
        updates.cliente_id = null;
      } else if (typeof b.cliente_id === 'string' && b.cliente_id.trim()) {
        const cid = b.cliente_id.trim();
        const { data: cli } = await supabase
          .from('clientes')
          .select('id')
          .eq('id', cid)
          .eq('business_id', obraRow.business_id)
          .maybeSingle();
        if (!cli?.id) {
          return NextResponse.json({ error: 'cliente_id no válido para este negocio' }, { status: 400 });
        }
        updates.cliente_id = cid;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Indica al menos un campo a actualizar' },
        { status: 400 }
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from('obras')
      .update(updates)
      .eq('id', id)
      .select(
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, fecha_fin, descripcion, created_at, updated_at'
      )
      .maybeSingle();

    if (updErr || !updated) {
      return NextResponse.json({ error: updErr?.message ?? 'No se pudo actualizar' }, { status: 500 });
    }

    return NextResponse.json({ obra: updated });
  } catch (e) {
    console.error('[api/obras PATCH]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

