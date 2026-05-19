'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
  numero_presupuesto: number | null;
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

  const loadPresupuestos = useCallback(async () => {
    const { data } = await supabase
      .from('presupuestos')
      .select(
        'id, business_id, presupuesto_generado, fecha, estado, created_at, obra_id, cliente_nombre, numero_presupuesto, obras(nombre)'
      )
      .order('created_at', { ascending: false });
    setPresupuestos((data ?? []) as unknown as Presupuesto[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!authChecking) queueMicrotask(() => void loadPresupuestos());
  }, [authChecking, loadPresupuestos]);

  const idFromUrl = searchParams.get('id');

  useEffect(() => {
    if (loading || !idFromUrl) return;
    if (presupuestos.some((p) => p.id === idFromUrl)) {
      queueMicrotask(() => setModalId(idFromUrl));
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
        className: 'bg-gray-500/80 text-zinc-900',
      },
      pendiente: {
        label: 'Pendiente',
        className: 'bg-amber-400/95 text-gray-900',
      },
      aceptado: {
        label: 'Aceptado',
        className: 'bg-[#5a7a4a]/80 text-zinc-900',
      },
      aprobado: {
        label: 'Aprobado',
        className: 'bg-[#5a7a4a]/80 text-zinc-900',
      },
      rechazado: {
        label: 'Rechazado',
        className: 'bg-red-600/80 text-zinc-900',
      },
      facturado: {
        label: 'Facturado',
        className: 'bg-[#A04A2F]/80 text-zinc-900',
      },
      pagado: {
        label: 'Pagado',
        className: 'bg-[#5a7a4a]/95 text-zinc-900',
      },
    };
    const cfg = estilos[s] ?? {
      label: estado?.trim() ? estado : 'Borrador',
      className: 'bg-gray-500/80 text-zinc-900',
    };
    return (
      <span
        className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${cfg.className}`}
      >
        {cfg.label}
      </span>
    );
  };

  const errorRequiereEstadoAceptado = (msg: string) =>
    msg.includes('Solo se puede convertir') || msg.includes('estado aceptado');

  const generarFactura = async (p: Presupuesto) => {
    const intentar = async () => {
      const res = await fetch('/api/presupuestos/generar-factura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ presupuesto_id: p.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        numero_factura?: number;
      };
      if (!res.ok || !data.ok) {
        return { ok: false as const, error: data.error ?? 'No se pudo generar la factura' };
      }
      return {
        ok: true as const,
        numero_factura: data.numero_factura as number,
      };
    };

    let r = await intentar();
    if (
      !r.ok &&
      (p.estado ?? '').toLowerCase() === 'aprobado' &&
      errorRequiereEstadoAceptado(r.error)
    ) {
      await supabase.from('presupuestos').update({ estado: 'aceptado' }).eq('id', p.id);
      r = await intentar();
    }

    if (r.ok) {
      alert(`Factura #${r.numero_factura} generada correctamente`);
      await loadPresupuestos();
    } else {
      alert(r.error);
    }
  };

  const puedeGenerarFactura = (estado: string | null) => {
    const e = (estado ?? '').toLowerCase();
    return e === 'aceptado' || e === 'aprobado';
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
      <div className="min-h-screen bg-[#E5DFD0] flex items-center justify-center">
        <p className="text-zinc-900">Comprobando sesión...</p>
      </div>
    );
  }

  const modalItem = modalId ? presupuestos.find((p) => p.id === modalId) : null;
  const modalObraNombre = modalItem ? nombreObraDesdeJoin(modalItem.obras) : undefined;

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">Historial de presupuestos</h1>
          <VolverAlDashboard />
        </div>

        {loading ? (
          <p className="text-zinc-600">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {presupuestos.map((p) => {
              const obraNombre = nombreObraDesdeJoin(p.obras);
              const sub = lineaContextoPresupuestoLista(p);
              return (
              <li key={p.id} className="bg-[#D4CCBC] border border-zinc-400/40 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-zinc-600 text-sm">
                    {p.fecha ?? new Date(p.created_at).toLocaleDateString('es-ES')}
                    {p.numero_presupuesto != null && Number.isFinite(Number(p.numero_presupuesto))
                      ? ` · Presupuesto #${p.numero_presupuesto}`
                      : ''}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.obra_id && obraNombre ? (
                      <button
                        type="button"
                        onClick={() => abrirObra(p.obra_id!)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#A04A2F]/20 text-[#A04A2F] border border-[#A04A2F]/45 hover:bg-[#A04A2F]/30 transition-colors max-w-[14rem] truncate"
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
                  <p className="text-zinc-800 text-sm mb-3 truncate" title={sub}>
                    {sub}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setModalId(p.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors"
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
                    className="px-3 py-1.5 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 border border-zinc-400/50 rounded-lg transition-colors"
                  >
                    Descargar PDF
                  </button>
                  {puedeGenerarFactura(p.estado) && (
                    <button
                      type="button"
                      onClick={() => void generarFactura(p)}
                      className="px-3 py-1.5 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg transition-colors"
                    >
                      Generar factura
                    </button>
                  )}
                  {(p.estado ?? 'borrador') === 'borrador' && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/presupuestos/reabrir-borrador', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ presupuesto_id: p.id }),
                            });
                            const data = (await res.json().catch(() => ({}))) as { error?: string };
                            if (!res.ok) {
                              alert(data.error ?? 'No se pudo reabrir el borrador');
                              return;
                            }
                            sessionStorage.setItem('perfilio:intent_editar', p.id);
                            router.push('/dashboard');
                          } catch (e) {
                            alert(e instanceof Error ? e.message : 'No se pudo reabrir el borrador');
                          }
                        }}
                        className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors"
                      >
                        Editar borrador
                      </button>
                      <button type="button" onClick={() => setEstado(p.id, 'aprobado')} className="px-3 py-1.5 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg transition-colors">Aprobar</button>
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
          <p className="text-zinc-500 text-center py-8">No hay presupuestos.</p>
        )}
      </div>

      {modalItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={cerrarModal} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#E5DFD0] rounded-xl border border-zinc-400/40 shadow-2xl flex flex-col">
            <div className="flex justify-between items-start gap-3 p-4 border-b border-zinc-400/40">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-zinc-900">Presupuesto completo</h2>
                {modalItem.obra_id && modalObraNombre ? (
                  <button
                    type="button"
                    onClick={() => abrirObra(modalItem.obra_id!)}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#A04A2F] hover:text-[#A04A2F] transition-colors text-left"
                  >
                    <span aria-hidden>📁</span>
                    <span className="truncate">{modalObraNombre}</span>
                  </button>
                ) : null}
              </div>
              <button type="button" onClick={cerrarModal} className="p-2 text-zinc-700 hover:text-zinc-900 rounded-lg shrink-0" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-zinc-800 text-sm leading-relaxed [&>*+*]:mt-3">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="text-zinc-900">{children}</p>,
                  strong: ({ children }) => <strong className="text-[#A04A2F] font-bold">{children}</strong>,
                  ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-zinc-900">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-zinc-900">{children}</ol>,
                  li: ({ children }) => <li className="text-zinc-900">{children}</li>,
                }}
              >
                {modalItem.presupuesto_generado ?? ''}
              </ReactMarkdown>
            </div>
            <div className="p-4 border-t border-zinc-400/40 flex flex-wrap gap-2">
              {(modalItem.estado ?? 'borrador') === 'borrador' && (
                <>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'aprobado')} className="px-4 py-2 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg">Aprobar</button>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'rechazado')} className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg">Rechazar</button>
                </>
              )}
              {puedeGenerarFactura(modalItem.estado) && (
                <button
                  type="button"
                  onClick={() => void generarFactura(modalItem)}
                  className="px-4 py-2 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg"
                >
                  Generar factura
                </button>
              )}
              <button type="button" onClick={cerrarModal} className="px-4 py-2 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 rounded-lg">Cerrar</button>
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
        <div className="min-h-screen bg-[#E5DFD0] flex items-center justify-center">
          <p className="text-zinc-900">Cargando...</p>
        </div>
      }
    >
      <PresupuestosPageContent />
    </Suspense>
  );
}
