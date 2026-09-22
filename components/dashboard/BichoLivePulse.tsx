'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, FileText, PauseCircle } from 'lucide-react';
import { dash } from '@/components/dashboard/dashboard-density';

type InsightRow = {
  id?: string;
  slug?: string | null;
  business_id?: string | null;
  obra_id?: string | null;
  created_at?: string | null;
  status?: string | null;
  type?: string | null;
  kind?: string | null;
  category?: string | null;
  severity?: string | null;
  urgency?: string | null;
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
  metadata?: Record<string, unknown> | null;
  content_hash?: string | null;
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

function insightHref(insight: InsightRow, kind: InsightKind): string {
  const obraId = insight.obra_id?.trim();
  if (!obraId) return '/obras';
  if (kind === 'facturacion') return `/facturas?obra_id=${encodeURIComponent(obraId)}`;
  if (kind === 'inactividad' || kind === 'margen') {
    return `/obras?id=${encodeURIComponent(obraId)}`;
  }
  return '/obras';
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
  if (kind === 'inactividad') return <PauseCircle className="size-3.5 text-zinc-600" aria-hidden />;
  return <AlertTriangle className="size-3.5 text-red-200" aria-hidden />;
}

function BichoPulseSkeleton() {
  return (
    <section className={dash.pulseSkeleton}>
      <div className={dash.pulseHead}>
        <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-14 animate-pulse rounded-full bg-white/10" />
      </div>
      <div className={dash.pulseGrid}>
        {Array.from({ length: 3 }).map((_, idx) => (
          <div
            key={idx}
            className="min-w-[8.25rem] flex-1 rounded-md border border-zinc-400/30 bg-white/[0.04] px-2 py-1"
          >
            <div className="mb-1 h-3 w-16 animate-pulse rounded bg-white/10" />
            <div className="h-2.5 w-full animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function BichoLivePulse() {
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('perfilio_insights')
          .select(
            'id, created_at, category, severity, insight_text, status, metadata, slug, business_id, content_hash, message, obra_id, type, urgency'
          )
          .eq('status', 'pendiente')
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) {
          console.error('No se pudieron cargar los insights pendientes', error);
        }

        if (!cancelled) {
          setInsights(error || !data ? [] : (data as InsightRow[]));
        }
      } catch (error) {
        console.error('Error inesperado cargando insights pendientes', error);
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
    <section className={dash.pulse}>
      <div className={dash.pulseHead}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-[#A04A2F] animate-pulse shadow-[0_0_12px_rgba(237,137,54,0.9)]" />
          <h2 className={dash.pulseTitle}>
            El Bicho activo
          </h2>
        </div>
        <span className={dash.pulseBadge}>
          {visibleInsights.length} pendientes
        </span>
      </div>

      {visibleInsights.length === 0 ? (
        <div className={dash.pulseEmpty}>
          No hay avisos pendientes ahora mismo.
        </div>
      ) : (
        <div className={dash.pulseGrid}>
          {visibleInsights.map((insight, idx) => {
            const kind = insightKind(insight);
            const text = insightText(insight);
            const key = insight.slug ?? insight.id ?? `${kind}-${idx}-${insight.created_at ?? 'sin-fecha'}`;

            return (
              <Link
                key={key}
                href={insightHref(insight, kind)}
                className={dash.pulseCard}
              >
                <div className={dash.pulseKind}>
                  <InsightIcon kind={kind} />
                  <span className="truncate">{kindLabel(kind)}</span>
                </div>

                <p className={dash.pulseText}>{text}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
