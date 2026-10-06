import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { getBusinessIdServer } from '@/lib/supabase/get-business-id';
import { hoyMadrid } from '@/lib/facturas/desde-presupuesto';

/**
 * Límite de uso de la IA (/api/assistant y /api/classify). Cupo COMÚN para las dos rutas, por usuario y
 * negocio: en /mensajes cada respuesta gasta una llamada a classify y otra a assistant.
 * - 10 por minuto: aguanta un uso normal (revisar varios mensajes seguidos) y frena un bucle o un abuso.
 * - 100 al día (hora de Madrid): unas 50 conversaciones al día, muy por encima de lo que hace una
 *   persona y con un coste acotado. Sin variables de entorno nuevas: se cambian aquí.
 */
export const LIMITE_POR_MINUTO = 10;
export const LIMITE_POR_DIA = 100;

/**
 * El agente tiene su PROPIO cupo (contador aparte), más holgado: es la función principal de la app, la usa
 * una persona hablando por voz durante el día y cada turno puede gastar hasta 3 llamadas a OpenAI
 * (elegir tools, reintento y respuesta final). 20 turnos por minuto y 300 al día frenan un bucle o un abuso
 * sin molestar a un uso normal; el coste máximo por usuario y día queda acotado (≈ 900 llamadas).
 * `confirmar_accion` no cuenta: no gasta OpenAI.
 */
export const LIMITE_AGENTE_POR_MINUTO = 20;
export const LIMITE_AGENTE_POR_DIA = 300;

export type LimitesUso = { porMinuto: number; porDia: number };

export type ResultadoLimite =
  | { permitido: true }
  | { permitido: false; motivo: 'minuto' | 'dia'; reintentarEnS: number };

/** Segundos que faltan para que acabe el minuto (ventana 'min'). */
function segundosHastaFinDeMinuto(now: Date): number {
  return 60 - now.getUTCSeconds();
}

/** Segundos hasta la medianoche de Madrid (ventana 'dia'). */
function segundosHastaMedianocheMadrid(now: Date): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return Math.max(1, 86_400 - (g('hour') * 3600 + g('minute') * 60 + g('second')));
}

/**
 * Red de seguridad: contador en memoria POR INSTANCIA, con los mismos límites. Solo se usa si la base
 * falla (p. ej. la migración aún no está aplicada). No es compartido entre instancias: es peor que la
 * tabla, pero mejor que dejar la IA sin límite.
 */
const memoria = new Map<string, number>();

export function reiniciarContadorEnMemoria(): void {
  memoria.clear();
}

function contarEnMemoria(clave: string, ventana: 'min' | 'dia', periodo: string): number {
  // Se limpian los periodos viejos para que el mapa no crezca.
  for (const k of memoria.keys()) {
    if (k.startsWith(`${clave}|${ventana}|`) && !k.endsWith(`|${periodo}`)) memoria.delete(k);
  }
  const k = `${clave}|${ventana}|${periodo}`;
  const n = (memoria.get(k) ?? 0) + 1;
  memoria.set(k, n);
  return n;
}

function enMemoria(clave: string, minuto: string, dia: string, now: Date, limites: LimitesUso): ResultadoLimite {
  if (contarEnMemoria(clave, 'min', minuto) > limites.porMinuto) {
    return { permitido: false, motivo: 'minuto', reintentarEnS: segundosHastaFinDeMinuto(now) };
  }
  if (contarEnMemoria(clave, 'dia', dia) > limites.porDia) {
    return { permitido: false, motivo: 'dia', reintentarEnS: segundosHastaMedianocheMadrid(now) };
  }
  return { permitido: true };
}

/**
 * Registra una llamada de IA de este usuario/negocio y dice si se permite. Nunca lanza: si la base falla
 * deja pasar con un aviso en el log y cuenta en memoria.
 * @param businessId '' si el usuario no tiene negocio propio (se cuenta solo por usuario).
 */
export async function comprobarLimiteIA(
  supabaseService: SupabaseClient,
  userId: string,
  businessId: string,
  now: Date = new Date(),
  limites: LimitesUso = { porMinuto: LIMITE_POR_MINUTO, porDia: LIMITE_POR_DIA }
): Promise<ResultadoLimite> {
  const minuto = now.toISOString().slice(0, 16);
  const dia = hoyMadrid(now);
  try {
    const { data, error } = await supabaseService.rpc('ia_registrar_uso', {
      p_user: userId,
      p_business: businessId,
      p_minuto: minuto,
      p_dia: dia,
      p_max_minuto: limites.porMinuto,
      p_max_dia: limites.porDia,
    });
    const r = data as { permitido?: boolean; motivo?: 'minuto' | 'dia' } | null;
    if (error || !r || typeof r.permitido !== 'boolean') {
      throw new Error(error?.message ?? 'respuesta inesperada de ia_registrar_uso');
    }
    if (r.permitido) return { permitido: true };
    const motivo = r.motivo === 'dia' ? 'dia' : 'minuto';
    return {
      permitido: false,
      motivo,
      reintentarEnS: motivo === 'dia' ? segundosHastaMedianocheMadrid(now) : segundosHastaFinDeMinuto(now),
    };
  } catch (e) {
    console.warn('[limite-ia] la base falló, se usa el contador en memoria:', e instanceof Error ? e.message : e);
    return enMemoria(`${userId}|${businessId}`, minuto, dia, now, limites);
  }
}

/**
 * Lo que llaman las rutas: resuelve el negocio del usuario (si no tiene propio, se cuenta solo por
 * usuario, sin rechazar) y comprueba el límite. Nunca lanza.
 */
export async function comprobarLimiteIARuta(supabaseAuth: SupabaseClient, userId: string): Promise<ResultadoLimite> {
  let businessId = '';
  try {
    businessId = (await getBusinessIdServer(supabaseAuth)) ?? '';
  } catch {
    businessId = '';
  }
  try {
    return await comprobarLimiteIA(createServiceClient(), userId, businessId);
  } catch (e) {
    console.warn('[limite-ia] no se pudo comprobar el límite:', e instanceof Error ? e.message : e);
    return { permitido: true };
  }
}

/**
 * Límite del agente (`/api/agente`): cupo propio, con el negocio YA validado por el control de acceso.
 * Se guarda en la misma tabla con la clave `<negocio>:agente`, así que no hace falta otra migración.
 * Nunca lanza: si falla algo deja pasar.
 */
export async function comprobarLimiteIAAgente(
  supabaseService: SupabaseClient,
  userId: string,
  businessId: string,
  now: Date = new Date()
): Promise<ResultadoLimite> {
  try {
    return await comprobarLimiteIA(supabaseService, userId, `${businessId}:agente`, now, {
      porMinuto: LIMITE_AGENTE_POR_MINUTO,
      porDia: LIMITE_AGENTE_POR_DIA,
    });
  } catch (e) {
    console.warn('[limite-ia] no se pudo comprobar el límite del agente:', e instanceof Error ? e.message : e);
    return { permitido: true };
  }
}

/** Respuesta 429 con Retry-After para una llamada rechazada. */
export function respuestaLimiteIA(r: Extract<ResultadoLimite, { permitido: false }>): NextResponse {
  return NextResponse.json(
    { error: `Has hecho demasiadas consultas a la IA. Prueba de nuevo en ${r.reintentarEnS} s.` },
    { status: 429, headers: { 'Retry-After': String(r.reintentarEnS) } }
  );
}
