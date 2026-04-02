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
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, descripcion, created_at, updated_at'
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

    const [cliRes, presRes, facRes, albRes, dioRes] = await Promise.all([
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

    const obrasConConteo = obras.map((o) => ({
      ...o,
      cliente_nombre: o.cliente_id ? clienteMap.get(o.cliente_id) ?? null : null,
      num_presupuestos: mp.get(o.id) ?? 0,
      num_facturas: mf.get(o.id) ?? 0,
      num_albaranes: ma.get(o.id) ?? 0,
      num_entradas_diario: md.get(o.id) ?? 0,
    }));

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
    const estadoRaw = typeof b.estado === 'string' ? b.estado.trim() : '';
    const estado = estadoRaw.toLowerCase();

    const ESTADOS_PERMITIDOS = new Set(['abierta', 'en_curso', 'pausada', 'cerrada']);
    if (!id || !estado) {
      return NextResponse.json({ error: 'id y estado son obligatorios' }, { status: 400 });
    }
    if (!ESTADOS_PERMITIDOS.has(estado)) {
      return NextResponse.json(
        { error: `estado inválido. Usa: ${Array.from(ESTADOS_PERMITIDOS).join(', ')}` },
        { status: 400 }
      );
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

    const { data: updated, error: updErr } = await supabase
      .from('obras')
      .update({ estado })
      .eq('id', id)
      .select(
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, descripcion, created_at, updated_at'
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

