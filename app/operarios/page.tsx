'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import ToggleAgenteNavButton from '@/components/dashboard/toggle-agente-nav-button';

type OperarioResumenPorObra = {
  obra_id: string;
  obra_nombre: string;
  horas_reales: number;
  horas_convenio: number;
};

type OperarioResumenFila = {
  id: string;
  nombre: string;
  horas_reales_mes: number;
  horas_convenio_mes: number;
  por_obra: OperarioResumenPorObra[];
};

type ResumenJson = {
  mes: string;
  operarios: OperarioResumenFila[];
  totales: { horas_reales: number; horas_convenio: number };
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

export default function OperariosPage() {
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
  const [filas, setFilas] = useState<OperarioResumenFila[]>([]);
  const [totales, setTotales] = useState({ horas_reales: 0, horas_convenio: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

      const { data: bp } = await supabase
        .from('business_profiles')
        .select('id, nombre')
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle();

      if (!bp?.id) {
        setBusinessId(null);
        setLoading(false);
        return;
      }

      setBusinessId(bp.id);
      if (bp.nombre) setBusinessName(bp.nombre);
    };
    void run();
  }, [router, supabase]);

  const cargarResumen = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/operarios/resumen?business_id=${encodeURIComponent(businessId)}&mes=${encodeURIComponent(mes)}`,
        { credentials: 'include' }
      );
      const json = (await res.json()) as ResumenJson;
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar el resumen');
        setFilas([]);
        setTotales({ horas_reales: 0, horas_convenio: 0 });
        return;
      }
      setFilas(json.operarios ?? []);
      setTotales(json.totales ?? { horas_reales: 0, horas_convenio: 0 });
    } catch {
      setError('Error de conexión');
      setFilas([]);
      setTotales({ horas_reales: 0, horas_convenio: 0 });
    } finally {
      setLoading(false);
    }
  }, [businessId, mes]);

  useEffect(() => {
    if (!authChecking && businessId) void cargarResumen();
  }, [authChecking, businessId, cargarResumen]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="text-white font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
          <button
            type="button"
            onClick={() => setMenuMovilAbierto((v) => !v)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors ml-auto"
            aria-label="Abrir menú"
          >
            ☰
          </button>
          <div className="hidden md:flex flex-1 min-w-0 items-center justify-end gap-2 lg:gap-3">
            <nav
              className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Secciones"
            >
              <div className="flex w-max max-w-full ml-auto flex-nowrap items-center justify-end gap-2 lg:gap-2.5 pr-1">
                <Link
                  href="/mensajes"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Mensajes
                </Link>
                <Link
                  href="/presupuestos"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Presupuestos
                </Link>
                <Link
                  href="/albaranes"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Albaranes
                </Link>
                <Link
                  href="/facturas"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Facturas
                </Link>
                <Link
                  href="/diario"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Diario
                </Link>
                <Link
                  href="/obras"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Obras
                </Link>
                <Link
                  href="/clientes"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Clientes
                </Link>
                <span className="text-xs lg:text-sm font-medium text-[#ed8936] shrink-0">Operarios</span>
                <ToggleAgenteNavButton className="inline-flex shrink-0 items-center px-3 py-1.5 lg:px-4 lg:py-2 text-xs lg:text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors" />
              </div>
            </nav>
            <div className="flex shrink-0 flex-nowrap items-center gap-2">
              <LogoutButton />
            </div>
          </div>
        </div>

        {menuMovilAbierto ? (
          <div className="md:hidden max-w-7xl mx-auto px-6 pb-4">
            <div className="bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <Link
                href="/mensajes"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Mensajes
              </Link>
              <Link
                href="/presupuestos"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Presupuestos
              </Link>
              <Link
                href="/albaranes"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Albaranes
              </Link>
              <Link
                href="/facturas"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Facturas
              </Link>
              <Link
                href="/diario"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Diario
              </Link>
              <Link
                href="/obras"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Obras
              </Link>
              <Link
                href="/clientes"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Clientes
              </Link>
              <span className="text-sm font-medium text-[#ed8936]">Operarios</span>
              <div onClick={() => setMenuMovilAbierto(false)}>
                <ToggleAgenteNavButton className="w-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] border border-[#ed8936] rounded-lg" />
              </div>
              <LogoutButton />
            </div>
          </div>
        ) : null}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Operarios</h1>
            <p className="text-sm text-white/70 mt-1">
              Horas reales y de convenio por mes; desglose por obra.
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
          <p className="text-white/60 text-sm">Cargando operarios…</p>
        ) : (
          <div className="space-y-3">
            {filas.length === 0 ? (
              <p className="text-white/60 text-sm">No hay operarios activos.</p>
            ) : (
              <ul className="space-y-2">
                {filas.map((op) => {
                  const abierto = expandidos.has(op.id);
                  const tieneObra = op.por_obra.length > 0;
                  return (
                    <li
                      key={op.id}
                      className="rounded-xl border border-white/10 bg-[#111827]/90 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpand(op.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors touch-manipulation"
                        aria-expanded={abierto}
                      >
                        <ChevronDown
                          className={`size-5 shrink-0 text-[#ed8936] transition-transform ${abierto ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white truncate">{op.nombre}</p>
                          <p className="text-xs text-white/60 mt-0.5 tabular-nums">
                            Mes: {op.horas_reales_mes.toFixed(2)} h reales ·{' '}
                            {op.horas_convenio_mes.toFixed(2)} h convenio
                          </p>
                        </div>
                        {!tieneObra ? (
                          <span className="text-[10px] uppercase tracking-wide text-white/40 shrink-0 hidden sm:inline">
                            Sin obra este mes
                          </span>
                        ) : null}
                      </button>
                      {abierto ? (
                        <div className="border-t border-white/10 px-4 py-3 bg-[#0f172a]/80">
                          {op.por_obra.length === 0 ? (
                            <p className="text-sm text-white/55">Sin horas registradas por obra en este mes.</p>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border border-white/10">
                              <table className="w-full text-sm text-left min-w-[280px]">
                                <thead>
                                  <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                                    <th className="px-3 py-2 font-medium">Obra</th>
                                    <th className="px-3 py-2 font-medium">Horas reales</th>
                                    <th className="px-3 py-2 font-medium">Horas convenio</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {op.por_obra.map((row) => (
                                    <tr key={`${op.id}-${row.obra_id || row.obra_nombre}`} className="border-b border-white/5">
                                      <td className="px-3 py-2 text-white/90">{row.obra_nombre}</td>
                                      <td className="px-3 py-2 tabular-nums font-semibold">
                                        {row.horas_reales.toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 tabular-nums font-semibold">
                                        {row.horas_convenio.toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {filas.length > 0 ? (
              <div className="rounded-xl border border-[#ed8936]/40 bg-[#ed8936]/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#f6ad55]">Totales del mes</span>
                <div className="text-sm tabular-nums text-[#f6ad55] font-semibold">
                  <span className="mr-4">{totales.horas_reales.toFixed(2)} h reales</span>
                  <span>{totales.horas_convenio.toFixed(2)} h convenio</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
