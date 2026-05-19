'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type OperarioResumenPorObra = {
  obra_id: string;
  obra_nombre: string;
  horas_reales: number;
  horas_convenio: number;
  por_dia: Array<{
    fecha: string;
    horas_reales: number;
    horas_convenio: number;
  }>;
};

type OperarioResumenFila = {
  id: string;
  nombre: string;
  dni: string | null;
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

function formatearDiaCorto(fechaIso: string): string {
  const d = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return fechaIso;
  const txt = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Madrid',
  }).format(d);
  return txt.replace('.', '').toLowerCase();
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
  const [modalDniAbierto, setModalDniAbierto] = useState(false);
  const [operarioEditando, setOperarioEditando] = useState<OperarioResumenFila | null>(null);
  const [dniDraft, setDniDraft] = useState('');
  const [guardandoDni, setGuardandoDni] = useState(false);

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

  const abrirEditorDni = useCallback((op: OperarioResumenFila) => {
    setOperarioEditando(op);
    setDniDraft(op.dni ?? '');
    setModalDniAbierto(true);
  }, []);

  const guardarDni = useCallback(async () => {
    if (!businessId || !operarioEditando) return;
    setGuardandoDni(true);
    setError(null);
    try {
      const res = await fetch('/api/operarios/dni', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          operario_id: operarioEditando.id,
          dni: dniDraft.trim(),
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        operario?: { id: string; dni: string | null };
      };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo actualizar el DNI');
        return;
      }
      setFilas((prev) =>
        prev.map((f) =>
          f.id === operarioEditando.id
            ? { ...f, dni: json.operario?.dni ?? (dniDraft.trim() || null) }
            : f
        )
      );
      setModalDniAbierto(false);
      setOperarioEditando(null);
      setDniDraft('');
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardandoDni(false);
    }
  }, [businessId, dniDraft, operarioEditando]);

  useEffect(() => {
    if (!authChecking && businessId) void cargarResumen();
  }, [authChecking, businessId, cargarResumen]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center text-zinc-900">
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <DashboardMainNav
        brand={
          <Link
            href="/dashboard"
            className="text-zinc-900 font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
        }
        menuMovilAbierto={menuMovilAbierto}
        setMenuMovilAbierto={setMenuMovilAbierto}
        active="operarios"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Operarios</h1>
            <p className="text-sm text-zinc-600 mt-1">
              Horas reales y de convenio por mes; desglose por obra.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm text-zinc-700 shrink-0">
            <span className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Mes</span>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#E5DFD0] border border-zinc-400/50 text-zinc-900 tabular-nums focus:ring-2 focus:ring-[#A04A2F]/40 focus:border-[#A04A2F]/70 outline-none"
            />
          </label>
        </div>

        {error ? <p className="text-red-200/95 text-sm">{error}</p> : null}

        {!businessId ? (
          <p className="text-zinc-500 text-sm">No hay negocio vinculado a tu cuenta.</p>
        ) : loading ? (
          <p className="text-zinc-500 text-sm">Cargando operarios…</p>
        ) : (
          <div className="space-y-3">
            {filas.length === 0 ? (
              <p className="text-zinc-500 text-sm">No hay operarios activos.</p>
            ) : (
              <ul className="space-y-2">
                {filas.map((op) => {
                  const abierto = expandidos.has(op.id);
                  const tieneObra = op.por_obra.length > 0;
                  const totalRealesDesglose = op.por_obra.reduce((s, r) => s + r.horas_reales, 0);
                  const totalConvenioDesglose = op.por_obra.reduce(
                    (s, r) => s + r.horas_convenio,
                    0
                  );
                  return (
                    <li
                      key={op.id}
                      className="rounded-xl border border-zinc-400/40 bg-[#E5DFD0]/90 overflow-hidden"
                    >
                      <div className="w-full flex items-stretch gap-2 px-4 py-3 hover:bg-[#E5DFD0] transition-colors">
                        <button
                          type="button"
                          onClick={() => toggleExpand(op.id)}
                          className="flex-1 min-w-0 flex items-center gap-3 text-left touch-manipulation"
                          aria-expanded={abierto}
                        >
                          <ChevronDown
                            className={`size-5 shrink-0 text-[#A04A2F] transition-transform ${abierto ? 'rotate-180' : ''}`}
                            aria-hidden
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-zinc-900 truncate">
                              {op.nombre}
                              {op.dni ? <span className="text-zinc-500 font-normal"> · DNI {op.dni}</span> : null}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                              Mes: {op.horas_reales_mes.toFixed(2)} h reales ·{' '}
                              {op.horas_convenio_mes.toFixed(2)} h convenio
                            </p>
                          </div>
                          {!tieneObra ? (
                            <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 hidden sm:inline">
                              Sin obra este mes
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirEditorDni(op)}
                          className="shrink-0 px-2.5 py-1.5 h-fit self-center rounded-md border border-zinc-400/50 text-xs text-zinc-700 hover:bg-[#E5DFD0]"
                        >
                          Editar DNI
                        </button>
                      </div>
                      {abierto ? (
                        <div className="border-t border-zinc-400/40 px-4 py-3 bg-[#EFEADF]/80">
                          {op.por_obra.length === 0 ? (
                            <p className="text-sm text-zinc-500">Sin horas registradas por obra en este mes.</p>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border border-zinc-400/40">
                              <table className="w-full text-sm text-left min-w-[280px]">
                                <thead>
                                  <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
                                    <th className="px-3 py-2 font-medium">Detalle</th>
                                    <th className="px-3 py-2 font-medium">Horas reales</th>
                                    <th className="px-3 py-2 font-medium">Horas convenio</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {op.por_obra.map((row) => (
                                    <tr key={`${op.id}-${row.obra_id || row.obra_nombre}`} className="border-b border-zinc-400/30">
                                      <td colSpan={3} className="px-0 py-0">
                                        <table className="w-full text-sm text-left">
                                          <tbody>
                                            <tr className="bg-white/[0.03]">
                                              <td className="px-3 py-2 text-zinc-900 font-medium">{row.obra_nombre}</td>
                                              <td className="px-3 py-2 tabular-nums text-zinc-600">—</td>
                                              <td className="px-3 py-2 tabular-nums text-zinc-600">—</td>
                                            </tr>
                                            {row.por_dia.map((dia) => (
                                              <tr
                                                key={`${op.id}-${row.obra_id || row.obra_nombre}-${dia.fecha}`}
                                                className="border-t border-zinc-400/30"
                                              >
                                                <td className="px-3 py-2 text-zinc-700">
                                                  {formatearDiaCorto(dia.fecha)}
                                                </td>
                                                <td className="px-3 py-2 tabular-nums">
                                                  {dia.horas_reales.toFixed(2)}
                                                </td>
                                                <td className="px-3 py-2 tabular-nums">
                                                  {dia.horas_convenio.toFixed(2)}
                                                </td>
                                              </tr>
                                            ))}
                                            <tr className="border-t border-zinc-400/40 bg-[#A04A2F]/10">
                                              <td className="px-3 py-2 text-[#A04A2F] font-semibold">
                                                Total {row.obra_nombre}
                                              </td>
                                              <td className="px-3 py-2 tabular-nums font-semibold text-[#A04A2F]">
                                                {row.horas_reales.toFixed(2)}
                                              </td>
                                              <td className="px-3 py-2 tabular-nums font-semibold text-[#A04A2F]">
                                                {row.horas_convenio.toFixed(2)}
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-[#A04A2F]/40 bg-[#A04A2F]/10">
                                    <td
                                      colSpan={3}
                                      className="px-3 py-2.5 text-sm font-semibold text-[#A04A2F] tabular-nums"
                                    >
                                      Total {op.nombre}: {totalRealesDesglose.toFixed(2)} h reales ·{' '}
                                      {totalConvenioDesglose.toFixed(2)} h convenio
                                    </td>
                                  </tr>
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
              <div className="rounded-xl border border-[#A04A2F]/40 bg-[#A04A2F]/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#A04A2F]">Totales del mes</span>
                <div className="text-sm tabular-nums text-[#A04A2F] font-semibold">
                  <span className="mr-4">{totales.horas_reales.toFixed(2)} h reales</span>
                  <span>{totales.horas_convenio.toFixed(2)} h convenio</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>

      {modalDniAbierto && operarioEditando ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
          role="presentation"
          onClick={() => !guardandoDni && setModalDniAbierto(false)}
        >
          <div
            className="bg-[#E5DFD0] border border-[#A04A2F]/50 rounded-xl w-full max-w-md shadow-xl p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-dni-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="modal-dni-titulo" className="text-lg font-semibold text-[#A04A2F] mb-1">
              Editar DNI
            </h2>
            <p className="text-sm text-zinc-600 mb-4">{operarioEditando.nombre}</p>
            <label className="text-xs text-zinc-500 block mb-1">DNI</label>
            <input
              value={dniDraft}
              onChange={(e) => setDniDraft(e.target.value)}
              placeholder="Ej: 12345678A"
              className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
            />
            <p className="text-xs text-zinc-500 mt-2">
              Deja vacío para quitar el DNI del operario.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                disabled={guardandoDni}
                onClick={() => setModalDniAbierto(false)}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-400/50 text-zinc-800 hover:bg-[#E5DFD0]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardandoDni}
                onClick={() => void guardarDni()}
                className="px-4 py-2 text-sm rounded-lg bg-[#A04A2F] hover:bg-[#8a3f28] text-white disabled:opacity-50"
              >
                {guardandoDni ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
