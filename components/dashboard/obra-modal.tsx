'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { useObraModal } from '@/contexts/obra-modal-context';
import { etiquetaGastoCategoria } from '@/lib/gastos-categoria';
import { createClient } from '@/lib/supabase/client';
import DiarioEntradaDeleteDialog from '@/components/dashboard/diario-entrada-delete-dialog';

type FichaObraResponse = {
  obra: {
    id: string;
    business_id: string;
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
  registros_jornada: Array<Record<string, unknown>>;
};

type TabKey =
  | 'resumen'
  | 'presupuestos'
  | 'albaranes'
  | 'facturas'
  | 'diario'
  | 'gastos'
  | 'horas';

function estadoBadge(estado: string | null | undefined): { label: string; className: string } {
  const s = (estado ?? '').toLowerCase();
  const map: Record<string, { label: string; className: string }> = {
    abierta: { label: 'Abierta', className: 'bg-[#A04A2F]/20 text-[#c97c5a] border border-[#A04A2F]/35' },
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

function costeHorasRealesEUR(horasReales: number): number {
  return Math.round(horasReales * 32 * 100) / 100;
}

export default function ObraModal() {
  const router = useRouter();
  const { isOpen, obraId, cerrarObra } = useObraModal();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaObraResponse | null>(null);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [estadoUpdating, setEstadoUpdating] = useState(false);
  const [pendingDeleteDiarioId, setPendingDeleteDiarioId] = useState<string | null>(null);
  const [deletingDiarioId, setDeletingDiarioId] = useState<string | null>(null);
  const [horasJornada, setHorasJornada] = useState<Array<Record<string, unknown>>>([]);
  const [horasLoading, setHorasLoading] = useState(false);
  const [horasError, setHorasError] = useState<string | null>(null);
  const [operarioNombrePorId, setOperarioNombrePorId] = useState<Map<string, string>>(
    () => new Map()
  );

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
      const full = data as FichaObraResponse;
      setFicha({
        ...full,
        registros_jornada: full.registros_jornada ?? [],
      });
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
    setHorasJornada([]);
    setHorasError(null);
    setHorasLoading(false);
    setOperarioNombrePorId(new Map());

    void recargarFicha();
  }, [isOpen, obraId]);

  useEffect(() => {
    if (tab !== 'horas' || !obraId) return;
    const businessId = ficha?.obra?.business_id;
    if (!businessId) return;

    let cancelled = false;
    setHorasLoading(true);
    setHorasError(null);

    void (async () => {
      try {
        const supabase = createClient();
        const { data, error: supaErr } = await supabase
          .from('registros_jornada')
          .select('id, fecha, horas_reales, horas_convenio, notas, operario_id')
          .eq('business_id', businessId)
          .eq('obra_id', obraId)
          .order('fecha', { ascending: false });

        if (cancelled) return;
        if (supaErr) {
          setHorasError(supaErr.message);
          setHorasJornada([]);
          setOperarioNombrePorId(new Map());
        } else {
          const rows = (data as Array<Record<string, unknown>> | null) ?? [];
          const operarioIds = [
            ...new Set(
              rows
                .map((r) => r.operario_id)
                .filter((id): id is NonNullable<typeof id> => Boolean(id))
                .map((id) => String(id))
            ),
          ];

          const nombrePorId = new Map<string, string>();
          if (operarioIds.length > 0) {
            const { data: operariosData } = await supabase
              .from('operarios')
              .select('id, nombre')
              .in('id', operarioIds);
            if (cancelled) return;
            for (const o of (operariosData ?? []) as Array<{ id: string; nombre?: string | null }>) {
              const nom = String(o.nombre ?? '').trim();
              if (nom) nombrePorId.set(String(o.id), nom);
            }
          }
          if (cancelled) return;
          setOperarioNombrePorId(nombrePorId);
          setHorasJornada(rows);
        }
      } catch {
        if (!cancelled) {
          setHorasError('Error de conexión al cargar las horas');
          setHorasJornada([]);
          setOperarioNombrePorId(new Map());
        }
      } finally {
        if (!cancelled) setHorasLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, obraId, ficha?.obra?.business_id]);

  const confirmarEliminarDiario = useCallback(async () => {
    if (!pendingDeleteDiarioId || !ficha?.obra?.business_id) return;
    const bid = ficha.obra.business_id;
    const entryId = pendingDeleteDiarioId;
    setDeletingDiarioId(entryId);
    setError(null);
    try {
      const res = await fetch(
        `/api/diario/${encodeURIComponent(entryId)}?business_id=${encodeURIComponent(bid)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'No se pudo eliminar la entrada');
        return;
      }
      setPendingDeleteDiarioId(null);
      setFicha((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entradas_diario_obra: prev.entradas_diario_obra.filter(
            (row) => String((row as { id?: unknown }).id ?? '') !== entryId
          ),
        };
      });
    } catch {
      setError('Error de conexión al eliminar la entrada');
    } finally {
      setDeletingDiarioId(null);
    }
  }, [pendingDeleteDiarioId, ficha?.obra?.business_id]);

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
    const margenEstimado = totalPresupuestado - totalGastos;

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
    <>
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={cerrarObra}
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border border-[#A04A2F]/40 bg-[#E5DFD0] shadow-xl text-white overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 py-3 sm:px-6 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-[#A04A2F] truncate">{ficha?.obra?.nombre ?? '...'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ficha?.cliente?.nombre ? (
                  <span className="text-sm text-white/85">
                    Cliente: <span className="font-semibold">{ficha.cliente.nombre}</span>
                  </span>
                ) : (
                  <span className="text-sm text-white/65">Cliente: —</span>
                )}
                {ficha?.obra?.direccion ? (
                  <span className="text-sm text-zinc-600 truncate max-w-[18rem]">
                    {ficha.obra.direccion}
                  </span>
                ) : null}
                <span className={`inline-flex items-center px-3 py-0.5 text-xs font-semibold rounded-full ${badge.className}`}>
                  {badge.label}
                </span>
                {ficha?.obra?.fecha_inicio ? (
                  <span className="text-xs text-zinc-600">
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
                      ? 'bg-transparent text-[#A04A2F] border-[#A04A2F]/60 hover:bg-[#A04A2F]/15'
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
                className="p-1.5 rounded-lg text-[#A04A2F] hover:bg-[#A04A2F]/15 border border-[#A04A2F]/50 transition-colors"
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
                ['horas', '⏱️ Horas'],
              ] as Array<[TabKey, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={[
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors touch-manipulation',
                  tab === k
                    ? 'bg-[#A04A2F]/20 border-[#A04A2F]/60 text-[#c97c5a]'
                    : 'bg-white/5 border-white/10 text-white/75 hover:bg-white/10',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {loading ? <p className="text-zinc-600 text-sm">Cargando ficha…</p> : null}
          {error ? <p className="text-red-200/95 text-sm">{error}</p> : null}

          {!loading && ficha && !error ? (
            <>
              {tab === 'resumen' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-zinc-600 uppercase tracking-wide font-semibold">Total presupuestado</p>
                      <p className="text-2xl font-bold text-[#A04A2F] mt-1">{metrics.totalPresupuestado.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-zinc-600 uppercase tracking-wide font-semibold">Total facturado</p>
                      <p className="text-2xl font-bold text-[#A04A2F] mt-1">{metrics.totalFacturado.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-zinc-600 uppercase tracking-wide font-semibold">Total gastos</p>
                      <p className="text-2xl font-bold text-[#A04A2F] mt-1">{metrics.totalGastos.toFixed(2)} €</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <p className="text-xs text-zinc-600 uppercase tracking-wide font-semibold">Margen estimado</p>
                      <p className="text-2xl font-bold text-[#A04A2F] mt-1">{metrics.margenEstimado.toFixed(2)} €</p>
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
                      <tr className="border-b border-white/10 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Importe</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.presupuestos.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-zinc-600" colSpan={4}>
                            Sin presupuestos para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.presupuestos.map((p) => {
                          const row = p as Record<string, unknown>;
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
                              <td className="px-3 py-2 text-xs text-zinc-600">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/presupuestos?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#A04A2F] hover:text-[#c97c5a] font-medium"
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
                      <tr className="border-b border-white/10 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.albaranes.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-zinc-600" colSpan={4}>
                            Sin albaranes para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.albaranes.map((a) => {
                          const row = a as Record<string, unknown>;
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2 text-xs text-white/85">{String(row.estado ?? 'pendiente')}</td>
                              <td className="px-3 py-2 tabular-nums font-semibold">
                                {parseNumber(row.total).toFixed(2)} €
                              </td>
                              <td className="px-3 py-2 text-xs text-zinc-600">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/albaranes?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#A04A2F] hover:text-[#c97c5a] font-medium"
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
                      <tr className="border-b border-white/10 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.facturas.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-sm text-zinc-600" colSpan={4}>
                            Sin facturas para esta obra
                          </td>
                        </tr>
                      ) : (
                        ficha.facturas.map((f) => {
                          const row = f as Record<string, unknown>;
                          return (
                            <tr key={String(row.id)} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-2 text-xs text-white/85">{String(row.estado ?? 'pendiente')}</td>
                              <td className="px-3 py-2 tabular-nums font-semibold">
                                {parseNumber(row.total).toFixed(2)} €
                              </td>
                              <td className="px-3 py-2 text-xs text-zinc-600">{fmtFecha(row.fecha ?? row.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => goDoc(`/facturas?id=${encodeURIComponent(String(row.id))}`)}
                                  className="text-[#A04A2F] hover:text-[#c97c5a] font-medium"
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
                    <p className="text-zinc-600 text-sm">Sin entradas en el diario para esta obra</p>
                  ) : (
                    ficha.entradas_diario_obra.map((e) => {
                      const row = e as Record<string, unknown>;
                      const fotos = Array.isArray(row.fotos) ? (row.fotos as unknown[]).filter((x) => typeof x === 'string' && x.trim()) : [];
                      const rowId = String(row.id ?? '');
                      return (
                        <div key={rowId} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-white/90 truncate">{String(row.obra_nombre ?? ficha.obra.nombre)}</p>
                              <p className="text-xs text-zinc-600 tabular-nums mt-1">
                                {fmtFecha(row.fecha ?? row.created_at)}
                              </p>
                            </div>
                            <button
                              type="button"
                              title="Eliminar entrada"
                              disabled={!ficha.obra.business_id || deletingDiarioId === rowId}
                              onClick={() => {
                                if (!rowId || !ficha.obra.business_id) return;
                                setPendingDeleteDiarioId(rowId);
                              }}
                              className="shrink-0 p-2 rounded-lg text-zinc-600 hover:text-red-300 hover:bg-red-500/15 border border-transparent hover:border-red-500/30 transition-colors disabled:opacity-40 touch-manipulation"
                              aria-label="Eliminar entrada del diario"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </div>
                          {row.texto ? (
                            <p className="text-sm text-zinc-700 mt-2 whitespace-pre-wrap">{String(row.texto)}</p>
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
                (() => {
                  /** Mismo proveedor junto (lectura más fácil); dentro de cada uno, más reciente primero. */
                  const gastosSorted = [...ficha.gastos].sort((a, b) => {
                    const ra = a as { proveedor?: unknown; fecha?: unknown; created_at?: unknown };
                    const rb = b as { proveedor?: unknown; fecha?: unknown; created_at?: unknown };
                    const pa = String(ra.proveedor ?? '')
                      .toLocaleLowerCase('es')
                      .localeCompare(String(rb.proveedor ?? '').toLocaleLowerCase('es'), 'es');
                    if (pa !== 0) return pa;
                    const fa = String(ra.fecha ?? ra.created_at ?? '');
                    const fb = String(rb.fecha ?? rb.created_at ?? '');
                    return fb.localeCompare(fa);
                  });
                  const totalObra = gastosSorted.reduce(
                    (s, g) => s + parseNumber((g as { importe_total?: unknown }).importe_total),
                    0
                  );
                  return (
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-sm text-left min-w-[640px]">
                        <thead>
                          <tr className="border-b border-white/10 bg-[#EFEADF]/90 text-zinc-700">
                            <th className="px-3 py-2 font-medium">Fecha</th>
                            <th className="px-3 py-2 font-medium">Proveedor</th>
                            <th className="px-3 py-2 font-medium">Descripción</th>
                            <th className="px-3 py-2 font-medium">Categoría</th>
                            <th className="px-3 py-2 font-medium">Importe</th>
                            <th className="px-3 py-2 font-medium">IVA</th>
                            <th className="px-3 py-2 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gastosSorted.length === 0 ? (
                            <tr>
                              <td className="px-3 py-4 text-sm text-zinc-600" colSpan={7}>
                                Sin gastos registrados en esta obra
                              </td>
                            </tr>
                          ) : (
                            <>
                              {gastosSorted.map((g, idx) => {
                                const row = g as {
                                  id?: string;
                                  proveedor?: unknown;
                                  descripcion?: unknown;
                                  categoria?: unknown;
                                  importe?: unknown;
                                  iva?: unknown;
                                  importe_total?: unknown;
                                  fecha?: unknown;
                                  created_at?: unknown;
                                };
                                const prov = String(row.proveedor ?? '—');
                                const cat = etiquetaGastoCategoria(row.categoria);
                                return (
                                  <tr
                                    key={String(row.id ?? idx)}
                                    className="border-b border-white/5 hover:bg-white/5"
                                  >
                                    <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">
                                      {fmtFecha(row.fecha ?? row.created_at)}
                                    </td>
                                    <td className="px-3 py-2 text-sm font-medium text-white/90">{prov}</td>
                                    <td className="px-3 py-2 text-xs text-white/65 max-w-[14rem] break-words">
                                      {row.descripcion ? String(row.descripcion) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-zinc-700">{cat}</td>
                                    <td className="px-3 py-2 tabular-nums font-semibold">
                                      {parseNumber(row.importe).toFixed(2)} €
                                    </td>
                                    <td className="px-3 py-2 tabular-nums font-semibold">
                                      {parseNumber(row.iva).toFixed(2)} €
                                    </td>
                                    <td className="px-3 py-2 tabular-nums font-semibold text-[#c97c5a]">
                                      {parseNumber(row.importe_total).toFixed(2)} €
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="border-t border-[#A04A2F]/40 bg-[#A04A2F]/10">
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a]" colSpan={6}>
                                  Total gastos de esta obra
                                </td>
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a] tabular-nums">
                                  {totalObra.toFixed(2)} €
                                </td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })()
              ) : null}

              {tab === 'horas' ? (
                (() => {
                  if (horasLoading) {
                    return <p className="text-zinc-600 text-sm">Cargando horas…</p>;
                  }
                  if (horasError) {
                    return <p className="text-red-200/95 text-sm">{horasError}</p>;
                  }

                  let totalReales = 0;
                  let totalConvenio = 0;
                  let totalCoste = 0;

                  const filasUi = horasJornada.map((raw, idx) => {
                    const row = raw as {
                      id?: unknown;
                      fecha?: unknown;
                      horas_reales?: unknown;
                      horas_convenio?: unknown;
                      notas?: unknown;
                      operario_id?: unknown;
                    };
                    const idKey =
                      row.operario_id != null && String(row.operario_id).trim()
                        ? String(row.operario_id)
                        : '';
                    const operarioNombre = idKey ? (operarioNombrePorId.get(idKey) ?? '—') : '—';
                    const horasReales = parseNumber(row.horas_reales);
                    const horasConvenio = parseNumber(row.horas_convenio);
                    const coste = costeHorasRealesEUR(horasReales);
                    totalReales += horasReales;
                    totalConvenio += horasConvenio;
                    totalCoste += coste;
                    const notasStr = row.notas != null && String(row.notas).trim() ? String(row.notas) : '—';
                    return {
                      key: String(row.id ?? idx),
                      operarioNombre,
                      fechaLabel: fmtFecha(row.fecha),
                      horasReales,
                      horasConvenio,
                      coste,
                      notasStr,
                    };
                  });

                  return (
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-sm text-left min-w-[720px]">
                        <thead>
                          <tr className="border-b border-white/10 bg-[#EFEADF]/90 text-zinc-700">
                            <th className="px-3 py-2 font-medium">Operario</th>
                            <th className="px-3 py-2 font-medium">Fecha</th>
                            <th className="px-3 py-2 font-medium">Horas reales</th>
                            <th className="px-3 py-2 font-medium">Horas convenio</th>
                            <th className="px-3 py-2 font-medium">Coste</th>
                            <th className="px-3 py-2 font-medium">Notas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filasUi.length === 0 ? (
                            <tr>
                              <td className="px-3 py-4 text-sm text-zinc-600" colSpan={6}>
                                No hay horas registradas para esta obra todavía.
                              </td>
                            </tr>
                          ) : (
                            <>
                              {filasUi.map((fila) => (
                                <tr key={fila.key} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="px-3 py-2 text-sm font-medium text-white/90">{fila.operarioNombre}</td>
                                  <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">{fila.fechaLabel}</td>
                                  <td className="px-3 py-2 tabular-nums font-semibold">{fila.horasReales.toFixed(2)}</td>
                                  <td className="px-3 py-2 tabular-nums font-semibold">{fila.horasConvenio.toFixed(2)}</td>
                                  <td className="px-3 py-2 tabular-nums font-semibold text-[#c97c5a]">
                                    {fila.coste.toFixed(2)} €
                                  </td>
                                  <td className="px-3 py-2 text-xs text-white/65 max-w-[14rem] break-words">
                                    {fila.notasStr}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-[#A04A2F]/40 bg-[#A04A2F]/10">
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a]" colSpan={2}>
                                  Totales
                                </td>
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a] tabular-nums">
                                  {totalReales.toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a] tabular-nums">
                                  {totalConvenio.toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 text-sm font-semibold text-[#c97c5a] tabular-nums">
                                  {totalCoste.toFixed(2)} €
                                </td>
                                <td className="px-3 py-2.5" />
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })()
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
    <DiarioEntradaDeleteDialog
      open={pendingDeleteDiarioId !== null}
      loading={Boolean(deletingDiarioId)}
      onClose={() => {
        if (!deletingDiarioId) setPendingDeleteDiarioId(null);
      }}
      onConfirm={confirmarEliminarDiario}
    />
    </>
  );
}

