'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { GASTO_CATEGORIAS, etiquetaGastoCategoria } from '@/lib/gastos-categoria';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type GastoResumenFila = {
  id: string;
  fecha: string;
  proveedor: string;
  descripcion: string | null;
  categoria: string;
  importe: number;
  iva: number;
  importe_total: number;
};

type GastoResumenPorObra = {
  obra_id: string | null;
  obra_nombre: string;
  gastos: GastoResumenFila[];
  subtotal: number;
};

type ResumenJson = {
  mes: string;
  total_mes: number;
  por_categoria: Array<{ categoria: string; total: number }>;
  por_obra: GastoResumenPorObra[];
  error?: string;
};

function mesActualYyyyMmMadrid(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`.slice(0, 7);
}

function fmtFechaCorta(iso: string): string {
  if (!iso || iso.length < 10) return iso || '—';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { dateStyle: 'medium' });
}

export default function GastosPage() {
  const router = useRouter();
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [authChecking, setAuthChecking] = useState(true);
  const [businessName, setBusinessName] = useState('tu negocio');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [mes, setMes] = useState(mesActualYyyyMmMadrid);
  const [porObra, setPorObra] = useState<GastoResumenPorObra[]>([]);
  const [porCategoria, setPorCategoria] = useState<Array<{ categoria: string; total: number }>>([]);
  const [totalMes, setTotalMes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((key: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);

      const businessId = await getBusinessIdClient(supabase);
      if (!businessId) {
        setBusinessId(null);
        setLoading(false);
        return;
      }

      setBusinessId(businessId);
      const { data: bp } = await supabase
        .from('business_profiles')
        .select('nombre')
        .eq('id', businessId)
        .maybeSingle();
      if (bp?.nombre) setBusinessName(bp.nombre);
    };
    void run();
  }, [router, supabase]);

  const cargarResumen = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/gastos/resumen?business_id=${encodeURIComponent(businessId)}&mes=${encodeURIComponent(mes)}`,
        { credentials: 'include' }
      );
      const json = (await res.json()) as ResumenJson;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el resumen');
        setPorObra([]);
        setPorCategoria([]);
        setTotalMes(0);
        return;
      }
      setPorObra(json.por_obra ?? []);
      setPorCategoria(json.por_categoria ?? []);
      setTotalMes(json.total_mes ?? 0);
    } catch {
      setError('Error de conexión');
      setPorObra([]);
      setPorCategoria([]);
      setTotalMes(0);
    } finally {
      setLoading(false);
    }
  }, [businessId, mes]);

  useEffect(() => {
    if (!authChecking && businessId) void cargarResumen();
  }, [authChecking, businessId, cargarResumen]);

  const totalesPorCategoriaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of porCategoria) m.set(x.categoria, x.total);
    return m;
  }, [porCategoria]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <DashboardMainNav
        brand={
          <Link
            href="/dashboard"
            className="text-white font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
        }
        menuMovilAbierto={menuMovilAbierto}
        setMenuMovilAbierto={setMenuMovilAbierto}
        active="gastos"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Gastos</h1>
            <p className="text-sm text-white/70 mt-1">
              Resumen mensual por categoría y por obra (tickets y compras registradas).
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm text-white/80 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/50 font-semibold">Mes</span>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white tabular-nums focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
            />
          </label>
        </div>

        {error ? <p className="text-red-200/95 text-sm">{error}</p> : null}

        {!businessId ? (
          <p className="text-white/60 text-sm">No hay negocio vinculado a tu cuenta.</p>
        ) : loading ? (
          <p className="text-white/60 text-sm">Cargando gastos…</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#ed8936]/35 bg-[#1a365d]/60 px-4 py-3 space-y-3">
              <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">Resumen del mes</p>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-white/80">Total gastado</span>
                <span className="text-xl font-bold tabular-nums text-[#f6ad55]">{totalMes.toFixed(2)} €</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1 border-t border-white/10">
                {GASTO_CATEGORIAS.map((c) => {
                  const t = totalesPorCategoriaMap.get(c) ?? 0;
                  return (
                    <div
                      key={c}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                    >
                      <span className="text-white/75">{etiquetaGastoCategoria(c)}</span>
                      <span className="tabular-nums font-semibold text-white">{t.toFixed(2)} €</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {porObra.length === 0 ? (
              <p className="text-white/60 text-sm">No hay gastos registrados en este mes.</p>
            ) : (
              <ul className="space-y-2">
                {porObra.map((grupo) => {
                  const key = grupo.obra_id ?? `sin-obra-${grupo.obra_nombre}`;
                  const abierto = expandidos.has(key);
                  return (
                    <li
                      key={key}
                      className="rounded-xl border border-white/10 bg-[#111827]/90 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors touch-manipulation"
                        aria-expanded={abierto}
                      >
                        <ChevronDown
                          className={`size-5 shrink-0 text-[#ed8936] transition-transform ${abierto ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white truncate">{grupo.obra_nombre}</p>
                          <p className="text-xs text-white/60 mt-0.5 tabular-nums">
                            {grupo.gastos.length} gasto{grupo.gastos.length === 1 ? '' : 's'} · Subtotal{' '}
                            {grupo.subtotal.toFixed(2)} €
                          </p>
                        </div>
                      </button>
                      {abierto ? (
                        <div className="border-t border-white/10 px-4 py-3 bg-[#0f172a]/80">
                          <div className="overflow-x-auto rounded-lg border border-white/10">
                            <table className="w-full text-sm text-left min-w-[560px]">
                              <thead>
                                <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                                  <th className="px-3 py-2 font-medium">Fecha</th>
                                  <th className="px-3 py-2 font-medium">Proveedor</th>
                                  <th className="px-3 py-2 font-medium">Descripción</th>
                                  <th className="px-3 py-2 font-medium">Categoría</th>
                                  <th className="px-3 py-2 font-medium">Importe</th>
                                  <th className="px-3 py-2 font-medium">IVA</th>
                                  <th className="px-3 py-2 font-medium">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.gastos.map((row) => (
                                  <tr key={row.id} className="border-b border-white/5">
                                    <td className="px-3 py-2 text-xs text-white/70 whitespace-nowrap">
                                      {fmtFechaCorta(row.fecha)}
                                    </td>
                                    <td className="px-3 py-2 text-white/90 font-medium">{row.proveedor}</td>
                                    <td className="px-3 py-2 text-xs text-white/65 max-w-[12rem] break-words">
                                      {row.descripcion ?? '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-white/80">
                                      {etiquetaGastoCategoria(row.categoria)}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums font-semibold">
                                      {row.importe.toFixed(2)} €
                                    </td>
                                    <td className="px-3 py-2 tabular-nums font-semibold">{row.iva.toFixed(2)} €</td>
                                    <td className="px-3 py-2 tabular-nums font-semibold text-[#f6ad55]">
                                      {row.importe_total.toFixed(2)} €
                                    </td>
                                  </tr>
                                ))}
                                <tr className="border-t border-[#ed8936]/40 bg-[#ed8936]/10">
                                  <td colSpan={6} className="px-3 py-2.5 text-sm font-semibold text-[#f6ad55]">
                                    Subtotal {grupo.obra_nombre}
                                  </td>
                                  <td className="px-3 py-2.5 text-sm font-semibold text-[#f6ad55] tabular-nums">
                                    {grupo.subtotal.toFixed(2)} €
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {porObra.length > 0 ? (
              <div className="rounded-xl border border-[#ed8936]/40 bg-[#ed8936]/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#f6ad55]">Totales del mes</span>
                <div className="text-sm tabular-nums text-[#f6ad55] font-semibold">{totalMes.toFixed(2)} €</div>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
