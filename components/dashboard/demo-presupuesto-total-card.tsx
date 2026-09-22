'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';
import {
  fmtEurosEs,
  metricaPresupuesto,
  sumarMetricasPresupuesto,
  type LineaPresupuestoMetrica,
} from '@/lib/demo-metricas';

const cardClass =
  'flex w-full flex-col rounded-2xl border border-zinc-400/35 bg-[#E5DFD0] p-5 text-left shadow-sm min-h-[12.5rem] transition-colors hover:border-[#A04A2F]/45';

export function DemoPresupuestoTotalCardView({
  loading,
  lineas,
}: {
  loading: boolean;
  lineas: LineaPresupuestoMetrica[];
}) {
  const [abierto, setAbierto] = useState(false);
  const totales = useMemo(() => sumarMetricasPresupuesto(lineas), [lineas]);

  return (
    <>
      <button type="button" className={cardClass} onClick={() => setAbierto(true)}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A04A2F]">
          Importe total presupuestado
        </p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-700">
          Total presupuestado (base)
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-900">
          {loading ? '—' : fmtEurosEs(totales.base)}
        </p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-700">Total con IVA</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
          {loading ? '—' : fmtEurosEs(totales.conIva)}
        </p>
        <span className="mt-auto pt-4 text-sm font-medium text-[#A04A2F]">Ver desglose por presupuesto</span>
      </button>

      {abierto ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAbierto(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl border border-zinc-400/40 bg-[#E5DFD0] shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-desglose-presupuesto"
          >
            <div className="flex items-center justify-between border-b border-zinc-400/30 px-4 py-3">
              <h3 id="demo-desglose-presupuesto" className="font-semibold text-[#A04A2F]">
                Importe total presupuestado
              </h3>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="px-2 text-2xl leading-none text-zinc-700"
                aria-label="Cerrar desglose"
              >
                ×
              </button>
            </div>
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto p-4 text-sm">
              {lineas.length === 0 ? (
                <li className="text-zinc-700">No hay presupuestos con importe.</li>
              ) : (
                lineas.map((p) => {
                  const m = metricaPresupuesto(p);
                  return (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-3 border-b border-zinc-400/25 pb-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900">{p.cliente_nombre?.trim() || 'Sin cliente'}</p>
                        <p className="text-xs text-zinc-600">{p.fecha ?? '—'}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums text-[#A04A2F]">{fmtEurosEs(m.base)}</p>
                        <p className="text-xs tabular-nums text-zinc-600">IVA {fmtEurosEs(m.conIva)}</p>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function DemoPresupuestoTotalCard() {
  const { businessId } = useSession();
  const [loading, setLoading] = useState(true);
  const [lineas, setLineas] = useState<LineaPresupuestoMetrica[]>([]);

  useEffect(() => {
    if (!businessId) {
      setLineas([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('presupuestos')
        .select('id, cliente_nombre, fecha, importe_total, presupuesto_generado')
        .eq('business_id', businessId);
      if (cancelled) return;
      if (error || !data) {
        setLineas([]);
      } else {
        setLineas(data as LineaPresupuestoMetrica[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return <DemoPresupuestoTotalCardView loading={loading} lineas={lineas} />;
}
