'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, Trash2 } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import DiarioEntradaModal from '@/components/dashboard/diario-entrada-modal';
import DiarioEntradaDeleteDialog from '@/components/dashboard/diario-entrada-delete-dialog';
import { useObraModal } from '@/contexts/obra-modal-context';

type DiarioEntrada = {
  id: string;
  obra_nombre: string;
  obra_id?: string | null;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
};

function DiarioPageInner() {
  const { abrirObra } = useObraModal();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [agrupado, setAgrupado] = useState<Record<string, DiarioEntrada[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [openObras, setOpenObras] = useState<Set<string>>(new Set());
  const [highlightObra, setHighlightObra] = useState<string | null>(null);
  const [entradaSeleccionada, setEntradaSeleccionada] = useState<DiarioEntrada | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DiarioEntrada | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const obraRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleObra = useCallback((nombre: string) => {
    setOpenObras((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }, []);

  const confirmarEliminarEntrada = useCallback(async () => {
    if (!businessId || !pendingDelete?.id) return;
    setDeletingId(pendingDelete.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/diario/${encodeURIComponent(pendingDelete.id)}?business_id=${encodeURIComponent(businessId)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo eliminar la entrada');
        return;
      }
      const removedId = pendingDelete.id;
      setPendingDelete(null);
      setAgrupado((prev) => {
        const next: Record<string, DiarioEntrada[]> = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = next[k].filter((e) => e.id !== removedId);
          if (next[k].length === 0) delete next[k];
        }
        return next;
      });
      setEntradaSeleccionada((cur) => (cur?.id === removedId ? null : cur));
    } catch {
      setError('Error de conexión al eliminar');
    } finally {
      setDeletingId(null);
    }
  }, [businessId, pendingDelete]);

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

      try {
        const res = await fetch(`/api/diario?business_id=${encodeURIComponent(bp.id)}`, {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          agrupado_por_obra?: Record<string, DiarioEntrada[]>;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'No se pudo cargar el diario');
          setAgrupado({});
          return;
        }
        const raw = json.agrupado_por_obra ?? {};
        const ordenado: Record<string, DiarioEntrada[]> = {};
        for (const [nombre, entradas] of Object.entries(raw)) {
          ordenado[nombre] = [...entradas].sort(
            (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
          );
        }
        setAgrupado(ordenado);
      } catch {
        setError('Error de conexión');
        setAgrupado({});
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [router, supabase]);

  const obrasOrdenadas = useMemo(() => {
    return Object.keys(agrupado).sort((a, b) => {
      const ea = agrupado[a] ?? [];
      const eb = agrupado[b] ?? [];
      const ta = ea.length ? new Date(ea[0].fecha).getTime() : 0;
      const tb = eb.length ? new Date(eb[0].fecha).getTime() : 0;
      return tb - ta;
    });
  }, [agrupado]);

  const obraFromQuery = searchParams.get('obra');

  useEffect(() => {
    if (loading || obrasOrdenadas.length === 0 || !obraFromQuery) return;

    const decoded = decodeURIComponent(obraFromQuery.trim());
    const match = obrasOrdenadas.find((n) => n === decoded);
    if (!match) return;

    setOpenObras((prev) => new Set(prev).add(match));

    const t = window.setTimeout(() => {
      const el = obraRefs.current[match];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setHighlightObra(match);
        window.setTimeout(() => setHighlightObra(null), 2000);
      }
    }, 200);

    return () => window.clearTimeout(t);
  }, [loading, obraFromQuery, obrasOrdenadas]);

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
        active="diario"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Diario de <span className="text-[#ed8936]">obra</span>
          </h1>
          <p className="text-sm text-white/70 mt-1">
            Obras en carpetas desplegables. Desde el agente puedes registrar notas o generar el PDF.
          </p>
        </div>

        {!businessId ? (
          <p className="text-white/70 text-sm">No hay un perfil de negocio asociado.</p>
        ) : error ? (
          <p className="text-red-300 text-sm">{error}</p>
        ) : loading ? (
          <p className="text-white/60">Cargando entradas…</p>
        ) : obrasOrdenadas.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1a365d]/80 p-6 text-white/70 text-sm">
            Aún no hay entradas en el diario. Usa el agente para crear la primera.
          </div>
        ) : (
          <div className="space-y-3">
            {obrasOrdenadas.map((obraNombre) => {
              const entradas = agrupado[obraNombre] ?? [];
              const direccion = entradas[0]?.obra_direccion;
              const isOpen = openObras.has(obraNombre);
              const ultimaFecha = entradas[0]?.fecha;
              const fechaUltimaStr = ultimaFecha
                ? new Date(ultimaFecha).toLocaleString('es-ES', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '—';
              const obraIdParaFicha =
                entradas.find(
                  (e) => typeof e.obra_id === 'string' && e.obra_id.trim().length > 0
                )?.obra_id ?? null;

              return (
                <div
                  key={obraNombre}
                  ref={(el) => {
                    obraRefs.current[obraNombre] = el;
                  }}
                  className={`rounded-xl border bg-[#1e3a5f]/90 border-white/10 overflow-hidden transition-[box-shadow,border-color] duration-300 ${
                    highlightObra === obraNombre
                      ? 'ring-2 ring-[#ed8936] ring-offset-2 ring-offset-[#0f172a] border-[#ed8936]/60'
                      : ''
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-stretch gap-0 sm:gap-2 border-b border-white/10 bg-[#243d5c]/95">
                    <div className="flex flex-1 min-w-0 flex-col sm:flex-row sm:items-stretch">
                      <button
                        type="button"
                        onClick={() => toggleObra(obraNombre)}
                        className="flex-1 text-left px-4 py-3 sm:py-3.5 flex items-start gap-3 min-w-0 hover:bg-white/5 transition-colors"
                        aria-expanded={isOpen}
                      >
                        <span className="text-xl shrink-0 mt-0.5" aria-hidden>
                          {isOpen ? '📂' : '📁'}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-white">{obraNombre}</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#ed8936]/25 text-[#f6ad55] border border-[#ed8936]/40">
                              {entradas.length}{' '}
                              {entradas.length === 1 ? 'entrada' : 'entradas'}
                            </span>
                          </div>
                          {direccion ? (
                            <p className="text-xs sm:text-sm text-white/55 truncate">{direccion}</p>
                          ) : null}
                          <p className="text-[11px] sm:text-xs text-white/50 tabular-nums">
                            Última entrada: {fechaUltimaStr}
                          </p>
                        </div>
                        <ChevronDown
                          className={`shrink-0 w-5 h-5 text-[#ed8936] mt-1 transition-transform duration-300 ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                          aria-hidden
                        />
                      </button>
                      {obraIdParaFicha ? (
                        <div className="flex items-center justify-center sm:justify-start px-4 pb-3 sm:pb-0 sm:px-3 sm:border-l border-white/5 sm:min-w-[9rem]">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirObra(obraIdParaFicha);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                abrirObra(obraIdParaFicha);
                              }
                            }}
                            className="text-[11px] font-semibold text-[#ed8936] hover:text-[#f6ad55] underline underline-offset-2 cursor-pointer"
                          >
                            Ver ficha de obra →
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="px-4 pb-3 sm:pb-0 sm:pr-4 sm:flex sm:items-center shrink-0 border-t border-white/5 sm:border-t-0 sm:border-l sm:pl-0 sm:ml-0">
                      <Link
                        href={`/agente?mensaje=${encodeURIComponent(
                          `genera el PDF del diario de la obra ${obraNombre}`
                        )}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex w-full sm:w-auto justify-center items-center px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white transition-colors"
                      >
                        Generar PDF
                      </Link>
                    </div>
                  </div>

                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-out"
                    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="px-4 py-3 sm:px-5 bg-[#1a365d]/40 border-t border-white/5">
                        <ul className="space-y-0">
                          {entradas.map((e, idx) => (
                            <li key={e.id}>
                              {idx > 0 ? (
                                <div className="border-t border-white/10 my-4" aria-hidden />
                              ) : null}
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setEntradaSeleccionada(e)}
                                onKeyDown={(ke) => {
                                  if (ke.key === 'Enter' || ke.key === ' ') {
                                    ke.preventDefault();
                                    setEntradaSeleccionada(e);
                                  }
                                }}
                                className="w-full text-left rounded-lg px-2 py-2 -mx-2 space-y-2 pb-3 transition-colors cursor-pointer hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/60"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                  <p className="text-xs font-medium text-[#ed8936] tabular-nums">
                                    {new Date(e.fecha).toLocaleString('es-ES', {
                                      dateStyle: 'full',
                                      timeStyle: 'short',
                                    })}
                                  </p>
                                  {e.obra_id ? (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        abrirObra(e.obra_id!);
                                      }}
                                      onKeyDown={(ev) => {
                                        if (ev.key === 'Enter' || ev.key === ' ') {
                                          ev.stopPropagation();
                                          abrirObra(e.obra_id!);
                                        }
                                      }}
                                      className="inline-flex items-center max-w-[min(100%,12rem)] px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#ed8936]/25 text-[#f6ad55] border border-[#ed8936]/45 hover:bg-[#ed8936]/35 transition-colors truncate cursor-pointer"
                                      title={obraNombre}
                                    >
                                      {obraNombre}
                                    </span>
                                  ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    title="Eliminar entrada"
                                    disabled={!businessId || deletingId === e.id}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      ev.preventDefault();
                                      if (!businessId) return;
                                      setPendingDelete(e);
                                    }}
                                    className="shrink-0 p-2 rounded-lg text-white/50 hover:text-red-300 hover:bg-red-500/15 border border-transparent hover:border-red-500/30 transition-colors disabled:opacity-40 touch-manipulation"
                                    aria-label="Eliminar entrada del diario"
                                  >
                                    <Trash2 className="size-4" aria-hidden />
                                  </button>
                                </div>
                                {e.texto ? (
                                  <p className="text-sm text-white/90 line-clamp-4 leading-relaxed">
                                    {e.texto}
                                  </p>
                                ) : (
                                  <p className="text-sm text-white/50 italic">Sin texto</p>
                                )}
                                {e.fotos && e.fotos.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-2 pointer-events-none">
                                    {e.fotos.slice(0, 4).map((url) => (
                                      <div key={url} className="overflow-hidden rounded-lg border border-white/10">
                                        <img
                                          src={url}
                                          alt=""
                                          className="w-full h-24 object-cover"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {e.videos && e.videos.length > 0 ? (
                                  <p className="text-xs text-[#f6ad55]/90 flex items-center gap-1.5 pointer-events-none">
                                    <span aria-hidden>🎬</span>
                                    {e.videos.length}{' '}
                                    {e.videos.length === 1 ? 'vídeo' : 'vídeos'} en esta entrada
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {entradaSeleccionada ? (
        <DiarioEntradaModal
          entrada={entradaSeleccionada}
          onClose={() => setEntradaSeleccionada(null)}
        />
      ) : null}

      <DiarioEntradaDeleteDialog
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deletingId) setPendingDelete(null);
        }}
        loading={Boolean(deletingId)}
        onConfirm={confirmarEliminarEntrada}
      />
    </div>
  );
}

export default function DiarioPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
          Cargando…
        </div>
      }
    >
      <DiarioPageInner />
    </Suspense>
  );
}
