import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DIAS_OBRA_PARADA,
  ESTADOS_FACTURA_ABIERTA,
  ESTADOS_OBRA_ACTIVA,
  ESTADOS_PRESUPUESTO_SIN_RESPUESTA,
  calcularResumenDia,
  sumarDias,
  ymdMadrid,
  type CitaRow,
  type DiarioRow,
  type FacturaRow,
  type ObraRow,
  type PresupuestoRow,
  type ResumenDia,
} from '@/lib/resumen-diario/calcular';

type Resultado<T> = { data: T[] | null; error: { message: string } | null };

function filas<T>(nombre: string, r: Resultado<T>): T[] {
  if (r.error) throw new Error(`Resumen del día (${nombre}): ${r.error.message}`);
  return r.data ?? [];
}

/** Carga los datos de un negocio (siempre filtrando por business_id) y calcula su resumen. */
export async function cargarResumenDia(
  supabase: SupabaseClient,
  businessId: string,
  now: Date = new Date()
): Promise<ResumenDia> {
  const hoy = ymdMadrid(now);
  const manana = sumarDias(hoy, 1);
  const desdeDiario = sumarDias(hoy, -DIAS_OBRA_PARADA);

  const [citas, obras, diario, presupuestos, facturas] = await Promise.all([
    supabase
      .from('agenda')
      .select('id, titulo, hora, fecha')
      .eq('business_id', businessId)
      .in('fecha', [hoy, manana])
      .eq('completado', false),
    supabase
      .from('obras')
      .select('id, nombre, estado, created_at, fecha_inicio')
      .eq('business_id', businessId)
      .in('estado', ESTADOS_OBRA_ACTIVA),
    supabase
      .from('diario_obra')
      .select('obra_id, fecha')
      .eq('business_id', businessId)
      .gte('fecha', desdeDiario),
    supabase
      .from('presupuestos')
      .select('id, estado, cliente_nombre, numero_presupuesto, importe_total, fecha, created_at')
      .eq('business_id', businessId)
      .in('estado', ESTADOS_PRESUPUESTO_SIN_RESPUESTA),
    supabase
      .from('facturas')
      .select('id, estado, numero_factura, cliente_nombre, total, fecha_vencimiento')
      .eq('business_id', businessId)
      .in('estado', ESTADOS_FACTURA_ABIERTA),
  ]);

  return calcularResumenDia(
    {
      citas: filas<CitaRow>('agenda', citas),
      obras: filas<ObraRow>('obras', obras),
      diario: filas<DiarioRow>('diario', diario),
      presupuestos: filas<PresupuestoRow>('presupuestos', presupuestos),
      facturas: filas<FacturaRow>('facturas', facturas),
    },
    now
  );
}
