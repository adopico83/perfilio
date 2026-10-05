import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { cargarResumenDia } from '@/lib/resumen-diario/datos';
import { guardarResumenComoNotificacion } from '@/lib/resumen-diario/guardar';

/** Hora de Madrid a la que debe salir el resumen (7:30). */
const HORA_MADRID = 7;

function horaMadrid(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

/**
 * Vercel Cron solo entiende UTC. Para que sea las 7:30 en Madrid todo el año hay dos entradas
 * en vercel.json (05:30 UTC en verano y 06:30 UTC en invierno) y aquí se descarta la que no
 * cae a las 7 en Madrid. `?force=1` salta esa comprobación para lanzarlo a mano.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  if (!secret || auth !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get('force') === '1';
  if (!force && horaMadrid(now) !== HORA_MADRID) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'Fuera de las 7:xx de Madrid' });
  }

  try {
    const supabase = createServiceClient();
    const { data: negocios, error } = await supabase.from('business_profiles').select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let creados = 0;
    let yaExistian = 0;
    const errores: Array<{ business_id: string; error: string }> = [];

    for (const negocio of (negocios ?? []) as Array<{ id: string }>) {
      try {
        const resumen = await cargarResumenDia(supabase, negocio.id, now);
        const nuevo = await guardarResumenComoNotificacion(supabase, negocio.id, resumen);
        if (nuevo) creados += 1;
        else yaExistian += 1;
      } catch (e) {
        errores.push({ business_id: negocio.id, error: e instanceof Error ? e.message : 'error' });
      }
    }

    return NextResponse.json({
      ok: errores.length === 0,
      negocios: (negocios ?? []).length,
      creados,
      yaExistian,
      errores: errores.length > 0 ? errores : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error cron resumen-diario' },
      { status: 500 }
    );
  }
}
