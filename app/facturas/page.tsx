'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import { X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';
import { type ObrasNombreJoin, nombreObraDesdeJoin } from '@/lib/obras-nombre-join';
import {
  InvoiceEditor,
  type InvoiceEditorSavePayload,
} from '@/components/facturas/invoice-editor';

interface Factura {
  id: string;
  business_id: string;
  numero_factura: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  cliente_nif: string | null;
  descripcion_trabajos: string | null;
  lineas: unknown;
  base_imponible: number | string | null;
  iva: number | string | null;
  total: number | string | null;
  fecha: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
  obra_id: string | null;
  obras?: ObrasNombreJoin;
}

export default function FacturasPage() {
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
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [editandoDetalle, setEditandoDetalle] = useState(false);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [editError, setEditError] = useState('');
  const [facturaGuardadaId, setFacturaGuardadaId] = useState<string | null>(null);
  const [editorDataRevision, setEditorDataRevision] = useState(0);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, [router, supabase]);

  const loadFacturas = useCallback(async () => {
    const { data } = await supabase
      .from('facturas')
      .select(
        'id, business_id, numero_factura, cliente_nombre, cliente_direccion, cliente_nif, descripcion_trabajos, lineas, base_imponible, iva, total, fecha, fecha_vencimiento, estado, observaciones, created_at, obra_id, obras(nombre)'
      )
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as unknown as Factura[];
    setFacturas(rows);
    setLoading(false);
    return rows;
  }, [supabase]);

  useEffect(() => {
    if (!authChecking) queueMicrotask(() => void loadFacturas());
  }, [authChecking, loadFacturas]);

  const setEstado = async (id: string, estado: string) => {
    await supabase.from('facturas').update({ estado }).eq('id', id);
    loadFacturas();
    setDetalleId(null);
    setEditandoDetalle(false);
    setEditError('');
    setFacturaGuardadaId(null);
  };

  const abrirDetalle = (factura: Factura, modoEdicion = false) => {
    setDetalleId(factura.id);
    setEditandoDetalle(modoEdicion);
    setEditError('');
    setFacturaGuardadaId(null);
    setEditorDataRevision((n) => n + 1);
  };

  const cerrarDetalle = () => {
    setDetalleId(null);
    setEditandoDetalle(false);
    setEditError('');
    setFacturaGuardadaId(null);
  };

  const guardarDesdeEditor = async (factura: Factura, payload: InvoiceEditorSavePayload) => {
    setGuardandoEdicion(true);
    setEditError('');
    try {
      const res = await fetch('/api/agente', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: 'editar_factura',
          business_id: factura.business_id,
          tool_name: 'editar_factura',
          args: {
            id: factura.id,
            cliente_nombre: payload.cliente_nombre,
            importe_total: payload.importe_total,
            descripcion_trabajos: payload.descripcion_trabajos,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.error || data.ok !== true) {
        throw new Error(data.error ?? 'No se pudo guardar la factura');
      }
      await loadFacturas();
      setFacturaGuardadaId(factura.id);
      setEditorDataRevision((n) => n + 1);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'No se pudo guardar la factura');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? '').toLowerCase();
    if (s === 'pagada') {
      return (
        <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-[#5a7a4a]/80 text-white">
          Pagada
        </span>
      );
    }
    if (s === 'vencida') {
      return (
        <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-red-600/80 text-white">
          Vencida
        </span>
      );
    }
    return (
      <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-yellow-400/80 text-yellow-900">
        Pendiente
      </span>
    );
  };

  const descargarPDF = async (f: Factura) => {
    const res = await fetch(`/api/pdf/factura/${encodeURIComponent(f.id)}`, {
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
    const fechaStr = f.fecha ?? new Date(f.created_at).toISOString().split('T')[0];
    const num = f.numero_factura != null ? String(f.numero_factura) : f.id.slice(0, 8);
    a.download = `factura-${fechaStr}-${num}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center">
        <p className="text-zinc-900">Comprobando sesión...</p>
      </div>
    );
  }

  const detalleItem = detalleId ? facturas.find((f) => f.id === detalleId) : null;
  const detalleObraNombre = detalleItem ? nombreObraDesdeJoin(detalleItem.obras) : undefined;

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">Historial de facturas</h1>
          <VolverAlDashboard />
        </div>

        {loading ? (
          <p className="text-zinc-600">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {facturas.map((f) => {
              const obraNombre = nombreObraDesdeJoin(f.obras);
              return (
                <li key={f.id} className="bg-[#E5DFD0] border border-zinc-400/40 rounded-lg p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="space-y-1 text-sm min-w-0">
                      <p className="font-semibold text-zinc-900">
                        {f.numero_factura ?? '—'} — {f.cliente_nombre ?? '—'}
                      </p>
                      {f.obra_id && obraNombre ? (
                        <button
                          type="button"
                          onClick={() => abrirObra(f.obra_id!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#A04A2F]/20 text-[#A04A2F] border border-[#A04A2F]/45 hover:bg-[#A04A2F]/30 transition-colors max-w-full truncate"
                          title={obraNombre}
                        >
                          <span aria-hidden>📁</span>
                          {obraNombre}
                        </button>
                      ) : null}
                      <p className="text-zinc-600">
                        Fecha: {f.fecha ?? new Date(f.created_at).toLocaleDateString('es-ES')}
                      </p>
                      <p className="text-zinc-600">Vencimiento: {f.fecha_vencimiento ?? '—'}</p>
                    </div>
                    <div className="text-right space-y-1 text-sm">
                      <p className="text-zinc-700">
                        Base: {f.base_imponible != null ? String(f.base_imponible) : '—'} €
                      </p>
                      <p className="text-zinc-700">
                        IVA (21%): {f.iva != null ? String(f.iva) : '—'} €
                      </p>
                      <p className="font-semibold">
                        Total: {f.total != null ? String(f.total) : '—'} €
                      </p>
                    </div>
                    <div>{badgeEstado(f.estado)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => abrirDetalle(f)}
                      className="px-3 py-1.5 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg transition-colors"
                    >
                      Ver detalle completo
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirDetalle(f, true)}
                      className="px-3 py-1.5 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 border border-zinc-400/50 rounded-lg transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await descargarPDF(f);
                        } catch (e) {
                          console.error(e);
                          alert(e instanceof Error ? e.message : 'Error al descargar el PDF');
                        }
                      }}
                      className="px-3 py-1.5 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 border border-zinc-400/50 rounded-lg transition-colors"
                    >
                      Descargar PDF
                    </button>
                    {(f.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => setEstado(f.id, 'pagada')}
                        className="px-3 py-1.5 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg transition-colors"
                      >
                        Marcar pagada
                      </button>
                    )}
                    {(f.estado ?? '').toLowerCase() === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => setEstado(f.id, 'vencida')}
                        className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                      >
                        Marcar vencida
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && facturas.length === 0 && (
          <p className="text-zinc-500 text-center py-8">No hay facturas.</p>
        )}
      </div>

      {detalleItem && editandoDetalle ? (
        <InvoiceEditor
          key={`${detalleItem.id}-${editorDataRevision}`}
          factura={detalleItem}
          onClose={cerrarDetalle}
          onSave={(payload) => guardarDesdeEditor(detalleItem, payload)}
          saving={guardandoEdicion}
          error={editError}
          saved={facturaGuardadaId === detalleItem.id && !editError}
        />
      ) : null}

      {detalleItem && !editandoDetalle ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={cerrarDetalle} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#E5DFD0] rounded-xl border border-zinc-400/40 shadow-2xl flex flex-col">
            <div className="flex justify-between items-start gap-3 p-4 border-b border-zinc-400/40">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-zinc-900">
                  Factura {detalleItem.numero_factura ?? ''}
                </h2>
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
              <button
                type="button"
                onClick={cerrarDetalle}
                className="p-2 text-zinc-700 hover:text-zinc-900 rounded-lg shrink-0"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm text-zinc-800 space-y-2">
              <p>
                <span className="text-zinc-600">Cliente:</span> {detalleItem.cliente_nombre ?? '—'}
              </p>
              <p>
                <span className="text-zinc-600">Dirección:</span> {detalleItem.cliente_direccion ?? '—'}
              </p>
              <p>
                <span className="text-zinc-600">NIF:</span> {detalleItem.cliente_nif ?? '—'}
              </p>
              <p>
                <span className="text-zinc-600">Base imponible:</span>{' '}
                {detalleItem.base_imponible != null ? String(detalleItem.base_imponible) : '—'} €
              </p>
              <p>
                <span className="text-zinc-600">IVA:</span>{' '}
                {detalleItem.iva != null ? String(detalleItem.iva) : '—'} €
              </p>
              <p>
                <span className="text-zinc-600">Total:</span>{' '}
                {detalleItem.total != null ? String(detalleItem.total) : '—'} €
              </p>
              <p>
                <span className="text-zinc-600">Fecha:</span>{' '}
                {detalleItem.fecha ??
                  new Date(detalleItem.created_at).toLocaleDateString('es-ES')}
              </p>
              <p>
                <span className="text-zinc-600">Fecha vencimiento:</span>{' '}
                {detalleItem.fecha_vencimiento ?? '—'}
              </p>
              <p>
                <span className="text-zinc-600">Estado:</span> {badgeEstado(detalleItem.estado)}
              </p>
              {detalleItem.descripcion_trabajos && (
                <p>
                  <span className="text-zinc-600">Descripción:</span> {detalleItem.descripcion_trabajos}
                </p>
              )}
              {detalleItem.observaciones && (
                <p>
                  <span className="text-zinc-600">Observaciones:</span> {detalleItem.observaciones}
                </p>
              )}
              {detalleItem.lineas != null && (
                <p>
                  <span className="text-zinc-600">Líneas:</span>{' '}
                  <pre className="mt-1 text-xs overflow-x-auto">
                    {JSON.stringify(detalleItem.lineas, null, 2)}
                  </pre>
                </p>
              )}
            </div>
            <div className="p-4 border-t border-zinc-400/40 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditandoDetalle(true);
                  setEditError('');
                  setFacturaGuardadaId(null);
                  setEditorDataRevision((n) => n + 1);
                }}
                className="px-4 py-2 text-sm font-medium bg-[#A04A2F] hover:bg-[#8a3f28] text-white rounded-lg"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await descargarPDF(detalleItem);
                  } catch (e) {
                    console.error(e);
                    alert(e instanceof Error ? e.message : 'Error al descargar el PDF');
                  }
                }}
                className="px-4 py-2 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 border border-zinc-400/50 rounded-lg"
              >
                Descargar PDF
              </button>
              {(detalleItem.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                <>
                  <button
                    type="button"
                    onClick={() => setEstado(detalleItem.id, 'pagada')}
                    className="px-4 py-2 text-sm font-medium bg-[#5a7a4a] hover:bg-[#4d6b40] text-white rounded-lg"
                  >
                    Marcar pagada
                  </button>
                  <button
                    type="button"
                    onClick={() => setEstado(detalleItem.id, 'vencida')}
                    className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"
                  >
                    Marcar vencida
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={cerrarDetalle}
                className="px-4 py-2 text-sm font-medium bg-[#E5DFD0] hover:bg-[#D4CCBC] text-zinc-900 rounded-lg"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
