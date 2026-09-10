'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { HoyCta, HoyObra, HoyPresupuesto } from '@/lib/hoy';

function estadoObraLabel(estado: string | null | undefined): string {
  const s = (estado ?? 'abierta').toLowerCase();
  if (s === 'en_curso') return 'En curso';
  if (s === 'cerrada') return 'Cerrada';
  if (s === 'pausada') return 'Pausada';
  return 'Abierta';
}

function estadoPresupuestoLabel(estado: string | null | undefined): string {
  const s = (estado ?? '').toLowerCase();
  if (s === 'pendiente') return 'Pendiente de OK';
  if (s === 'borrador') return 'Borrador';
  if (s === 'aceptado' || s === 'aprobado') return 'Aceptado';
  if (!s) return 'Presupuesto';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtEuros(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

export default function HoyHome({
  loading,
  obra,
  presupuesto,
  cta,
  onAbrirObra,
}: {
  loading: boolean;
  obra: HoyObra | null;
  presupuesto: HoyPresupuesto | null;
  cta: HoyCta | null;
  onAbrirObra?: (obraId: string) => void;
}) {
  return (
    <section
      aria-label="Hoy"
      className="rounded-xl border border-[#A04A2F]/55 bg-[#E5DFD0] p-4 sm:p-5 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#A04A2F]">Hoy</p>

      {loading ? (
        <p className="mt-2 text-sm text-zinc-900/60">Cargando el estado de la obra…</p>
      ) : !obra ? (
        <div className="mt-2 space-y-1">
          <h2 className="text-xl font-bold text-zinc-900">Sin obra abierta ahora mismo</h2>
          <p className="text-sm text-zinc-900/70">
            Cuando tengas una obra en curso, el estado del día saldrá aquí. Nada urgente.
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 truncate">{obra.nombre}</h2>
            <p className="text-sm text-zinc-800">
              <span className="font-medium">{obra.cliente_nombre?.trim() || 'Cliente'}</span>
              <span className="text-zinc-900/50"> · </span>
              <span>{estadoObraLabel(obra.estado)}</span>
            </p>
            {obra.direccion ? (
              <p className="text-xs text-zinc-900/60 truncate" title={obra.direccion}>
                {obra.direccion}
              </p>
            ) : null}
            {presupuesto ? (
              <p className="text-sm text-zinc-800 pt-1">
                <span className="text-zinc-900/60">Presupuesto: </span>
                <span className="font-semibold text-[#A04A2F]">
                  {estadoPresupuestoLabel(presupuesto.estado)}
                </span>
                {fmtEuros(presupuesto.importe_total) ? (
                  <span className="tabular-nums"> · {fmtEuros(presupuesto.importe_total)}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-zinc-900/65 pt-1">Todavía no hay presupuesto ligado a esta obra.</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            {cta ? (
              <Link
                href={cta.href}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#A04A2F] hover:bg-[#8a3f28] text-white text-sm font-semibold transition-colors"
              >
                {cta.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
            {onAbrirObra ? (
              <button
                type="button"
                onClick={() => onAbrirObra(obra.id)}
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-[#A04A2F]/50 text-[#A04A2F] text-sm font-medium hover:bg-[#A04A2F]/10 transition-colors"
              >
                Ver ficha
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
