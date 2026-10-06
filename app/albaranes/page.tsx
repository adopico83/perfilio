'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import { X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';
import { type ObrasNombreJoin, nombreObraDesdeJoin } from '@/lib/obras-nombre-join';
import { useDemoTenant } from '@/lib/use-demo-tenant';
import { DEMO_MOCK_ENABLED, getDemoAlbaranes } from '@/lib/demo-data';
import Link from 'next/link';

const IVA_OPCIONES = [0, 4, 10, 21] as const;

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
  const demo = useDemoTenant() && DEMO_MOCK_ENABLED;
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
  const [errorAccion, setErrorAccion] = useState('');
  const [aFacturar, setAFacturar] = useState<Albaran | null>(null);
  const [ivaElegido, setIvaElegido] = useState<number>(21);
  const [facturando, setFacturando] = useState(false);
  const [facturaCreada, setFacturaCreada] = useState<number | null>(null);
  const [avisoFactura, setAvisoFactura] = useState('');

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
    if (demo) {
      setAlbaranes(getDemoAlbaranes() as unknown as Albaran[]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('albaranes')
      .select('id, business_id, numero_albaran, cliente_nombre, cliente_id, cliente_direccion, descripcion_trabajos, lineas, total, fecha, estado, observaciones, created_at, obra_id, obras(nombre)')
      .order('created_at', { ascending: false });
    setAlbaranes((data ?? []) as unknown as Albaran[]);
    setLoading(false);
  }, [supabase, demo]);

  useEffect(() => {
    if (!authChecking) queueMicrotask(() => void loadAlbaranes());
  }, [authChecking, loadAlbaranes]);

  /** Cambia pendiente/entregado por la API (el navegador no puede escribir en `albaranes`). */
  const setEstado = async (id: string, estado: 'pendiente' | 'entregado') => {
    setErrorAccion('');
    if (demo) {
      setAlbaranes((prev) => prev.map((a) => (a.id === id ? { ...a, estado } : a)));
      setDetalleId(null);
      return;
    }
    try {
      const res = await fetch(`/api/albaranes/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorAccion(data.error ?? 'No se pudo cambiar el estado del albarán');
        return;
      }
      await loadAlbaranes();
      setDetalleId(null);
    } catch {
      setErrorAccion('No se pudo cambiar el estado del albarán');
    }
  };

  const abrirFacturar = (a: Albaran) => {
    setErrorAccion('');
    setFacturaCreada(null);
    setAvisoFactura('');
    setIvaElegido(21);
    setAFacturar(a);
  };

  /** Crea la factura por la API: el servidor calcula base e IVA y le da su número correlativo. */
  const facturar = async (a: Albaran) => {
    setFacturando(true);
    setErrorAccion('');
    if (demo) {
      setAlbaranes((prev) => prev.map((x) => (x.id === a.id ? { ...x, estado: 'facturado' } : x)));
      setAFacturar(null);
      setDetalleId(null);
      setFacturando(false);
      return;
    }
    try {
      const res = await fetch(`/api/albaranes/${encodeURIComponent(a.id)}/facturar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iva_porcentaje: ivaElegido }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; numero_factura?: number; aviso?: string };
      if (!res.ok) {
        setErrorAccion(data.error ?? 'No se pudo crear la factura');
        return;
      }
      setFacturaCreada(data.numero_factura ?? null);
      setAvisoFactura(data.aviso ?? '');
      setAFacturar(null);
      setDetalleId(null);
      await loadAlbaranes();
    } catch {
      setErrorAccion('No se pudo crear la factura');
    } finally {
      setFacturando(false);
    }
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
        {errorAccion ? (
          <p role="alert" className="mb-4 rounded-lg border border-[#A04A2F]/50 bg-[#E5DFD0] px-3 py-2 text-sm text-[#A04A2F]">
            {errorAccion}
          </p>
        ) : null}
        {avisoFactura ? (
          <p role="status" className="mb-4 rounded-lg border border-[#A04A2F]/50 bg-[#D4CCBC] px-3 py-2 text-sm text-zinc-900">
            {avisoFactura}
          </p>
        ) : null}
        {facturaCreada != null ? (
          <p role="status" className="mb-4 rounded-lg border border-[#5a7a4a]/50 bg-[#E5DFD0] px-3 py-2 text-sm text-[#5a7a4a]">
            Factura nº {facturaCreada} creada.{' '}
            <Link href="/facturas" className="font-semibold underline">
              Ver en Facturas
            </Link>
          </p>
        ) : null}

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
                    <button type="button" onClick={() => abrirFacturar(a)} className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors">Marcar facturado</button>
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
                <button type="button" onClick={() => abrirFacturar(detalleItem)} className="px-4 py-2 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg">Marcar facturado</button>
              )}
              <button type="button" onClick={() => setDetalleId(null)} className="px-4 py-2 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {aFacturar && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !facturando && setAFacturar(null)} aria-hidden />
          <div role="dialog" aria-label="Facturar albarán" className="relative w-full max-w-md bg-[#E5DFD0] rounded-xl border border-zinc-400/40 shadow-2xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-zinc-900">Facturar albarán {aFacturar.numero_albaran ?? ''}</h2>
            <label className="block text-sm text-zinc-800">
              IVA
              <select
                aria-label="IVA de la factura"
                value={ivaElegido}
                onChange={(e) => setIvaElegido(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-zinc-400/60 bg-white px-3 py-2 text-sm"
              >
                {IVA_OPCIONES.map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-zinc-700">
              Se creará la factura del albarán nº {aFacturar.numero_albaran ?? ''} por{' '}
              {aFacturar.total != null ? String(aFacturar.total) : '—'} € IVA incluido.
            </p>
            {errorAccion ? <p role="alert" className="text-sm text-[#A04A2F]">{errorAccion}</p> : null}
            <div className="flex gap-2">
              <button type="button" disabled={facturando} onClick={() => void facturar(aFacturar)} className="px-4 py-2 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg disabled:opacity-60">
                {facturando ? 'Creando…' : 'Crear factura'}
              </button>
              <button type="button" disabled={facturando} onClick={() => setAFacturar(null)} className="px-4 py-2 text-sm font-medium bg-[#D4CCBC] hover:bg-[#c9c0ae] text-zinc-900 rounded-lg">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
