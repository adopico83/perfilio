'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import { X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';
import { type ObrasNombreJoin, nombreObraDesdeJoin } from '@/lib/obras-nombre-join';

interface Albaran {
  id: string;
  business_id: string;
  numero_albaran: string | null;
  cliente_nombre: string | null;
  cliente_id: string | null;
  cliente_direccion: string | null;
  descripcion_trabajos: string | null;
  lineas: unknown;
  total: number | string | null;
  fecha: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
  obra_id: string | null;
  obras?: ObrasNombreJoin;
}

export default function AlbaranesPage() {
  const { abrirObra } = useObraModal();
  const router = useRouter();
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
  const [albaranes, setAlbaranes] = useState<Albaran[]>([]);
  const [detalleId, setDetalleId] = useState<string | null>(null);

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

  const loadAlbaranes = useCallback(async () => {
    const { data } = await supabase
      .from('albaranes')
      .select('id, business_id, numero_albaran, cliente_nombre, cliente_id, cliente_direccion, descripcion_trabajos, lineas, total, fecha, estado, observaciones, created_at, obra_id, obras(nombre)')
      .order('created_at', { ascending: false });
    setAlbaranes((data ?? []) as unknown as Albaran[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!authChecking) queueMicrotask(() => void loadAlbaranes());
  }, [authChecking, loadAlbaranes]);

  const setEstado = async (id: string, estado: string) => {
    if (estado === 'facturado') {
      const { data: alb, error: selErr } = await supabase
        .from('albaranes')
        .select(
          'id, business_id, cliente_nombre, cliente_id, obra_id, total, numero_albaran'
        )
        .eq('id', id)
        .maybeSingle();

      if (selErr || !alb) {
        loadAlbaranes();
        setDetalleId(null);
        return;
      }

      const { error: updErr } = await supabase
        .from('albaranes')
        .update({ estado: 'facturado' })
        .eq('id', id);

      if (updErr) {
        loadAlbaranes();
        setDetalleId(null);
        return;
      }

      const totalNum =
        alb.total != null && Number.isFinite(Number(alb.total))
          ? Number(alb.total)
          : 0;
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const ivaPct = 21;
      const baseImponible = round2(totalNum / (1 + ivaPct / 100));
      const ivaImporte = round2(totalNum - baseImponible);
      const numLabel = String(alb.numero_albaran ?? '').trim() || alb.id;
      const concepto = `Factura generada desde albarán #${numLabel}`;

      const { error: insErr } = await supabase.from('facturas').insert({
        business_id: alb.business_id,
        cliente_nombre: alb.cliente_nombre ?? null,
        cliente_id: alb.cliente_id ?? null,
        obra_id: alb.obra_id ?? null,
        descripcion_trabajos: concepto,
        base_imponible: baseImponible,
        iva: ivaImporte,
        total: totalNum,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        albaran_id: alb.id,
      });

      if (insErr) {
        await supabase.from('albaranes').update({ estado: 'entregado' }).eq('id', id);
      }
    } else {
      await supabase.from('albaranes').update({ estado }).eq('id', id);
    }

    loadAlbaranes();
    setDetalleId(null);
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? '').toLowerCase();
    if (s === 'facturado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-[#A04A2F]/80 text-white">Facturado</span>;
    if (s === 'entregado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-[#5a7a4a]/80 text-white">Entregado</span>;
    return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-yellow-500/80 text-yellow-900">Pendiente</span>;
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#E5DFD0] flex items-center justify-center">
        <p className="text-zinc-900">Comprobando sesión...</p>
      </div>
    );
  }

  const detalleItem = detalleId ? albaranes.find((a) => a.id === detalleId) : null;
  const detalleObraNombre = detalleItem ? nombreObraDesdeJoin(detalleItem.obras) : undefined;

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">Historial de albaranes</h1>
          <VolverAlDashboard />
        </div>

        {loading ? (
          <p className="text-zinc-600">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {albaranes.map((a) => {
              const obraNombre = nombreObraDesdeJoin(a.obras);
              return (
              <li key={a.id} className="bg-[#D4CCBC] border border-zinc-400/40 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="font-semibold text-zinc-900 min-w-0">{a.numero_albaran ?? '—'}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.obra_id && obraNombre ? (
                      <button
                        type="button"
                        onClick={() => abrirObra(a.obra_id!)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#A04A2F]/20 text-[#A04A2F] border border-[#A04A2F]/45 hover:bg-[#A04A2F]/30 transition-colors max-w-[14rem] truncate"
                        title={obraNombre}
                      >
                        <span aria-hidden>📁</span>
                        {obraNombre}
                      </button>
                    ) : null}
                    {badgeEstado(a.estado)}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-zinc-700 mb-3">
                  <span>Cliente: {a.cliente_nombre ?? '—'}</span>
                  <span>Total: {a.total != null ? String(a.total) : '—'}</span>
                  <span>Fecha: {a.fecha ?? new Date(a.created_at).toLocaleDateString('es-ES')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDetalleId(a.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors"
                  >
                    Ver detalle completo
                  </button>
                  {(a.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                    <button type="button" onClick={() => setEstado(a.id, 'entregado')} className="px-3 py-1.5 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg transition-colors">Marcar entregado</button>
                  )}
                  {(a.estado ?? '').toLowerCase() === 'entregado' && (
                    <button type="button" onClick={() => setEstado(a.id, 'facturado')} className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors">Marcar facturado</button>
                  )}
                </div>
              </li>
            );
            })}
          </ul>
        )}

        {!loading && albaranes.length === 0 && (
          <p className="text-zinc-500 text-center py-8">No hay albaranes.</p>
        )}
      </div>

      {detalleItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetalleId(null)} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#E5DFD0] rounded-xl border border-zinc-400/40 shadow-2xl flex flex-col">
            <div className="flex justify-between items-start gap-3 p-4 border-b border-zinc-400/40">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-zinc-900">Albarán {detalleItem.numero_albaran ?? ''}</h2>
                {detalleItem.obra_id && detalleObraNombre ? (
                  <button
                    type="button"
                    onClick={() => abrirObra(detalleItem.obra_id!)}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#A04A2F] hover:text-[#A04A2F] transition-colors text-left"
                  >
                    <span aria-hidden>📁</span>
                    <span className="truncate">{detalleObraNombre}</span>
                  </button>
                ) : null}
              </div>
              <button type="button" onClick={() => setDetalleId(null)} className="p-2 text-zinc-700 hover:text-zinc-900 rounded-lg shrink-0" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm text-zinc-800 space-y-2">
              <p><span className="text-zinc-600">Cliente:</span> {detalleItem.cliente_nombre ?? '—'}</p>
              <p><span className="text-zinc-600">Dirección:</span> {detalleItem.cliente_direccion ?? '—'}</p>
              <p><span className="text-zinc-600">Total:</span> {detalleItem.total != null ? String(detalleItem.total) : '—'}</p>
              <p><span className="text-zinc-600">Fecha:</span> {detalleItem.fecha ?? new Date(detalleItem.created_at).toLocaleDateString('es-ES')}</p>
              <p><span className="text-zinc-600">Estado:</span> {badgeEstado(detalleItem.estado)}</p>
              {detalleItem.descripcion_trabajos && <p><span className="text-zinc-600">Descripción:</span> {detalleItem.descripcion_trabajos}</p>}
              {detalleItem.observaciones && <p><span className="text-zinc-600">Observaciones:</span> {detalleItem.observaciones}</p>}
              {detalleItem.lineas != null && <p><span className="text-zinc-600">Líneas:</span> <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(detalleItem.lineas, null, 2)}</pre></p>}
            </div>
            <div className="p-4 border-t border-zinc-400/40 flex gap-2">
              {(detalleItem.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                <button type="button" onClick={() => setEstado(detalleItem.id, 'entregado')} className="px-4 py-2 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg">Marcar entregado</button>
              )}
              {(detalleItem.estado ?? '').toLowerCase() === 'entregado' && (
                <button type="button" onClick={() => setEstado(detalleItem.id, 'facturado')} className="px-4 py-2 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg">Marcar facturado</button>
              )}
              <button type="button" onClick={() => setDetalleId(null)} className="px-4 py-2 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
