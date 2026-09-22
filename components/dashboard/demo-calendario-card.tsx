'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';
import {
  construirCeldasMes,
  etiquetaFecha,
  eventosPorFecha,
  fechaIso,
  horaCorta,
  type AgendaEvento,
} from '@/lib/demo-calendario';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const cardClass =
  'flex w-full flex-col rounded-2xl border border-zinc-400/35 bg-[#E5DFD0] p-5 text-left shadow-sm min-h-[12.5rem] transition-colors hover:border-[#A04A2F]/45';

function hoyIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DemoCalendarioCardView({
  loading,
  proximos,
  mes,
  eventosMes,
  onAbrir,
  onCerrar,
  onMes,
  abierto,
}: {
  loading: boolean;
  proximos: AgendaEvento[];
  mes: Date;
  eventosMes: AgendaEvento[];
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  onMes: (next: Date) => void;
}) {
  const [diaDetalle, setDiaDetalle] = useState<string | null>(null);
  const celdas = useMemo(
    () => construirCeldasMes(mes.getFullYear(), mes.getMonth()),
    [mes]
  );
  const porFecha = useMemo(() => eventosPorFecha(eventosMes), [eventosMes]);
  const hoy = hoyIsoLocal();
  const tituloMes = new Date(mes.getFullYear(), mes.getMonth(), 1).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <button type="button" className={cardClass} onClick={onAbrir}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A04A2F]">Agenda</p>
          <span className="text-xs font-medium text-[#A04A2F]">Ver calendario</span>
        </div>
        <div className="mt-3 flex-1">
          {loading ? (
            <p className="text-sm text-zinc-600">Cargando reuniones…</p>
          ) : proximos.length === 0 ? (
            <p className="text-sm text-zinc-700">Sin reuniones próximas.</p>
          ) : (
            <ul className="space-y-2">
              {proximos.map((ev) => {
                const hora = horaCorta(ev.hora);
                return (
                  <li key={ev.id}>
                    <p className="text-sm font-semibold text-zinc-900 leading-snug">{ev.titulo}</p>
                    <p className="text-xs text-zinc-600">
                      {etiquetaFecha(ev.fecha)}
                      {hora ? ` · ${hora}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </button>

      {abierto ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
          onClick={onCerrar}
          role="presentation"
        >
          <div
            className="flex max-h-[min(92vh,860px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-400/40 bg-[#E5DFD0] shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-calendario-titulo"
          >
            <div className="flex items-center justify-between border-b border-zinc-400/30 px-4 py-3">
              <h3 id="demo-calendario-titulo" className="text-lg font-semibold text-[#A04A2F]">
                Calendario de reuniones
              </h3>
              <button
                type="button"
                onClick={onCerrar}
                className="px-2 text-2xl leading-none text-zinc-700"
                aria-label="Cerrar calendario"
              >
                ×
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-zinc-400/30 px-3 py-3">
              <button
                type="button"
                aria-label="Mes anterior"
                className="inline-flex size-10 items-center justify-center rounded-lg border border-zinc-400/40"
                onClick={() => {
                  setDiaDetalle(null);
                  onMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1));
                }}
              >
                <ChevronLeft className="size-5" />
              </button>
              <p className="flex-1 truncate text-center text-base font-semibold capitalize text-zinc-900">
                {tituloMes}
              </p>
              <button
                type="button"
                aria-label="Mes siguiente"
                className="inline-flex size-10 items-center justify-center rounded-lg border border-zinc-400/40"
                onClick={() => {
                  setDiaDetalle(null);
                  onMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1));
                }}
              >
                <ChevronRight className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-600 sm:text-xs">
                {DIAS.map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {celdas.map((celda, idx) => {
                  if (!celda.dia || !celda.fechaStr) {
                    return <div key={`vacio-${idx}`} className="min-h-[52px] sm:min-h-[72px]" />;
                  }
                  const eventosDia = porFecha.get(celda.fechaStr) ?? [];
                  const tiene = eventosDia.length > 0;
                  const esHoy = celda.fechaStr === hoy;
                  return (
                    <button
                      key={celda.fechaStr}
                      type="button"
                      disabled={!tiene}
                      onClick={() => tiene && setDiaDetalle(celda.fechaStr)}
                      className={[
                        'flex min-h-[52px] flex-col rounded-lg border p-1 text-left sm:min-h-[72px] sm:p-1.5',
                        esHoy ? 'border-[#A04A2F] bg-[#EFEADF]' : 'border-zinc-400/30 bg-[#EFEADF]/70',
                        tiene ? 'cursor-pointer hover:bg-[#EFEADF]' : 'cursor-default',
                      ].join(' ')}
                    >
                      <span className="text-xs font-semibold text-zinc-900 sm:text-sm">{celda.dia}</span>
                      {tiene ? (
                        <span className="mt-0.5 truncate text-[10px] font-medium text-[#A04A2F] sm:text-[11px]">
                          {eventosDia[0]?.titulo}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {diaDetalle ? (
                <div className="mt-4 border-t border-zinc-400/30 pt-4">
                  <p className="mb-2 text-sm font-semibold capitalize text-[#A04A2F]">
                    {new Date(`${diaDetalle}T12:00:00`).toLocaleDateString('es-ES', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </p>
                  <ul className="space-y-2">
                    {(porFecha.get(diaDetalle) ?? []).map((ev) => (
                      <li key={ev.id} className="rounded-lg border border-zinc-400/30 bg-[#EFEADF] px-3 py-2">
                        <p className="font-medium text-zinc-900">{ev.titulo}</p>
                        {horaCorta(ev.hora) ? (
                          <p className="text-xs text-zinc-600">{horaCorta(ev.hora)}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function DemoCalendarioCard() {
  const { businessId } = useSession();
  const [loading, setLoading] = useState(true);
  const [proximos, setProximos] = useState<AgendaEvento[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(() => new Date());
  const [eventosMes, setEventosMes] = useState<AgendaEvento[]>([]);

  useEffect(() => {
    if (!businessId) {
      setProximos([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    const hoy = new Date().toISOString().slice(0, 10);
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('business_id', businessId)
        .eq('completado', false)
        .gte('fecha', hoy)
        .order('fecha', { ascending: true })
        .limit(4);
      if (cancelled) return;
      setProximos(!error && data ? (data as AgendaEvento[]) : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const cargarMes = useCallback(
    async (fecha: Date) => {
      if (!businessId) {
        setEventosMes([]);
        return;
      }
      const y = fecha.getFullYear();
      const m = fecha.getMonth();
      const primer = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const ultimoNum = new Date(y, m + 1, 0).getDate();
      const ultimo = `${y}-${String(m + 1).padStart(2, '0')}-${String(ultimoNum).padStart(2, '0')}`;
      const supabase = createClient();
      const { data, error } = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('business_id', businessId)
        .gte('fecha', primer)
        .lte('fecha', ultimo)
        .order('fecha', { ascending: true });
      setEventosMes(
        !error && data
          ? (data as AgendaEvento[]).map((ev) => ({ ...ev, fecha: fechaIso(ev.fecha) }))
          : []
      );
    },
    [businessId]
  );

  const abrir = () => {
    const ahora = new Date();
    setMes(ahora);
    setAbierto(true);
    void cargarMes(ahora);
  };

  return (
    <DemoCalendarioCardView
      loading={loading}
      proximos={proximos}
      mes={mes}
      eventosMes={eventosMes}
      abierto={abierto}
      onAbrir={abrir}
      onCerrar={() => setAbierto(false)}
      onMes={(next) => {
        setMes(next);
        void cargarMes(next);
      }}
    />
  );
}
