'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Albaran {
  id: string;
  business_id: string;
  numero_albaran: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  descripcion_trabajos: string | null;
  lineas: unknown;
  total: number | string | null;
  fecha: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
}

export default function AlbaranesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [albaranes, setAlbaranes] = useState<Albaran[]>([]);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { createClient: createBrowserClient } = await import('@/lib/supabase/client');
      const client = createBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, [router]);

  const loadAlbaranes = async () => {
    const { data } = await supabase
      .from('albaranes')
      .select('id, business_id, numero_albaran, cliente_nombre, cliente_direccion, descripcion_trabajos, lineas, total, fecha, estado, observaciones, created_at')
      .order('created_at', { ascending: false });
    setAlbaranes((data ?? []) as Albaran[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecking) loadAlbaranes();
  }, [authChecking]);

  const setEstado = async (id: string, estado: string) => {
    await supabase.from('albaranes').update({ estado }).eq('id', id);
    loadAlbaranes();
    setDetalleId(null);
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? '').toLowerCase();
    if (s === 'facturado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-blue-600/80 text-white">Facturado</span>;
    if (s === 'entregado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-green-600/80 text-white">Entregado</span>;
    return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-yellow-500/80 text-yellow-900">Pendiente</span>;
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  const detalleItem = detalleId ? albaranes.find((a) => a.id === detalleId) : null;

  return (
    <div className="min-h-screen bg-[#1a365d] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Historial de albaranes</h1>
          <Link href="/dashboard" className="text-[#ed8936] hover:text-[#f6ad55] text-sm font-medium transition-colors">
            ← Volver al dashboard
          </Link>
        </div>

        {loading ? (
          <p className="text-white/70">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {albaranes.map((a) => (
              <li key={a.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="font-semibold text-white">{a.numero_albaran ?? '—'}</span>
                  {badgeEstado(a.estado)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-white/80 mb-3">
                  <span>Cliente: {a.cliente_nombre ?? '—'}</span>
                  <span>Total: {a.total != null ? String(a.total) : '—'}</span>
                  <span>Fecha: {a.fecha ?? new Date(a.created_at).toLocaleDateString('es-ES')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDetalleId(a.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors"
                  >
                    Ver detalle completo
                  </button>
                  {(a.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                    <button type="button" onClick={() => setEstado(a.id, 'entregado')} className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">Marcar entregado</button>
                  )}
                  {(a.estado ?? '').toLowerCase() === 'entregado' && (
                    <button type="button" onClick={() => setEstado(a.id, 'facturado')} className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">Marcar facturado</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && albaranes.length === 0 && (
          <p className="text-white/60 text-center py-8">No hay albaranes.</p>
        )}
      </div>

      {detalleItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetalleId(null)} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#1a365d] rounded-xl border border-white/10 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Albarán {detalleItem.numero_albaran ?? ''}</h2>
              <button type="button" onClick={() => setDetalleId(null)} className="p-2 text-white/80 hover:text-white rounded-lg" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm text-white/90 space-y-2">
              <p><span className="text-white/70">Cliente:</span> {detalleItem.cliente_nombre ?? '—'}</p>
              <p><span className="text-white/70">Dirección:</span> {detalleItem.cliente_direccion ?? '—'}</p>
              <p><span className="text-white/70">Total:</span> {detalleItem.total != null ? String(detalleItem.total) : '—'}</p>
              <p><span className="text-white/70">Fecha:</span> {detalleItem.fecha ?? new Date(detalleItem.created_at).toLocaleDateString('es-ES')}</p>
              <p><span className="text-white/70">Estado:</span> {badgeEstado(detalleItem.estado)}</p>
              {detalleItem.descripcion_trabajos && <p><span className="text-white/70">Descripción:</span> {detalleItem.descripcion_trabajos}</p>}
              {detalleItem.observaciones && <p><span className="text-white/70">Observaciones:</span> {detalleItem.observaciones}</p>}
              {detalleItem.lineas != null && <p><span className="text-white/70">Líneas:</span> <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(detalleItem.lineas, null, 2)}</pre></p>}
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2">
              {(detalleItem.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                <button type="button" onClick={() => setEstado(detalleItem.id, 'entregado')} className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg">Marcar entregado</button>
              )}
              {(detalleItem.estado ?? '').toLowerCase() === 'entregado' && (
                <button type="button" onClick={() => setEstado(detalleItem.id, 'facturado')} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Marcar facturado</button>
              )}
              <button type="button" onClick={() => setDetalleId(null)} className="px-4 py-2 text-sm font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
