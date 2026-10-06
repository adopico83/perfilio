import { NextRequest, NextResponse } from 'next/server';
import * as z from 'zod/v4';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverAccesoNegocio } from '@/lib/negocio/acceso';
import { PUSHOVER_BUSINESS_ID_POR_DEFECTO, tokenPushover } from '@/lib/notificaciones/pushover';

export const runtime = 'nodejs';

const PUSHOVER_VALIDATE_URL = 'https://api.pushover.net/1/users/validate.json';

/** Solo estos campos se aceptan: cualquier otro del cuerpo se ignora. */
const cuerpoSchema = z.object({
  resumen_push: z.boolean().optional(),
  pushover_user_key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{30}$/, 'La clave de Pushover son 30 letras y números')
    .nullish()
    .or(z.literal('')),
});

/** Avisos al móvil del negocio. NUNCA se devuelve la clave completa, solo las 4 últimas cifras. */
export async function GET(request: NextRequest) {
  try {
    const acceso = await resolverAccesoNegocio(request);
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const supabase = createServiceClient();
    const [{ data: perfil, error: e1 }, { data: aviso, error: e2 }] = await Promise.all([
      supabase.from('business_profiles').select('resumen_push').eq('id', acceso.businessId).maybeSingle(),
      supabase.from('business_avisos_movil').select('pushover_user_key').eq('business_id', acceso.businessId).maybeSingle(),
    ]);
    if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 });

    const clave = String((aviso as { pushover_user_key?: string | null } | null)?.pushover_user_key ?? '');
    const dueno = (process.env.PUSHOVER_BUSINESS_ID ?? '').trim() || PUSHOVER_BUSINESS_ID_POR_DEFECTO;
    const usaGlobal = !clave && acceso.businessId === dueno && Boolean((process.env.PUSHOVER_USER_KEY ?? process.env.PUSHOVER_USER ?? '').trim());
    return NextResponse.json({
      resumen_push: (perfil as { resumen_push?: boolean } | null)?.resumen_push === true,
      pushover_configurado: Boolean(clave) || usaGlobal,
      pushover_clave_final: clave ? `…${clave.slice(-4)}` : null,
      usa_clave_global: usaGlobal,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}

/** Comprueba la clave en Pushover. true = válida, false = rechazada, null = no se pudo comprobar. */
async function validarClave(user: string): Promise<boolean | null> {
  const token = tokenPushover();
  if (!token) return null;
  try {
    const res = await fetch(PUSHOVER_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, user }),
    });
    const json = (await res.json()) as { status?: number };
    return json.status === 1;
  } catch {
    return null;
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const acceso = await resolverAccesoNegocio(request, typeof raw?.business_id === 'string' ? raw.business_id : null);
    if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

    const parsed = cuerpoSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
    }
    const { resumen_push, pushover_user_key } = parsed.data;
    if (resumen_push === undefined && pushover_user_key === undefined) {
      return NextResponse.json({ error: 'No hay nada que guardar' }, { status: 400 });
    }

    const supabase = createServiceClient();
    let aviso: string | undefined;

    if (pushover_user_key !== undefined) {
      const clave = pushover_user_key ? pushover_user_key : null; // null o '' = quitar
      if (clave) {
        const valida = await validarClave(clave);
        if (valida === false) {
          return NextResponse.json({ error: 'Pushover no reconoce esa clave. Revísala en la app de Pushover.' }, { status: 400 });
        }
        if (valida === null) aviso = 'No se pudo comprobar la clave con Pushover; se ha guardado igualmente.';
      }
      const { error } = await supabase.from('business_avisos_movil').upsert(
        { business_id: acceso.businessId, pushover_user_key: clave, updated_at: new Date().toISOString(), updated_by: acceso.userId },
        { onConflict: 'business_id' }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (resumen_push !== undefined) {
      const { error } = await supabase.from('business_profiles').update({ resumen_push }).eq('id', acceso.businessId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ...(aviso ? { aviso } : {}) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
