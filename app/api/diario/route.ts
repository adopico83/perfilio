import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';
import {
  fetchDiarioObraEntries,
  groupDiarioEntriesByObra,
  insertDiarioObraEntry,
  signDiarioObraEntriesMedia,
  validarMediaDelNegocio,
} from '@/lib/diario-obra';

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
    const obra_nombre = typeof b.obra_nombre === 'string' ? b.obra_nombre.trim() : '';
    const obra_id = typeof b.obra_id === 'string' ? b.obra_id.trim() : '';
    const obra_direccion =
      typeof b.obra_direccion === 'string' ? b.obra_direccion.trim() : undefined;
    const texto = typeof b.texto === 'string' ? b.texto.trim() : undefined;
    const fotos = Array.isArray(b.fotos)
      ? b.fotos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : undefined;
    const videos = Array.isArray(b.videos)
      ? b.videos.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : undefined;

    if (!business_id || (!obra_nombre && !obra_id)) {
      return NextResponse.json(
        { error: 'business_id y obra_nombre (u obra_id) son obligatorios' },
        { status: 400 }
      );
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    // Fotos y vídeos: solo rutas de ESTE negocio (primer segmento = business_id). Si no, 400.
    for (const campo of ['fotos', 'videos'] as const) {
      const v = validarMediaDelNegocio(business_id, campo === 'fotos' ? fotos : videos, campo);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Si llega obra_id NO nos fiamos de lo que mande el navegador: la obra tiene que existir y ser
    // de este negocio, y el nombre, la dirección y el cliente salen de la base de datos.
    let nombreFinal = obra_nombre;
    let direccionFinal: string | null = obra_direccion || null;
    let clienteId: string | null = null;
    if (obra_id) {
      const { data: obra, error: obraErr } = await supabase
        .from('obras')
        .select('id, nombre, direccion, cliente_id')
        .eq('id', obra_id)
        .eq('business_id', business_id)
        .maybeSingle();
      if (obraErr) {
        return NextResponse.json({ error: obraErr.message }, { status: 500 });
      }
      if (!obra) {
        return NextResponse.json(
          { error: 'La obra no existe o no pertenece a este negocio' },
          { status: 403 }
        );
      }
      const o = obra as { nombre?: string | null; direccion?: string | null; cliente_id?: string | null };
      nombreFinal = String(o.nombre ?? '').trim() || obra_nombre;
      direccionFinal = o.direccion ?? null;
      clienteId = o.cliente_id ?? null;
    }

    const { data, error } = await insertDiarioObraEntry(supabase, {
      business_id,
      cliente_id: clienteId,
      obra_id: obra_id || null,
      obra_nombre: nombreFinal,
      obra_direccion: direccionFinal,
      texto: texto || null,
      fotos: fotos ?? null,
      videos: videos ?? null,
    });

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudo crear la entrada' },
        { status: 500 }
      );
    }

    return NextResponse.json({ entrada: data });
  } catch (e) {
    console.error('POST /api/diario:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
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

    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id')?.trim() ?? '';
    const obra_nombre = searchParams.get('obra_nombre')?.trim() ?? '';

    if (!business_id) {
      return NextResponse.json({ error: 'business_id es obligatorio' }, { status: 400 });
    }

    const ok = await assertUserOwnsBusiness(supabaseAuth, user.id, business_id);
    if (!ok) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data, error } = await fetchDiarioObraEntries(
      supabase,
      business_id,
      obra_nombre || null
    );

    if (error || data === null) {
      return NextResponse.json(
        { error: error?.message ?? 'No se pudieron listar las entradas' },
        { status: 500 }
      );
    }

    const dataSigned = await signDiarioObraEntriesMedia(supabase, data, business_id);

    if (obra_nombre) {
      return NextResponse.json({ entradas: dataSigned });
    }

    return NextResponse.json({
      agrupado_por_obra: groupDiarioEntriesByObra(dataSigned),
    });
  } catch (e) {
    console.error('GET /api/diario:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
