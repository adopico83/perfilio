'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { HoyCta, HoyObra, HoyPresupuesto } from '@/lib/hoy';

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
  return (
    <section aria-label="Hoy" className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Hoy</h1>
        <p className="mt-1 text-sm text-zinc-700">Estado de la obra. Un paso claro para seguir.</p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-900/60">Cargando el estado de hoy…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <p className="mt-2 text-sm text-zinc-800">
                  {obra.cliente_nombre?.trim() || 'Cliente'}
                  <span className="text-zinc-500"> · {estadoObraLabel(obra.estado)}</span>
                </p>
                {obra.direccion ? (
                  <p className="mt-1 text-xs text-zinc-600 truncate" title={obra.direccion}>
                    {obra.direccion}
                  </p>
                ) : null}
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
                <p className="text-sm font-semibold text-[#A04A2F]">{estadoPresupuestoLabel(presupuesto.estado)}</p>
                {fmtEuros(presupuesto.importe_total) ? (
                  <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">
                    {fmtEuros(presupuesto.importe_total)}
                  </p>
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
    </section>
  );
}
