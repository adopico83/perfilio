'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import DemoCalendarioCard from '@/components/dashboard/demo-calendario-card';
import DemoPresupuestoTotalCard from '@/components/dashboard/demo-presupuesto-total-card';
import {
  lineaCalleBarrio,
  partidasVisiblesHoy,
  type HoyCta,
  type HoyObra,
  type HoyPresupuesto,
} from '@/lib/hoy';

export type HoyCliente = {
  id: string;
  nombre: string;
};

function estadoObraLabel(estado: string | null | undefined): string {
  const s = (estado ?? 'abierta').toLowerCase();
  if (s === 'en_curso') return 'En curso';
  if (s === 'cerrada') return 'Cerrada';
  if (s === 'pausada') return 'Pausada';
  return 'Abierta';
}

function fmtEuros(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

function Card({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-zinc-400/35 bg-[#E5DFD0] p-5 shadow-sm min-h-[12.5rem]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A04A2F]">{eyebrow}</p>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </article>
  );
}

export default function HoyDemoHome({
  loading,
  clientes,
  obra,
  presupuesto,
  cta,
  onAbrirObra,
}: {
  loading: boolean;
  clientes: HoyCliente[];
  obra: HoyObra | null;
  presupuesto: HoyPresupuesto | null;
  cta: HoyCta | null;
  onAbrirObra?: (obraId: string) => void;
}) {
  const partidas = partidasVisiblesHoy(presupuesto?.presupuesto_generado, 6);
  const lugar = lineaCalleBarrio(obra?.direccion);
  const clientePresupuesto = presupuesto?.cliente_nombre?.trim() || obra?.cliente_nombre?.trim() || null;
  const totalLabel = fmtEuros(presupuesto?.importe_total);

  return (
    <section aria-label="Hoy" className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Hoy</h1>
        <p className="mt-1 text-sm text-zinc-700">Estado de la obra. Un paso claro para seguir.</p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-900/60">Cargando el estado de hoy…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <Card eyebrow="Clientes">
            {clientes.length === 0 ? (
              <p className="text-sm text-zinc-700">Todavía no hay fichas de cliente.</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-zinc-900 tabular-nums">{clientes.length}</p>
                <ul className="mt-3 space-y-1 text-sm text-zinc-800">
                  {clientes.slice(0, 3).map((c) => (
                    <li key={c.id} className="truncate">
                      {c.nombre}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link
              href="/clientes"
              className="mt-auto pt-4 inline-flex items-center text-sm font-medium text-[#A04A2F] hover:text-[#8a3f28]"
            >
              Ver clientes
              <ArrowRight className="ml-1 size-4" aria-hidden />
            </Link>
          </Card>

          <Card eyebrow="Obra en curso">
            {!obra ? (
              <p className="text-sm text-zinc-700">Cuando haya una obra abierta, aparecerá aquí.</p>
            ) : (
              <>
                <h2 className="text-xl font-bold text-zinc-900 leading-snug">{obra.nombre}</h2>
                {obra.direccion?.trim() ? (
                  <p className="mt-2 text-sm text-zinc-800 leading-snug">{obra.direccion.trim()}</p>
                ) : null}
                <p className="mt-3">
                  <span className="inline-flex items-center rounded-full border border-[#A04A2F]/35 bg-[#A04A2F]/10 px-2.5 py-0.5 text-xs font-semibold text-[#A04A2F]">
                    {estadoObraLabel(obra.estado)}
                  </span>
                </p>
                {onAbrirObra ? (
                  <button
                    type="button"
                    onClick={() => onAbrirObra(obra.id)}
                    className="mt-auto pt-4 inline-flex items-center text-sm font-medium text-[#A04A2F] hover:text-[#8a3f28] text-left"
                  >
                    Ver ficha
                    <ArrowRight className="ml-1 size-4" aria-hidden />
                  </button>
                ) : (
                  <Link
                    href={`/obras?id=${encodeURIComponent(obra.id)}`}
                    className="mt-auto pt-4 inline-flex items-center text-sm font-medium text-[#A04A2F] hover:text-[#8a3f28]"
                  >
                    Ver ficha
                    <ArrowRight className="ml-1 size-4" aria-hidden />
                  </Link>
                )}
              </>
            )}
          </Card>

          <Card eyebrow="Presupuesto pendiente">
            {!presupuesto ? (
              <p className="text-sm text-zinc-700">Todavía no hay presupuesto ligado a la obra.</p>
            ) : (
              <>
                {clientePresupuesto ? (
                  <p className="text-base font-semibold text-zinc-900 leading-snug">{clientePresupuesto}</p>
                ) : null}
                {lugar ? <p className="mt-0.5 text-sm text-zinc-600">{lugar}</p> : null}
                {partidas.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-sm text-zinc-800">
                    {partidas.map((p, i) => (
                      <li key={`${p.concepto}-${i}`} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">{p.concepto}</span>
                        <span className="shrink-0 tabular-nums text-zinc-700">{fmtEuros(p.importe)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {totalLabel ? (
                  <p className="mt-3 text-lg font-bold tabular-nums text-zinc-900">Total {totalLabel}</p>
                ) : null}
                {cta ? (
                  <Link
                    href={cta.href}
                    className="mt-auto pt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#A04A2F] hover:bg-[#8a3f28] px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                  >
                    {cta.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DemoPresupuestoTotalCard />
        <DemoCalendarioCard />
      </div>
    </section>
  );
}
