import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { cargarResumenDia } from '@/lib/resumen-diario/datos';
import { guardarResumenComoNotificacion } from '@/lib/resumen-diario/guardar';
import { enviarPushResumen, type ResultadoPushResumen } from '@/lib/resumen-diario/push';

/** Ventana (hora de Madrid, ambos extremos incluidos) en la que se acepta la llamada del cron. */
const VENTANA_INICIO_MIN = 5 * 60;
const VENTANA_FIN_MIN = 12 * 60;

function minutosMadrid(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

/**
 * Cron diario de Vercel (una sola entrada en vercel.json: 05:30 UTC = 7:30 o 6:30 en Madrid).
 * En el plan Hobby Vercel lo lanza en cualquier minuto de esa hora, así que no se exige una
 * hora exacta: vale cualquier llamada entre las 05:00 y las 12:00 de Madrid. Es seguro llamarlo
 * varias veces: el resumen del día (slug `resumen-diario-AAAA-MM-DD`) solo se crea si todavía
 * no existe. `?force=1` salta la comprobación de ventana para lanzarlo a mano.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  if (!secret || auth !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get('force') === '1';
  const minutos = minutosMadrid(now);
  if (!force && (minutos < VENTANA_INICIO_MIN || minutos > VENTANA_FIN_MIN)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      motivo: 'Fuera de la ventana 05:00–12:00 de Madrid',
    });
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
    const push: Array<{ business_id: string } & ResultadoPushResumen> = [];

    for (const negocio of (negocios ?? []) as Array<{ id: string }>) {
      try {
        const resumen = await cargarResumenDia(supabase, negocio.id, now);
        const nuevo = await guardarResumenComoNotificacion(supabase, negocio.id, resumen);
        if (nuevo) {
          creados += 1;
          // El aviso push solo sale con el resumen recién creado: si el cron se repite no se duplica.
          const estado = await enviarPushResumen(supabase, negocio.id, resumen);
          if (estado.pushover !== 'desactivado' || estado.webpush !== 'desactivado') {
            push.push({ business_id: negocio.id, ...estado });
          }
        } else yaExistian += 1;
      } catch (e) {
        errores.push({ business_id: negocio.id, error: e instanceof Error ? e.message : 'error' });
      }
    }

    return NextResponse.json({
      ok: errores.length === 0,
      negocios: (negocios ?? []).length,
      creados,
      yaExistian,
      push: push.length > 0 ? push : undefined,
      errores: errores.length > 0 ? errores : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error cron resumen-diario' },
      { status: 500 }
    );
  }
}
