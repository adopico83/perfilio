'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';
import type { ResumenDia, ResumenItem } from '@/lib/resumen-diario/calcular';

const SECCIONES: Array<[keyof ResumenDia, string]> = [
  ['citasHoy', 'Citas de hoy'],
  ['citasManana', 'Citas de mañana'],
  ['facturasVencidas', 'Facturas vencidas'],
  ['obrasParadas', 'Obras paradas'],
  ['margenEnRiesgo', 'Margen en riesgo'],
  ['obrasSinFactura', 'Obras que terminan sin factura'],
  ['presupuestosSinRespuesta', 'Presupuestos sin respuesta'],
  ['facturasPendientes', 'Facturas pendientes de cobro'],
];

export function ResumenHoyView({ resumen }: { resumen: ResumenDia }) {
  if (resumen.todoEnOrden) {
    return <p className="mt-2 text-lg font-semibold text-zinc-900">Todo en orden</p>;
  }
  return (
    <div className="mt-2 space-y-3">
      {SECCIONES.map(([clave, titulo]) => {
        const items = (resumen[clave] as ResumenItem[] | undefined) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={clave}>
            <h3 className="text-sm font-semibold text-zinc-900">
              {titulo} <span className="text-zinc-900/50">({items.length})</span>
            </h3>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li key={`${item.tipo}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-2 py-1 text-sm text-zinc-800 hover:bg-black/5"
                  >
                    <span className="font-medium">{item.titulo}</span>
                    <span className="text-zinc-900/60"> · {item.detalle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function ResumenHoyCard() {
  const [resumen, setResumen] = useState<ResumenDia | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const businessId = await getBusinessIdClient(createClient());
        if (!businessId) throw new Error('sin negocio');
        const res = await fetch(`/api/resumen-dia?business_id=${encodeURIComponent(businessId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { resumen: ResumenDia };
        if (!cancelled) setResumen(json.resumen);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-label="Hoy"
      className="rounded-xl border border-[#A04A2F]/55 bg-[#E5DFD0] p-4 shadow-sm sm:p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#A04A2F]">Hoy</p>
      {error ? (
        <p className="mt-2 text-sm text-zinc-900/60">No se ha podido cargar el resumen del día.</p>
      ) : !resumen ? (
        <p className="mt-2 text-sm text-zinc-900/60">Cargando el resumen del día…</p>
      ) : (
        <ResumenHoyView resumen={resumen} />
      )}
    </section>
  );
}
