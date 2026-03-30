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

function sanitizeIlikeFragment(s: string): string {
  return s.replace(/[%_*]/g, '').slice(0, 120);
}

type ClienteRow = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  nif: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

async function attachDocumentCounts(
  supabase: ReturnType<typeof createServiceClient>,
  businessId: string,
  clientes: ClienteRow[]
): Promise<
  Array<
    ClienteRow & {
      num_presupuestos: number;
      num_facturas: number;
      num_albaranes: number;
    }
  >
> {
  if (clientes.length === 0) return [];
  const ids = clientes.map((c) => c.id);

  const [presRes, facRes, albRes] = await Promise.all([
    supabase.from('presupuestos').select('cliente_id').eq('business_id', businessId).in('cliente_id', ids),
    supabase.from('facturas').select('cliente_id').eq('business_id', businessId).in('cliente_id', ids),
    supabase.from('albaranes').select('cliente_id').eq('business_id', businessId).in('cliente_id', ids),
  ]);

  const countMap = (rows: { cliente_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const id of ids) m.set(id, 0);
    for (const r of rows ?? []) {
      const cid = r.cliente_id;
      if (!cid) continue;
      m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  };

  const mp = countMap((presRes.data ?? []) as { cliente_id: string | null }[]);
  const mf = countMap((facRes.data ?? []) as { cliente_id: string | null }[]);
  const ma = countMap((albRes.data ?? []) as { cliente_id: string | null }[]);

  return clientes.map((c) => ({
    ...c,
    num_presupuestos: mp.get(c.id) ?? 0,
    num_facturas: mf.get(c.id) ?? 0,
    num_albaranes: ma.get(c.id) ?? 0,
  }));
}

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

    const qRaw = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    const supabase = createServiceClient();

    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at')
      .eq('business_id', business_id)
      .order('nombre', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const safe = sanitizeIlikeFragment(qRaw);
    let rows = (clientes ?? []) as ClienteRow[];
    if (safe.length > 0) {
      const low = safe.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.nombre.toLowerCase().includes(low) ||
          (c.email != null && c.email.toLowerCase().includes(low)) ||
          (c.telefono != null && c.telefono.includes(safe))
      );
    }
    const withCounts = await attachDocumentCounts(supabase, business_id, rows);

    return NextResponse.json({ clientes: withCounts });
  } catch (e) {
    console.error('[api/clientes GET]', e);
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
    if (!business_id || !nombre) {
      return NextResponse.json(
        { error: 'business_id y nombre son obligatorios' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const telefono = typeof b.telefono === 'string' ? b.telefono.trim() || null : null;
    const email = typeof b.email === 'string' ? b.email.trim() || null : null;
    const direccion = typeof b.direccion === 'string' ? b.direccion.trim() || null : null;
    const nif = typeof b.nif === 'string' ? b.nif.trim() || null : null;
    const notas = typeof b.notas === 'string' ? b.notas.trim() || null : null;

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('clientes')
      .insert({
        business_id,
        nombre,
        telefono,
        email,
        direccion,
        nif,
        notas,
      })
      .select('id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudo crear el cliente' },
        { status: 500 }
      );
    }

    return NextResponse.json({ cliente: data });
  } catch (e) {
    console.error('[api/clientes POST]', e);
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
    if (!id) {
      return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: existing, error: fetchErr } = await supabase
      .from('clientes')
      .select('id, business_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing?.business_id) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, existing.business_id as string);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.nombre === 'string') {
      const n = b.nombre.trim();
      if (!n) return NextResponse.json({ error: 'nombre no puede estar vacío' }, { status: 400 });
      updates.nombre = n;
    }
    if (typeof b.telefono === 'string') updates.telefono = b.telefono.trim() || null;
    if (typeof b.email === 'string') updates.email = b.email.trim() || null;
    if (typeof b.direccion === 'string') updates.direccion = b.direccion.trim() || null;
    if (typeof b.nif === 'string') updates.nif = b.nif.trim() || null;
    if (typeof b.notas === 'string') updates.notas = b.notas.trim() || null;

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('clientes')
      .update(updates)
      .eq('id', id)
      .select('id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudo actualizar' },
        { status: 500 }
      );
    }

    return NextResponse.json({ cliente: data });
  } catch (e) {
    console.error('[api/clientes PATCH]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
