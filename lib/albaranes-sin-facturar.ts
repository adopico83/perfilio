import type { SupabaseClient } from '@supabase/supabase-js';

/** YYYY-MM-DD en la zona horaria indicada. */
export function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, mo, da] = ymd.split('-').map(Number);
  const u = Date.UTC(y, mo - 1, da + days);
  return new Date(u).toISOString().slice(0, 10);
}

export type AlbaranSinFacturarRow = {
  id: string;
  numero_albaran: string | null;
  cliente_nombre: string | null;
  total: number | null;
  fecha: string | null;
  estado: string | null;
};

/**
 * Albaranes del negocio sin factura vinculada (`facturas.albaran_id`),
 * con fecha del albarán anterior a (hoy − 7 días naturales) en la zona horaria
 * (fecha ≤ hoy − 8 días en calendario).
 */
export async function listarAlbaranesSinFacturar(
  supabase: SupabaseClient,
  businessId: string,
  timeZone = 'Europe/Madrid'
): Promise<{ albaranes: AlbaranSinFacturarRow[]; total: number }> {
  const hoyYmd = formatYmdInTimeZone(new Date(), timeZone);
  /** Inclusive: fechas <= este día cumplen “más de 7 días” respecto a hoy. */
  const fechaMaximaInclusive = addDaysToYmd(hoyYmd, -8);

  const { data: factRows, error: errFact } = await supabase
    .from('facturas')
    .select('albaran_id')
    .eq('business_id', businessId)
    .not('albaran_id', 'is', null);

  if (errFact) {
    throw new Error(errFact.message);
  }

  const albaranIdsConFactura = new Set(
    (factRows ?? [])
      .map((r: { albaran_id?: string | null }) => r.albaran_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  const { data: rows, error: errAlb } = await supabase
    .from('albaranes')
    .select('id, numero_albaran, cliente_nombre, total, fecha, estado')
    .eq('business_id', businessId)
    .lte('fecha', fechaMaximaInclusive)
    .order('fecha', { ascending: true });

  if (errAlb) {
    throw new Error(errAlb.message);
  }

  const albaranes = (rows ?? []).filter(
    (r) => r.id && !albaranIdsConFactura.has(r.id as string)
  ) as AlbaranSinFacturarRow[];

  return { albaranes, total: albaranes.length };
}

export function diasDesdeFechaHasta(fecha: string | null, hoyYmd: string): number {
  const d = (fecha ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(hoyYmd)) return 0;
  const t0 = Date.UTC(
    parseInt(d.slice(0, 4), 10),
    parseInt(d.slice(5, 7), 10) - 1,
    parseInt(d.slice(8, 10), 10)
  );
  const t1 = Date.UTC(
    parseInt(hoyYmd.slice(0, 4), 10),
    parseInt(hoyYmd.slice(5, 7), 10) - 1,
    parseInt(hoyYmd.slice(8, 10), 10)
  );
  return Math.max(0, Math.floor((t1 - t0) / 86400000));
}

export function hoyYmdEnZona(timeZone = 'Europe/Madrid'): string {
  return formatYmdInTimeZone(new Date(), timeZone);
}
