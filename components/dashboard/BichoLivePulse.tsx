'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { AlertTriangle, FileText, PauseCircle } from 'lucide-react';

type InsightRow = {
  id?: string;
  slug?: string | null;
  created_at?: string | null;
  type?: string | null;
  kind?: string | null;
  category?: string | null;
  insight_type?: string | null;
  title?: string | null;
  headline?: string | null;
  summary?: string | null;
  message?: string | null;
  description?: string | null;
  insight_text?: string | null;
  value?: string | number | null;
  metric_value?: string | number | null;
  amount?: string | number | null;
  total?: string | number | null;
  count?: string | number | null;
};

type InsightKind = 'margen' | 'inactividad' | 'facturacion' | 'otro';

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
  }
  return null;
}

function insightKind(insight: InsightRow): InsightKind {
  const raw = [
    insight.kind,
    insight.type,
    insight.category,
    insight.insight_type,
    insight.title,
    insight.headline,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (raw.includes('factur')) return 'facturacion';
  if (raw.includes('inactiv') || raw.includes('parad') || raw.includes('paus')) return 'inactividad';
  if (raw.includes('margen') || raw.includes('rentab')) return 'margen';
  return 'otro';
}

function kindLabel(kind: InsightKind): string {
  if (kind === 'facturacion') return 'Facturación';
  if (kind === 'inactividad') return 'Inactividad';
  if (kind === 'margen') return 'Margen';
  return 'Aviso operativo';
}

function insightHref(kind: InsightKind): string {
  return kind === 'facturacion' ? '/facturas' : '/obras';
}

function insightText(insight: InsightRow): string {
  const text =
    asText(insight.insight_text) ??
    asText(insight.summary) ??
    asText(insight.message) ??
    asText(insight.description) ??
    asText(insight.title) ??
    asText(insight.headline) ??
    'Revisa este aviso operativo.';
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}...` : text;
}

function InsightIcon({ kind }: { kind: InsightKind }) {
  if (kind === 'facturacion') return <FileText className="size-3.5 text-blue-200" aria-hidden />;
  if (kind === 'inactividad') return <PauseCircle className="size-3.5 text-amber-200" aria-hidden />;
  return <AlertTriangle className="size-3.5 text-red-200" aria-hidden />;
}

function BichoPulseSkeleton() {
  return (
    <section className="h-auto rounded-xl border border-white/10 bg-[#111827]/70 p-2 shadow-lg backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-14 animate-pulse rounded-full bg-white/10" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div
            key={idx}
            className="min-w-[8.25rem] flex-1 rounded-lg border border-white/10 bg-white/[0.04] p-2"
          >
            <div className="mb-1.5 h-3 w-10 animate-pulse rounded bg-white/10" />
            <div className="mb-1.5 h-5 w-12 animate-pulse rounded bg-white/10" />
            <div className="h-2 w-full animate-pulse rounded bg-white/10" />
            <div className="mt-1 h-2 w-2/3 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function BichoLivePulse() {
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('perfilio_insights')
          .select('*')
          .eq('status', 'pendiente')
          .order('created_at', { ascending: false })
          .limit(5);

        if (!cancelled) {
          setInsights(error || !data ? [] : (data as InsightRow[]));
        }
      } catch {
        if (!cancelled) setInsights([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const visibleInsights = useMemo(() => {
    const seen = new Set<string>();
    const deduped: InsightRow[] = [];

    for (const insight of insights) {
      const slug = insight.slug?.trim();
      const key = slug && slug.length > 0 ? slug : insight.id ?? `${insight.created_at ?? ''}-${deduped.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(insight);
      if (deduped.length === 3) break;
    }

    return deduped;
  }, [insights]);

  if (loading) return <BichoPulseSkeleton />;

  return (
    <section className="h-auto rounded-xl border border-white/10 bg-[#111827]/75 p-2 shadow-lg backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full bg-[#ed8936] animate-pulse shadow-[0_0_12px_rgba(237,137,54,0.9)]" />
          <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-white/70">
            El Bicho activo
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-[#ed8936]/35 bg-[#ed8936]/10 px-2 py-0.5 text-xs font-medium text-[#fed7aa]">
          {visibleInsights.length} pendientes
        </span>
      </div>

      {visibleInsights.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-xs text-white/65">
          No hay avisos pendientes ahora mismo.
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
          {visibleInsights.map((insight, idx) => {
            const kind = insightKind(insight);
            const text = insightText(insight);
            const key = insight.slug ?? insight.id ?? `${kind}-${idx}-${insight.created_at ?? 'sin-fecha'}`;

            return (
              <Link
                key={key}
                href={insightHref(kind)}
                className="flex min-w-[8.25rem] flex-1 cursor-pointer flex-col rounded-lg border border-white/10 bg-white/[0.04] p-2 transition hover:border-[#ed8936]/40 hover:bg-white/[0.06] hover:brightness-110"
              >
                <div className="mb-1 flex min-w-0 items-center gap-1 text-xs font-semibold text-white/80">
                  <InsightIcon kind={kind} />
                  <span className="truncate">{kindLabel(kind)}</span>
                </div>

                <p className="line-clamp-2 text-xs leading-snug text-white/70">{text}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
