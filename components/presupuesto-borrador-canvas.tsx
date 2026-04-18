'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

type BorradorResumen = {
  id: string;
  cliente_nombre: string | null;
  iva_porcentaje: number | string | null;
  estado: string;
};

type ItemRow = {
  id: string;
  borrador_id: string;
  orden: number;
  capitulo: string | null;
  descripcion: string;
  cantidad: number | string;
  unidad: string;
  precio_unitario: number | string;
  importe: number | string;
};

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function fmtEUR(n: number): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function fmtCantidad(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function PresupuestoBorradorCanvas({
  businessId,
  userId,
  supabase,
  onSendAgentMessage,
  agentLoading,
  enableRealtime = true,
}: {
  businessId: string;
  userId: string;
  supabase: SupabaseClient;
  onSendAgentMessage: (texto: string) => Promise<void>;
  agentLoading: boolean;
  /** Evita canales Realtime duplicados cuando el panel de escritorio está montado pero oculto (viewport móvil). */
  enableRealtime?: boolean;
}) {
  const [borrador, setBorrador] = useState<BorradorResumen | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  /** Solo bloquea la UI en la carga inicial (sin borrador aún). Los refetch no deben ocultar el canvas. */
  const [fetching, setFetching] = useState(true);
  const [accionEnCurso, setAccionEnCurso] = useState<'confirmar' | 'cancelar' | null>(null);
  const borradorIdRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);

  const mergeItemFromPayload = useCallback((row: ItemRow) => {
    setItems((prev) => {
      const next = prev.filter((p) => p.id !== row.id);
      next.push(row);
      return next.sort((a, b) => num(a.orden) - num(b.orden));
    });
  }, []);

  const load = useCallback(async () => {
    if (!businessId || !userId) {
      setBorrador(null);
      setItems([]);
      borradorIdRef.current = null;
      setFetching(false);
      return;
    }
    const gen = ++loadGenRef.current;
    const refetchSilencioso = borradorIdRef.current != null;
    if (!refetchSilencioso) {
      setFetching(true);
    }
    try {
      const { data: b, error: e1 } = await supabase
        .from('presupuesto_borrador')
        .select('id, cliente_nombre, iva_porcentaje, estado')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .eq('estado', 'en_construccion')
        .maybeSingle();
      if (gen !== loadGenRef.current) return;
      if (e1 || !b) {
        setBorrador(null);
        setItems([]);
        borradorIdRef.current = null;
        return;
      }
      const br = b as BorradorResumen;
      setBorrador(br);
      borradorIdRef.current = br.id;
      const { data: its, error: e2 } = await supabase
        .from('presupuesto_borrador_items')
        .select('*')
        .eq('borrador_id', br.id)
        .order('orden', { ascending: true });
      if (gen !== loadGenRef.current) return;
      if (e2) {
        setItems([]);
        return;
      }
      setItems((its ?? []) as ItemRow[]);
    } finally {
      if (gen === loadGenRef.current && !refetchSilencioso) {
        setFetching(false);
      }
    }
  }, [businessId, userId, supabase]);

  const loadRef = useRef(load);
  loadRef.current = load;

  const mergeRef = useRef(mergeItemFromPayload);
  mergeRef.current = mergeItemFromPayload;

  useEffect(() => {
    borradorIdRef.current = borrador?.id ?? null;
  }, [borrador?.id]);

  useEffect(() => {
    if (!enableRealtime) return;
    void loadRef.current();
  }, [enableRealtime, businessId, userId]);

  const prevAgentLoading = useRef(agentLoading);
  useEffect(() => {
    if (!enableRealtime) return;
    if (prevAgentLoading.current && !agentLoading) {
      void loadRef.current();
      setAccionEnCurso(null);
    }
    prevAgentLoading.current = agentLoading;
  }, [agentLoading, enableRealtime]);

  useEffect(() => {
    if (!enableRealtime) return;
    if (!businessId || !userId) return;

    const channelItems = supabase
      .channel(`presupuesto_borrador_items:${businessId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'presupuesto_borrador_items',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const activeId = borradorIdRef.current;
          const rowNew = payload.new as ItemRow | undefined;
          const rowOld = payload.old as { id?: string; borrador_id?: string } | undefined;

          if (payload.eventType === 'INSERT' && rowNew) {
            if (!activeId || rowNew.borrador_id !== activeId) {
              void loadRef.current();
              return;
            }
            mergeRef.current(rowNew);
            return;
          }
          if (payload.eventType === 'UPDATE' && rowNew) {
            if (!activeId || rowNew.borrador_id !== activeId) return;
            mergeRef.current(rowNew);
            return;
          }
          if (payload.eventType === 'DELETE' && rowOld?.id) {
            if (rowOld.borrador_id && rowOld.borrador_id !== activeId) return;
            setItems((prev) => prev.filter((p) => p.id !== rowOld.id));
          }
        }
      )
      .subscribe();

    const channelBorrador = supabase
      .channel(`presupuesto_borrador:${businessId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'presupuesto_borrador',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { user_id?: string; id?: string } | undefined;
            if (oldRow?.user_id != null && String(oldRow.user_id) !== userId) return;
            void loadRef.current();
            return;
          }
          const row = payload.new as { user_id?: string; id?: string; estado?: string } | undefined;
          if (row && row.user_id != null && String(row.user_id) !== userId) return;
          void loadRef.current();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channelItems);
      void supabase.removeChannel(channelBorrador);
    };
  }, [businessId, userId, supabase, enableRealtime]);

  const ivaPct = num(borrador?.iva_porcentaje ?? 21);
  const { base, ivaImporte, total } = useMemo(() => {
    const b = items.reduce((s, it) => s + num(it.importe), 0);
    const iva = (b * ivaPct) / 100;
    const t = b + iva;
    return { base: b, ivaImporte: iva, total: t };
  }, [items, ivaPct]);

  if (!enableRealtime) return null;
  if (!businessId || !userId) return null;
  if (fetching && !borrador) return null;
  if (!borrador) return null;

  const ocupado = agentLoading || accionEnCurso !== null;

  const handleConfirmar = async () => {
    setAccionEnCurso('confirmar');
    await onSendAgentMessage(
      'Confirma el presupuesto en borrador: ejecuta confirmar_borrador con el borrador activo.'
    );
  };

  const handleCancelar = async () => {
    setAccionEnCurso('cancelar');
    await onSendAgentMessage(
      'Cancela el borrador de presupuesto activo: ejecuta cancelar_borrador con el borrador en construcción.'
    );
  };

  return (
    <div className="border-b border-white/10 bg-[#0f2744]/80 px-3 py-2.5 shrink-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#ed8936]/95">
          Presupuesto en borrador
        </p>
        {fetching ? (
          <Loader2 className="size-3.5 animate-spin text-white/50 shrink-0" aria-hidden />
        ) : null}
      </div>
      <p className="text-xs text-white/80 mb-2 truncate" title={borrador.cliente_nombre ?? ''}>
        Cliente: <span className="text-white">{borrador.cliente_nombre ?? '—'}</span>
      </p>

      <div className="relative rounded-lg border border-white/10 overflow-hidden max-h-[40vh] overflow-y-auto">
        {ocupado ? (
          <div
            className="absolute inset-0 z-10 bg-[#0f172a]/55 flex items-center justify-center gap-2 text-xs text-white"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin text-[#ed8936]" aria-hidden />
            {accionEnCurso === 'confirmar' ? 'Confirmando…' : accionEnCurso === 'cancelar' ? 'Cancelando…' : null}
          </div>
        ) : null}
        <table className="w-full text-left text-[11px] sm:text-xs">
          <thead className="bg-black/25 text-white/70 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 font-medium">Capítulo</th>
              <th className="px-2 py-1.5 font-medium">Descripción</th>
              <th className="px-2 py-1.5 font-medium text-right">Cant.</th>
              <th className="px-2 py-1.5 font-medium">Ud.</th>
              <th className="px-2 py-1.5 font-medium text-right">Precio</th>
              <th className="px-2 py-1.5 font-medium text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-white/55 text-center">
                  Aún no hay partidas. Dicta por voz al agente.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="text-white/90">
                  <td className="px-2 py-1.5 align-top whitespace-nowrap max-w-[4.5rem] truncate">
                    {it.capitulo ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 align-top min-w-0 break-words">{it.descripcion}</td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums">{fmtCantidad(num(it.cantidad))}</td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap">{it.unidad}</td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums">{fmtEUR(num(it.precio_unitario))}</td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums font-medium text-[#ed8936]">
                    {fmtEUR(num(it.importe))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/85 justify-end">
        <span>
          Base: <strong className="text-white">{fmtEUR(base)}</strong>
        </span>
        <span>
          IVA ({ivaPct}%): <strong className="text-white">{fmtEUR(ivaImporte)}</strong>
        </span>
        <span>
          Total: <strong className="text-[#ed8936]">{fmtEUR(total)}</strong>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void handleConfirmar()}
          className="flex-1 min-w-[120px] py-1.5 rounded-md bg-[#ed8936] hover:bg-[#dd6b20] text-white text-xs font-semibold disabled:opacity-50 touch-manipulation"
        >
          Confirmar presupuesto
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void handleCancelar()}
          className="flex-1 min-w-[120px] py-1.5 rounded-md border border-red-400/50 bg-red-600/20 hover:bg-red-600/35 text-red-100 text-xs font-semibold disabled:opacity-50 touch-manipulation"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
