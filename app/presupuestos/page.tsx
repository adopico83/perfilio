'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import ReactMarkdown from 'react-markdown';
import { X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';
import { type ObrasNombreJoin, nombreObraDesdeJoin } from '@/lib/obras-nombre-join';

interface Presupuesto {
  id: string;
  business_id: string;
  presupuesto_generado: string | null;
  fecha: string | null;
  estado: string | null;
  created_at: string;
  obra_id: string | null;
  cliente_nombre: string | null;
  obras?: ObrasNombreJoin;
}

/** Misma prioridad que el widget del dashboard: obra → cliente; nunca mensaje. */
function lineaContextoPresupuestoLista(p: Presupuesto): string | null {
  if (p.obra_id) {
    const on = (nombreObraDesdeJoin(p.obras) ?? '').trim();
    return on.length > 0 ? on : null;
  }
  const cli = (p.cliente_nombre ?? '').trim();
  return cli.length > 0 ? cli : null;
}

function PresupuestosPageContent() {
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

  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [modalId, setModalId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, [router, supabase]);

  const loadPresupuestos = async () => {
    const { data } = await supabase
      .from('presupuestos')
      .select(
        'id, business_id, presupuesto_generado, fecha, estado, created_at, obra_id, cliente_nombre, obras(nombre)'
      )
      .order('created_at', { ascending: false });
    setPresupuestos((data ?? []) as unknown as Presupuesto[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecking) loadPresupuestos();
  }, [authChecking]);

  const idFromUrl = searchParams.get('id');

  useEffect(() => {
    if (loading || !idFromUrl) return;
    if (presupuestos.some((p) => p.id === idFromUrl)) {
      setModalId(idFromUrl);
    }
  }, [loading, idFromUrl, presupuestos]);

  const cerrarModal = () => {
    setModalId(null);
    router.replace('/presupuestos');
  };

  const setEstado = async (id: string, estado: string) => {
    await supabase.from('presupuestos').update({ estado }).eq('id', id);
    loadPresupuestos();
    cerrarModal();
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? 'borrador').toLowerCase();
    const estilos: Record<string, { label: string; className: string }> = {
      borrador: {
        label: 'Borrador',
        className: 'bg-gray-500/80 text-white',
      },
      pendiente: {
        label: 'Pendiente',
        className: 'bg-amber-400/95 text-gray-900',
      },
      aceptado: {
        label: 'Aceptado',
        className: 'bg-green-600/80 text-white',
      },
      aprobado: {
        label: 'Aceptado',
        className: 'bg-green-600/80 text-white',
      },
      rechazado: {
        label: 'Rechazado',
        className: 'bg-red-600/80 text-white',
      },
      facturado: {
        label: 'Facturado',
        className: 'bg-blue-600/80 text-white',
      },
      pagado: {
        label: 'Pagado',
        className: 'bg-green-800/95 text-white',
      },
    };
    const cfg = estilos[s] ?? {
      label: estado?.trim() ? estado : 'Borrador',
      className: 'bg-gray-500/80 text-white',
    };
    return (
      <span
        className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${cfg.className}`}
      >
        {cfg.label}
      </span>
    );
  };

  const descargarPDF = async (p: Presupuesto) => {
    const res = await fetch(`/api/pdf/presupuesto/${encodeURIComponent(p.id)}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      let msg = 'Error al generar el PDF';
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fechaStr = p.fecha ?? new Date(p.created_at).toISOString().split('T')[0];
    a.download = `presupuesto-${fechaStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  const modalItem = modalId ? presupuestos.find((p) => p.id === modalId) : null;
  const modalObraNombre = modalItem ? nombreObraDesdeJoin(modalItem.obras) : undefined;

  return (
    <div className="min-h-screen bg-[#1a365d] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Historial de presupuestos</h1>
          <VolverAlDashboard />
        </div>

        {loading ? (
          <p className="text-white/70">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {presupuestos.map((p) => {
              const obraNombre = nombreObraDesdeJoin(p.obras);
              const sub = lineaContextoPresupuestoLista(p);
              return (
              <li key={p.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-white/70 text-sm">{p.fecha ?? new Date(p.created_at).toLocaleDateString('es-ES')}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.obra_id && obraNombre ? (
                      <button
                        type="button"
                        onClick={() => abrirObra(p.obra_id!)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#ed8936]/20 text-[#f6ad55] border border-[#ed8936]/45 hover:bg-[#ed8936]/30 transition-colors max-w-[14rem] truncate"
                        title={obraNombre}
                      >
                        <span aria-hidden>📁</span>
                        {obraNombre}
                      </button>
                    ) : null}
                    {badgeEstado(p.estado)}
                  </div>
                </div>
                {sub && !(p.obra_id && obraNombre) ? (
                  <p className="text-white/90 text-sm mb-3 truncate" title={sub}>
                    {sub}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setModalId(p.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors"
                  >
                    Ver presupuesto completo
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await descargarPDF(p);
                      } catch (e) {
                        console.error(e);
                        alert(e instanceof Error ? e.message : 'Error al descargar el PDF');
                      }
                    }}
                    className="px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg transition-colors"
                  >
                    Descargar PDF
                  </button>
                  {(p.estado ?? 'borrador') === 'borrador' && (
                    <>
                      <button type="button" onClick={() => setEstado(p.id, 'aprobado')} className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">Aceptar</button>
                      <button type="button" onClick={() => setEstado(p.id, 'rechazado')} className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">Rechazar</button>
                    </>
                  )}
                </div>
              </li>
            );
            })}
          </ul>
        )}

        {!loading && presupuestos.length === 0 && (
          <p className="text-white/60 text-center py-8">No hay presupuestos.</p>
        )}
      </div>

      {modalItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={cerrarModal} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#1a365d] rounded-xl border border-white/10 shadow-2xl flex flex-col">
            <div className="flex justify-between items-start gap-3 p-4 border-b border-white/10">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white">Presupuesto completo</h2>
                {modalItem.obra_id && modalObraNombre ? (
                  <button
                    type="button"
                    onClick={() => abrirObra(modalItem.obra_id!)}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#f6ad55] hover:text-[#ed8936] transition-colors text-left"
                  >
                    <span aria-hidden>📁</span>
                    <span className="truncate">{modalObraNombre}</span>
                  </button>
                ) : null}
              </div>
              <button type="button" onClick={cerrarModal} className="p-2 text-white/80 hover:text-white rounded-lg shrink-0" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-white/90 text-sm leading-relaxed [&>*+*]:mt-3">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="text-white">{children}</p>,
                  strong: ({ children }) => <strong className="text-[#ed8936] font-bold">{children}</strong>,
                  ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-white">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-white">{children}</ol>,
                  li: ({ children }) => <li className="text-white">{children}</li>,
                }}
              >
                {modalItem.presupuesto_generado ?? ''}
              </ReactMarkdown>
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2">
              {(modalItem.estado ?? 'borrador') === 'borrador' && (
                <>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'aprobado')} className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg">Aceptar</button>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'rechazado')} className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg">Rechazar</button>
                </>
              )}
              <button type="button" onClick={cerrarModal} className="px-4 py-2 text-sm font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PresupuestosPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
          <p className="text-white">Cargando...</p>
        </div>
      }
    >
      <PresupuestosPageContent />
    </Suspense>
  );
}
