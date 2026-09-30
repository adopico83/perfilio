'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';
import { useDemoTenant } from '@/lib/use-demo-tenant';
import {
  mezclarMes,
  mezclarProximos,
  useDemoAgenda,
  type DemoCita,
  type NuevaCitaDemo,
} from '@/contexts/demo-agenda-context';
import { DEMO_MOCK_ENABLED, demoHoy, getDemoAgendaMes, getDemoAgendaProximos, getDemoObras } from '@/lib/demo-data';
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

const MESES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'long' })
);

const controlClass =
  'rounded-lg border border-zinc-400/40 bg-[#EFEADF] px-2 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-[#A04A2F]';
const navBtnClass =
  'inline-flex size-10 items-center justify-center rounded-lg border border-zinc-400/40 hover:bg-[#EFEADF]';

/**
 * Calendario mensual: navegación por mes y año, cuadrícula, detalle del día y alta de citas.
 * Lo usan la card del dashboard (modal) y la página Agenda de la demo.
 */
export function DemoCalendarioMes({
  mes,
  eventosMes,
  onMes,
  onAnadir,
  obras = [],
}: {
  mes: Date;
  eventosMes: DemoCita[];
  onMes: (next: Date) => void;
  /** Si se pasa, aparece «+ Añadir cita». En la demo solo guarda en estado local. */
  onAnadir?: (cita: NuevaCitaDemo) => void;
  /** Nombres de obra para el desplegable del formulario. */
  obras?: string[];
}) {
  const [diaDetalle, setDiaDetalle] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState({ titulo: '', fecha: '', hora: '09:00', obra: '', nota: '' });
  const celdas = useMemo(() => construirCeldasMes(mes.getFullYear(), mes.getMonth()), [mes]);
  const porFecha = useMemo(() => eventosPorFecha(eventosMes) as Map<string, DemoCita[]>, [eventosMes]);
  const hoy = hoyIsoLocal();
  const anioHoy = Number(hoy.slice(0, 4));
  const anios = useMemo(() => {
    const lista = [anioHoy - 1, anioHoy, anioHoy + 1, anioHoy + 2];
    if (!lista.includes(mes.getFullYear())) lista.push(mes.getFullYear());
    return lista.sort((a, b) => a - b);
  }, [anioHoy, mes]);

  const irAMes = (year: number, month: number) => {
    setDiaDetalle(null);
    onMes(new Date(year, month, 1));
  };

  const abrirForm = () => {
    setForm({ titulo: '', fecha: diaDetalle ?? hoy, hora: '09:00', obra: '', nota: '' });
    setFormAbierto(true);
  };

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const titulo = form.titulo.trim();
    if (!titulo || !form.fecha || !onAnadir) return;
    onAnadir({
      titulo,
      fecha: form.fecha,
      hora: form.hora || null,
      obra_nombre: form.obra || null,
      nota: form.nota.trim() || null,
    });
    const [y, m] = form.fecha.split('-').map(Number);
    onMes(new Date(y, m - 1, 1));
    setDiaDetalle(form.fecha);
    setFormAbierto(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-400/30 px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            className={navBtnClass}
            onClick={() => irAMes(mes.getFullYear(), mes.getMonth() - 1)}
          >
            <ChevronLeft className="size-5" />
          </button>
          <select
            aria-label="Mes"
            className={`${controlClass} capitalize`}
            value={mes.getMonth()}
            onChange={(e) => irAMes(mes.getFullYear(), Number(e.target.value))}
          >
            {MESES.map((nombre, i) => (
              <option key={nombre} value={i}>
                {nombre}
              </option>
            ))}
          </select>
          <select
            aria-label="Año"
            className={controlClass}
            value={mes.getFullYear()}
            onChange={(e) => irAMes(Number(e.target.value), mes.getMonth())}
          >
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Mes siguiente"
            className={navBtnClass}
            onClick={() => irAMes(mes.getFullYear(), mes.getMonth() + 1)}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[#A04A2F]/50 px-3 py-2 text-sm font-medium text-[#A04A2F] hover:bg-[#A04A2F]/10"
          onClick={() => {
            onMes(new Date());
            setDiaDetalle(hoy);
          }}
        >
          Hoy
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-2 mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-600 sm:text-xs">
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
            const seleccionado = celda.fechaStr === diaDetalle;
            return (
              <button
                key={celda.fechaStr}
                type="button"
                aria-pressed={seleccionado}
                onClick={() => setDiaDetalle(celda.fechaStr)}
                className={[
                  'flex min-h-[52px] cursor-pointer flex-col rounded-lg border p-1 text-left hover:bg-[#EFEADF] sm:min-h-[72px] sm:p-1.5',
                  seleccionado
                    ? 'border-[#A04A2F] bg-[#EFEADF] ring-1 ring-[#A04A2F]'
                    : esHoy
                      ? 'border-[#A04A2F] bg-[#EFEADF]'
                      : 'border-zinc-400/30 bg-[#EFEADF]/70',
                ].join(' ')}
              >
                <span className="text-xs font-semibold text-zinc-900 sm:text-sm">{celda.dia}</span>
                {tiene ? (
                  <span className="mt-0.5 truncate text-[10px] font-medium text-[#A04A2F] sm:text-[11px]">
                    {eventosDia[0]?.titulo}
                    {eventosDia.length > 1 ? ` +${eventosDia.length - 1}` : ''}
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
            {(porFecha.get(diaDetalle) ?? []).length === 0 ? (
              <p className="text-sm text-zinc-700">Sin citas este día.</p>
            ) : (
              <ul className="space-y-2">
                {(porFecha.get(diaDetalle) ?? []).map((ev) => (
                  <li key={ev.id} className="rounded-lg border border-zinc-400/30 bg-[#EFEADF] px-3 py-2">
                    <p className="font-medium text-zinc-900">{ev.titulo}</p>
                    {horaCorta(ev.hora) ? <p className="text-xs text-zinc-600">{horaCorta(ev.hora)}</p> : null}
                    {ev.obra_nombre ? <p className="text-xs text-zinc-600">Obra: {ev.obra_nombre}</p> : null}
                    {ev.nota ? <p className="mt-1 text-xs text-zinc-700">{ev.nota}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {onAnadir ? (
          <div className="mt-4 border-t border-zinc-400/30 pt-4">
            {!formAbierto ? (
              <button
                type="button"
                onClick={abrirForm}
                className="rounded-lg bg-[#A04A2F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8a3f28]"
              >
                + Añadir cita
              </button>
            ) : (
              <form onSubmit={guardar} className="space-y-3" aria-label="Nueva cita">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700 sm:col-span-3">
                    Título
                    <input
                      required
                      className={controlClass}
                      value={form.titulo}
                      onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                      placeholder="Ej.: Visita de obra"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
                    Fecha
                    <input
                      required
                      type="date"
                      className={controlClass}
                      value={form.fecha}
                      onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
                    Hora
                    <input
                      type="time"
                      className={controlClass}
                      value={form.hora}
                      onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
                    Obra (opcional)
                    <select
                      className={controlClass}
                      value={form.obra}
                      onChange={(e) => setForm((f) => ({ ...f, obra: e.target.value }))}
                    >
                      <option value="">Sin obra</option>
                      {obras.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700 sm:col-span-3">
                    Nota (opcional)
                    <textarea
                      rows={2}
                      className={controlClass}
                      value={form.nota}
                      onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-[#A04A2F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8a3f28]"
                  >
                    Guardar cita
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormAbierto(false)}
                    className="rounded-lg border border-zinc-400/50 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-[#EFEADF]"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
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
  onAnadir,
  obras,
}: {
  loading: boolean;
  proximos: DemoCita[];
  mes: Date;
  eventosMes: DemoCita[];
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  onMes: (next: Date) => void;
  onAnadir?: (cita: NuevaCitaDemo) => void;
  obras?: string[];
}) {
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, onCerrar]);

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
            <DemoCalendarioMes mes={mes} eventosMes={eventosMes} onMes={onMes} onAnadir={onAnadir} obras={obras} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function DemoCalendarioCard() {
  const { businessId } = useSession();
  const demo = useDemoTenant() && DEMO_MOCK_ENABLED;
  const [loading, setLoading] = useState(true);
  const [proximos, setProximos] = useState<AgendaEvento[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(() => new Date());
  const [eventosMes, setEventosMes] = useState<AgendaEvento[]>([]);
  const { citas: citasLocales, anadirCita } = useDemoAgenda();
  const obrasDemo = useMemo(() => (demo ? getDemoObras().map((o) => o.nombre) : undefined), [demo]);
  // En demo, las citas del mock y las añadidas a mano se combinan al vuelo (estado local compartido).
  const proximosDemo = useMemo(
    () => (demo ? mezclarProximos(getDemoAgendaProximos(new Date(), 50), citasLocales, demoHoy()) : []),
    [demo, citasLocales]
  );
  const eventosMesDemo = useMemo(
    () =>
      demo ? mezclarMes(getDemoAgendaMes(mes.getFullYear(), mes.getMonth()), citasLocales, mes.getFullYear(), mes.getMonth()) : [],
    [demo, citasLocales, mes]
  );

  useEffect(() => {
    if (demo) {
      setLoading(false);
      return;
    }
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
  }, [businessId, demo]);

  const cargarMes = useCallback(
    async (fecha: Date) => {
      if (demo) return;
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
    [businessId, demo]
  );

  const cerrar = useCallback(() => setAbierto(false), []);

  const abrir = () => {
    const ahora = new Date();
    setMes(ahora);
    setAbierto(true);
    void cargarMes(ahora);
  };

  return (
    <DemoCalendarioCardView
      loading={loading}
      proximos={demo ? proximosDemo : proximos}
      mes={mes}
      eventosMes={demo ? eventosMesDemo : eventosMes}
      abierto={abierto}
      onAbrir={abrir}
      onCerrar={cerrar}
      onAnadir={demo ? anadirCita : undefined}
      obras={obrasDemo}
      onMes={(next) => {
        setMes(next);
        void cargarMes(next);
      }}
    />
  );
}
