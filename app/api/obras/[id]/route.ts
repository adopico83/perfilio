import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { signDiarioObraEntriesMedia } from '@/lib/diario-obra';

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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = rawId?.trim() ?? '';
    if (!id) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: obra, error: obraErr } = await supabase
      .from('obras')
      .select(
        'id, business_id, cliente_id, nombre, direccion, estado, fecha_inicio, fecha_fin, descripcion, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (obraErr || !obra) {
      return NextResponse.json({ error: 'Obra no encontrada' }, { status: 404 });
    }

    const businessId = obra.business_id as string;
    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a esta obra' }, { status: 403 });
    }

    const clienteId = (obra.cliente_id as string | null) ?? null;
    const { data: cliente } = clienteId
      ? await supabase
          .from('clientes')
          .select('id, business_id, nombre, telefono, email, direccion, nif, notas, created_at, updated_at')
          .eq('id', clienteId)
          .maybeSingle()
      : { data: null };

    const [presRes, facRes, albRes, dioRes, gastRes, jornRes] = await Promise.all([
      supabase
        .from('presupuestos')
        .select('*')
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('facturas')
        .select('*')
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('albaranes')
        .select('*')
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('diario_obra')
        .select('*')
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('gastos')
        .select('*')
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('registros_jornada')
        .select(
          'id, fecha, horas_reales, horas_convenio, notas, operario_id, operarios ( id, nombre )'
        )
        .eq('business_id', businessId)
        .eq('obra_id', id)
        .order('fecha', { ascending: false }),
    ]);

    const entradasDiario = await signDiarioObraEntriesMedia(
      supabase,
      dioRes.data ?? []
    );

    return NextResponse.json({
      obra,
      cliente: cliente ?? null,
      presupuestos: presRes.data ?? [],
      facturas: facRes.data ?? [],
      albaranes: albRes.data ?? [],
      entradas_diario_obra: entradasDiario,
      gastos: gastRes.data ?? [],
      registros_jornada: jornRes.data ?? [],
    });
  } catch (e) {
    console.error('[api/obras/[id] GET]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id: rawId } = await context.params;
    const id = rawId?.trim() ?? '';
    if (!id) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: obra, error: obraErr } = await supabase
      .from('obras')
      .select('id, business_id')
      .eq('id', id)
      .maybeSingle();

    if (obraErr || !obra) {
      return NextResponse.json({ error: 'Obra no encontrada' }, { status: 404 });
    }

    const businessId = obra.business_id as string;
    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, businessId);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a esta obra' }, { status: 403 });
    }

    const hasLinkedDocs = async (table: string) => {
      const { data, error } = await supabase
        .from(table)
        .select('id')
        .eq('obra_id', id)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    };

    const [hasPres, hasFac, hasAlb, hasDio, hasGast] = await Promise.all([
      hasLinkedDocs('presupuestos'),
      hasLinkedDocs('facturas'),
      hasLinkedDocs('albaranes'),
      hasLinkedDocs('diario_obra'),
      hasLinkedDocs('gastos'),
    ]);

    if (hasPres || hasFac || hasAlb || hasDio || hasGast) {
      return NextResponse.json(
        { error: 'No se puede eliminar una obra con documentos. Ciérrala en su lugar.' },
        { status: 400 }
      );
    }

    const { error: delErr } = await supabase.from('obras').delete().eq('id', id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/obras/[id] DELETE]', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

