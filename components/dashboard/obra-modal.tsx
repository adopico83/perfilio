'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';

type FichaObraResponse = {
  obra: {
    id: string;
    nombre: string;
    cliente_id: string | null;
    direccion: string | null;
    estado: string | null;
    fecha_inicio: string | null;
    fecha_fin?: string | null;
    descripcion: string | null;
  };
  cliente: {
    id: string;
    nombre: string;
    direccion: string | null;
  } | null;
  presupuestos: Array<Record<string, unknown>>;
  facturas: Array<Record<string, unknown>>;
  albaranes: Array<Record<string, unknown>>;
  entradas_diario_obra: Array<Record<string, unknown>>;
  gastos: Array<Record<string, unknown>>;
};

type TabKey = 'resumen' | 'presupuestos' | 'albaranes' | 'facturas' | 'diario' | 'gastos';

function estadoBadge(estado: string | null | undefined): { label: string; className: string } {
  const s = (estado ?? '').toLowerCase();
  const map: Record<string, { label: string; className: string }> = {
    abierta: { label: 'Abierta', className: 'bg-[#ed8936]/20 text-[#f6ad55] border border-[#ed8936]/35' },
    en_curso: { label: 'En curso', className: 'bg-blue-500/15 text-blue-200 border border-blue-500/30' },
    cerrada: { label: 'Cerrada', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' },
    en_espera: { label: 'En espera', className: 'bg-amber-500/15 text-amber-200 border border-amber-500/30' },
  };
  return map[s] ?? { label: estado?.trim() ? estado : '—', className: 'bg-white/10 text-white/90 border border-white/15' };
}

function parseNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtFecha(iso: unknown): string {
  if (!iso) return '—';
  const s = String(iso);
  if (!s.trim()) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('es-ES', { dateStyle: 'medium' });
}

export default function ObraModal() {
  const router = useRouter();
  const { isOpen, obraId, cerrarObra } = useObraModal();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaObraResponse | null>(null);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [estadoUpdating, setEstadoUpdating] = useState(false);

  const recargarFicha = useCallback(async () => {
    if (!obraId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/obras/${encodeURIComponent(obraId)}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as Partial<FichaObraResponse> & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'No se pudo cargar la ficha');
        return;
      }
      setFicha((data as FichaObraResponse) ?? null);
    } catch {
      setError('Error de conexión al cargar la ficha');
    } finally {
      setLoading(false);
    }
  }, [obraId]);

  useEffect(() => {
    if (!isOpen || !obraId) return;
    setLoading(true);
    setError(null);
    setFicha(null);
    setTab('resumen');

    void recargarFicha();
  }, [isOpen, obraId]);

  const badge = useMemo(() => estadoBadge(ficha?.obra?.estado), [ficha]);

  const metrics = useMemo(() => {
    const presup = ficha?.presupuestos ?? [];
    const fact = ficha?.facturas ?? [];
    const gas = ficha?.gastos ?? [];

    const totalPresupuestado = presup.reduce((s, p) => {
      const row = p as { importe_total?: unknown; estado?: unknown };
      const est = String(row.estado ?? '').toLowerCase();
      if (est === 'rechazado') return s;
      return s + parseNumber(row.importe_total);
    }, 0);
    const totalFacturado = fact.reduce((s, f) => s + parseNumber((f as { total?: unknown }).total), 0);
    const totalGastos = gas.reduce((s, g) => s + parseNumber((g as { importe_total?: unknown }).importe_total), 0);
    const margenEstimado = totalFacturado - totalGastos;

    return { totalPresupuestado, totalFacturado, totalGastos, margenEstimado };
  }, [ficha]);

  const goDoc = (path: string) => {
    cerrarObra();
    router.push(path);
  };

  const obraEstado = ficha?.obra?.estado ?? null;
  const isCerrada = obraEstado === 'cerrada';

  const toggleObraEstado = async () => {
    if (!obraId || !ficha?.obra?.estado) return;

    const nextEstado = isCerrada ? 'abierta' : 'cerrada';
    if (!isCerrada) {
      const ok = window.confirm('¿Cerrar esta obra? Los documentos vinculados se mantendrán.');
      if (!ok) return;
    }

    setEstadoUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/obras', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: obraId, estado: nextEstado }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'No se pudo actualizar el estado de la obra');
        return;
      }

      await recargarFicha();
      router.refresh();
    } catch {
      setError('Error de conexión al actualizar el estado');
    } finally {
      setEstadoUpdating(false);
    }
  };

  if (!isOpen || !obraId) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={cerrarObra}
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border border-[#ed8936]/40 bg-[#1a365d] shadow-xl text-white overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 py-3 sm:px-6 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-[#ed8936] truncate">{ficha?.obra?.nombre ?? '...'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ficha?.cliente?.nombre ? (
                  <span className="text-sm text-white/85">
                    Cliente: <span className="font-semibold">{ficha.cliente.nombre}</span>
                  </span>
                ) : (
                  <span className="text-sm text-white/65">Cliente: —</span>
                )}
                {ficha?.obra?.direccion ? (
                  <span className="text-sm text-white/70 truncate max-w-[18rem]">
                    {ficha.obra.direccion}
                  </span>
                ) : null}
                <span className={`inline-flex items-center px-3 py-0.5 text-xs font-semibold rounded-full ${badge.className}`}>
                  {badge.label}
                </span>
                {ficha?.obra?.fecha_inicio ? (
                  <span className="text-xs text-white/60">
                    Inicio: {fmtFecha(ficha.obra.fecha_inicio)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {obraEstado ? (
                <button
                  type="button"
                  onClick={() => void toggleObraEstado()}
                  disabled={estadoUpdating}
                  className={[
                    'inline-flex items-center px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors touch-manipulation',
                    isCerrada
                      ? 'bg-transparent text-[#ed8936] border-[#ed8936]/60 hover:bg-[#ed8936]/15'
                      : 'bg-transparent text-red-200 border-red-500/60 hover:bg-red-500/15',
                    estadoUpdating ? 'opacity-60 cursor-not-allowed' : '',
                  ].join(' ')}
                  aria-label={isCerrada ? 'Reabrir obra' : 'Cerrar obra'}
                  title={isCerrada ? 'Reabrir obra' : 'Cerrar obra'}
                >
                  {isCerrada ? 'Reabrir obra' : 'Cerrar obra'}
                </button>
              ) : null}

              <button
                type="button"
                onClick={cerrarObra}
                className="p-1.5 rounded-lg text-[#ed8936] hover:bg-[#ed8936]/15 border border-[#ed8936]/50 transition-colors"
                aria-label="Cerrar"
                disabled={estadoUpdating}
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-4 py-2 sm:px-6 border-b border-white/10">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['resumen', '📋 Resumen'],
                ['presupuestos', '📄 Presupuestos'],
                ['albaranes', '📦 Albaranes'],
                ['facturas', '🧾 Facturas'],
                ['diario', '📓 Diario'],
                ['gastos', '💰 Gastos'],
              ] as Array<[TabKey, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={[
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors touch-manipulation',
                  tab === k
                    ? 'bg-[#ed8936]/20 border-[#ed8936]/60 text-[#f6ad55]'
                    : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {loading ? <p className="text-white/70 text-sm">Cargando ficha…</p> : null}
          {error ? <p className="text-red-200/95 text-sm">{error}</p> : null}

          {!loading && ficha && !error ? (
            <>
              {tab === 'resumen' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-white/60 uppercase tracking-wide font-semibold">Total presupuestado</p>
                      <p className="text-2xl font-bold text-[#ed8936] mt-1">{metrics.totalPresupuestado.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-white/60 uppercase tracking-wide font-semibold">Total facturado</p>
                      <p className="text-2xl font-bold text-[#ed8936] mt-1">{metrics.totalFacturado.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-white/60 uppercase tracking-wide font-semibold">Total gastos</p>
                      <p className="text-2xl font-bold text-[#ed8936] mt-1">{metrics.totalGastos.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-white/60 uppercase tracking-wide font-semibold">Margen estimado</p>
                      <p className="text-2xl font-bold text-[#ed8936] mt-1">{metrics.margenEstimado.toFixed(2)} €</p>
                    </div>
                  </div>

                  {ficha.obra.descripcion ? (
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-sm font-semibold text-white/85">Descripción</p>
                      <p className="text-sm text-white/75 mt-1 whitespace-pre-wrap">{ficha.obra.descripcion}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === 'presupuestos' ? (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Importe</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.presupuestos.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-white/60" colSpan={4}>
                            Sin presupuestos para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.presupuestos.map((p) => {
                          const row = p as any;
                          const estado = String(row.estado ?? 'borrador');
                          const importe = parseNumber(row.importe_total);
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2">
                                <span className="inline-flex px-3 py-0.5 text-xs font-semibold rounded-full bg-white/10 text-white/90">
                                  {estado}
                                </span>
                              </td>
                              <td className="px-3 py-2 tabular-nums font-semibold">{importe.toFixed(2)} €</td>
                              <td className="px-3 py-2 text-xs text-white/60">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/presupuestos?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#ed8936] hover:text-[#f6ad55] font-medium"
                                >
                                  Ver →
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'albaranes' ? (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.albaranes.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-white/60" colSpan={4}>
                            Sin albaranes para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.albaranes.map((a) => {
                          const row = a as any;
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2 text-xs text-white/85">{String(row.estado ?? 'pendiente')}</td>
                              <td className="px-3 py-2 tabular-nums font-semibold">
                                {parseNumber(row.total).toFixed(2)} €
                              </td>
                              <td className="px-3 py-2 text-xs text-white/60">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/albaranes?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#ed8936] hover:text-[#f6ad55] font-medium"
                                >
                                  Ver →
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'facturas' ? (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.facturas.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-white/60" colSpan={4}>
                            Sin facturas para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.facturas.map((f) => {
                          const row = f as any;
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2 text-xs text-white/85">{String(row.estado ?? 'pendiente')}</td>
                              <td className="px-3 py-2 tabular-nums font-semibold">
                                {parseNumber(row.total).toFixed(2)} €
                              </td>
                              <td className="px-3 py-2 text-xs text-white/60">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/facturas?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#ed8936] hover:text-[#f6ad55] font-medium"
                                >
                                  Ver →
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'diario' ? (
                <div className="space-y-3">
                  {ficha.entradas_diario_obra.length === 0 ? (
                    <p className="text-white/60 text-sm">Sin entradas en el diario para esta obra</p>
                  ) : (
                    ficha.entradas_diario_obra.map((e) => {
                      const row = e as any;
                      const fotos = Array.isArray(row.fotos) ? (row.fotos as unknown[]).filter((x) => typeof x === 'string' && x.trim()) : [];
                      return (
                        <div key={String(row.id)} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-white/90 truncate">{String(row.obra_nombre ?? ficha.obra.nombre)}</p>
                              <p className="text-xs text-white/60 tabular-nums mt-1">
                                {fmtFecha(row.fecha ?? row.created_at)}
                              </p>
                            </div>
                          </div>
                          {row.texto ? (
                            <p className="text-sm text-white/80 mt-2 whitespace-pre-wrap">{String(row.texto)}</p>
                          ) : null}
                          {fotos.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2 mt-3">
                              {fotos.slice(0, 3).map((url) => (
                                <img
                                  key={String(url)}
                                  src={String(url)}
                                  alt=""
                                  className="w-full h-20 object-cover rounded-md border border-white/10"
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}

              {tab === 'gastos' ? (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                        <th className="px-3 py-2 font-medium">Proveedor</th>
                        <th className="px-3 py-2 font-medium">Importe</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.gastos.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-white/60" colSpan={3}>
                            Sin gastos para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.gastos.map((g) => {
                          const row = g as any;
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2">
                                <p className="text-sm font-medium text-white/90">{String(row.proveedor ?? '—')}</p>
                                {row.descripcion ? (
                                  <p className="text-xs text-white/60 mt-0.5">{String(row.descripcion)}</p>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 tabular-nums font-semibold">
                                {parseNumber(row.importe_total).toFixed(2)} €
                              </td>
                              <td className="px-3 py-2 text-xs text-white/60">{fmtFecha(row.fecha ?? row.created_at)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

