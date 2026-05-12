'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pencil } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { useObraModal } from '@/contexts/obra-modal-context';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type ObraRow = {
  id: string;
  nombre: string;
  cliente_nombre: string | null;
  cliente_id: string | null;
  direccion: string | null;
  estado: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  descripcion: string | null;
  num_presupuestos: number;
  num_facturas: number;
  num_albaranes: number;
  num_gastos: number;
  tiene_diario: number;
  total_documentos?: number;
};

type EstadoLabel = 'abierta' | 'en_curso' | 'pausada' | 'cerrada';

function estadoBadgeClass(estado: string | null | undefined): { label: string; className: string } {
  const s = (estado ?? 'abierta').toLowerCase();
  const map: Record<EstadoLabel, { label: string; className: string }> = {
    abierta: { label: 'Abierta', className: 'bg-[#ed8936]/20 border border-[#ed8936]/45 text-[#f6ad55]' },
    en_curso: { label: 'En curso', className: 'bg-blue-500/15 border border-blue-500/30 text-blue-200' },
    pausada: { label: 'Pausada', className: 'bg-amber-500/15 border border-amber-500/30 text-amber-200' },
    cerrada: { label: 'Cerrada', className: 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200' },
  };
  return map[(s as EstadoLabel) ?? 'abierta'] ?? map.abierta;
}

export default function ObrasPage() {
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

  const { abrirObra } = useObraModal();
  const autoOpenedObraIdRef = useRef<string | null>(null);

  const [authChecking, setAuthChecking] = useState(true);
  const [businessName, setBusinessName] = useState('tu negocio');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [obras, setObras] = useState<ObraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  const [modalNuevo, setModalNuevo] = useState(false);
  const [modalEditar, setModalEditar] = useState<ObraRow | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [clientesOpciones, setClientesOpciones] = useState<Array<{ id: string; nombre: string }>>([]);
  const [form, setForm] = useState({
    nombre: '',
    cliente_id: '',
    direccion: '',
    estado: 'abierta' as EstadoLabel,
    fecha_inicio: '',
    descripcion: '',
  });
  const [formEdit, setFormEdit] = useState({
    nombre: '',
    cliente_id: '' as string | '__none__',
    direccion: '',
    estado: 'abierta' as EstadoLabel,
    fecha_inicio: '',
    fecha_fin: '',
    descripcion: '',
  });

  useEffect(() => {
    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      const businessId = await getBusinessIdClient(supabase);
      if (!businessId) {
        setBusinessId(null);
        setLoading(false);
        setAuthChecking(false);
        return;
      }

      setBusinessId(businessId);
      const { data: bp } = await supabase
        .from('business_profiles')
        .select('nombre')
        .eq('id', businessId)
        .maybeSingle();
      if (bp?.nombre) setBusinessName(bp.nombre);

      const { data: cliList } = await supabase
        .from('clientes')
        .select('id, nombre')
        .eq('business_id', businessId)
        .order('nombre', { ascending: true });
      setClientesOpciones((cliList ?? []) as Array<{ id: string; nombre: string }>);

      try {
        const res = await fetch(`/api/obras?business_id=${encodeURIComponent(businessId)}`, {
          credentials: 'include',
        });
        const json = (await res.json()) as { obras?: ObraRow[]; error?: string };
        if (!res.ok) {
          setError(json.error ?? 'No se pudieron cargar las obras');
          setObras([]);
          return;
        }
        setObras(json.obras ?? []);
      } catch {
        setError('Error de conexión');
        setObras([]);
      } finally {
        setLoading(false);
        setAuthChecking(false);
      }
    };

    void run();
  }, [router, supabase]);

  useEffect(() => {
    if (authChecking || loading) return;
    const obraId = searchParams.get('id')?.trim();
    if (!obraId) {
      autoOpenedObraIdRef.current = null;
      return;
    }
    if (autoOpenedObraIdRef.current === obraId) return;
    autoOpenedObraIdRef.current = obraId;
    abrirObra(obraId);
  }, [abrirObra, authChecking, loading, searchParams]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return obras;
    return obras.filter((o) => (o.nombre ?? '').toLowerCase().includes(q));
  }, [obras, busqueda]);

  const abiertas = filtradas.filter((o) => (o.estado ?? '').toLowerCase() === 'abierta');
  const enCurso = filtradas.filter((o) => (o.estado ?? '').toLowerCase() === 'en_curso');
  const pausadas = filtradas.filter((o) => (o.estado ?? '').toLowerCase() === 'pausada');
  const cerradas = filtradas.filter((o) => (o.estado ?? '').toLowerCase() === 'cerrada');

  const crearObra = async () => {
    if (!businessId) return;
    const nombre = form.nombre.trim();
    if (!nombre) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/obras', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          nombre,
          cliente_id: form.cliente_id.trim() || undefined,
          direccion: form.direccion.trim() || undefined,
          estado: form.estado,
          fecha_inicio: form.fecha_inicio.trim() || undefined,
          descripcion: form.descripcion.trim() || undefined,
        }),
      });

      const json = (await res.json()) as { obra?: ObraRow; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear la obra');
        return;
      }

      setModalNuevo(false);
      setForm({
        nombre: '',
        cliente_id: '',
        direccion: '',
        estado: 'abierta',
        fecha_inicio: '',
        descripcion: '',
      });

      // Recargar lista
      const res2 = await fetch(`/api/obras?business_id=${encodeURIComponent(businessId)}`, {
        credentials: 'include',
      });
      const json2 = (await res2.json()) as { obras?: ObraRow[]; error?: string };
      if (res2.ok) setObras(json2.obras ?? []);
    } finally {
      setGuardando(false);
    }
  };

  const abrirEditar = (o: ObraRow) => {
    setFormEdit({
      nombre: o.nombre,
      cliente_id: o.cliente_id ?? '__none__',
      direccion: o.direccion ?? '',
      estado: (['abierta', 'en_curso', 'pausada', 'cerrada'].includes(String(o.estado))
        ? o.estado
        : 'abierta') as EstadoLabel,
      fecha_inicio: o.fecha_inicio ?? '',
      fecha_fin: o.fecha_fin ?? '',
      descripcion: o.descripcion ?? '',
    });
    setModalEditar(o);
  };

  const guardarEdicion = async () => {
    if (!businessId || !modalEditar) return;
    const nombre = formEdit.nombre.trim();
    if (!nombre) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/obras', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: modalEditar.id,
          nombre,
          direccion: formEdit.direccion.trim() || null,
          estado: formEdit.estado,
          fecha_inicio: formEdit.fecha_inicio.trim() || null,
          fecha_fin: formEdit.fecha_fin.trim() || null,
          descripcion: formEdit.descripcion.trim() || null,
          cliente_id:
            formEdit.cliente_id === '__none__' || !formEdit.cliente_id ? null : formEdit.cliente_id,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo guardar');
        return;
      }
      setModalEditar(null);
      const res2 = await fetch(`/api/obras?business_id=${encodeURIComponent(businessId)}`, {
        credentials: 'include',
      });
      const json2 = (await res2.json()) as { obras?: ObraRow[]; error?: string };
      if (res2.ok) setObras(json2.obras ?? []);
    } finally {
      setGuardando(false);
    }
  };

  const renderLista = (items: ObraRow[]) => {
    if (items.length === 0) {
      return <p className="text-white/60 text-sm py-3">Sin obras</p>;
    }
    return (
      <ul className="space-y-3">
        {items.map((o) => {
          const docsTotal =
            o.total_documentos ??
            (o.num_presupuestos ?? 0) +
              (o.num_facturas ?? 0) +
              (o.num_albaranes ?? 0) +
              (o.num_gastos ?? 0) +
              (o.tiene_diario ?? 0);
          const badge = estadoBadgeClass(o.estado);
          const dirTrunc =
            o.direccion && o.direccion.length > 48 ? `${o.direccion.slice(0, 46)}…` : o.direccion;
          return (
            <li key={o.id} className="flex gap-2 items-stretch">
              <button
                type="button"
                onClick={() => abrirObra(o.id)}
                className="flex-1 min-w-0 text-left bg-[#111827] border border-white/10 rounded-xl p-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-white truncate">{o.nombre}</p>
                    <p className="text-sm text-white/70 mt-1 truncate">{o.cliente_nombre ?? 'Sin cliente'}</p>
                    {dirTrunc ? (
                      <p className="text-xs text-white/60 mt-1 truncate" title={o.direccion ?? undefined}>
                        {dirTrunc}
                      </p>
                    ) : null}
                    <p className="text-xs text-[#ed8936]/90 mt-2 tabular-nums">
                      {docsTotal} documento{docsTotal === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center px-3 py-0.5 text-xs font-semibold rounded-full ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                {o.fecha_inicio ? (
                  <p className="text-[11px] text-white/55 mt-2 tabular-nums">
                    Inicio: {o.fecha_inicio}
                  </p>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => abrirEditar(o)}
                className="shrink-0 self-center p-3 rounded-xl border border-white/15 bg-white/5 hover:bg-[#ed8936]/20 text-[#ed8936] transition-colors"
                aria-label="Editar obra"
                title="Editar"
              >
                <Pencil className="size-5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <DashboardMainNav
        brand={
          <Link
            href="/dashboard"
            className="text-white font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
        }
        betweenBrandAndMenu={
          <button
            type="button"
            onClick={() => router.refresh()}
            className="hidden"
            aria-hidden
          />
        }
        menuMovilAbierto={menuMovilAbierto}
        setMenuMovilAbierto={setMenuMovilAbierto}
        active="obras"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Obras</h1>
            <p className="text-sm text-white/70 mt-1">Gestiona proyectos, sus documentos y el diario.</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre…"
              className="w-full sm:w-72 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
            />
            <button
              type="button"
              onClick={() => setModalNuevo(true)}
              className="px-4 py-2 text-sm font-semibold bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors"
            >
              Nueva obra
            </button>
          </div>
        </section>

        {error ? <p className="text-red-200/95 text-sm">{error}</p> : null}

        {loading ? (
          <p className="text-white/60">Cargando obras…</p>
        ) : (
          <>
            <section>
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-2">Abierta</h2>
              {renderLista(abiertas)}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-2">En curso</h2>
              {renderLista(enCurso)}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-2">Pausada</h2>
              {renderLista(pausadas)}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-2">Cerrada</h2>
              {renderLista(cerradas)}
            </section>
          </>
        )}
      </main>

      {modalNuevo && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalNuevo(false)}
          role="presentation"
        >
          <div
            className="bg-[#1a365d] border border-[#ed8936]/60 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-nueva-obra"
          >
            <div className="px-4 py-3 sm:px-5 border-b border-white/10 flex items-center justify-between">
              <h3 id="modal-nueva-obra" className="text-lg font-semibold text-[#ed8936]">
                Nueva obra
              </h3>
              <button
                type="button"
                onClick={() => setModalNuevo(false)}
                className="text-white/80 hover:text-white text-2xl leading-none px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Nombre *</span>
                  <input
                    value={form.nombre}
                    onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Estado</span>
                  <select
                    value={form.estado}
                    onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value as EstadoLabel }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
                  >
                    <option value="abierta">Abierta</option>
                    <option value="en_curso">En curso</option>
                    <option value="pausada">Pausada</option>
                    <option value="cerrada">Cerrada</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Cliente ID (opcional)</span>
                  <input
                    value={form.cliente_id}
                    onChange={(e) => setForm((p) => ({ ...p, cliente_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
                    placeholder="UUID cliente"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Fecha inicio (opcional)</span>
                  <input
                    value={form.fecha_inicio}
                    onChange={(e) => setForm((p) => ({ ...p, fecha_inicio: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
                    placeholder="YYYY-MM-DD"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-xs text-white/70">Dirección (opcional)</span>
                  <input
                    value={form.direccion}
                    onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-xs text-white/70">Descripción (opcional)</span>
                  <textarea
                    value={form.descripcion}
                    onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
                    className="w-full min-h-[90px] px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/40 focus:border-[#ed8936]/70 outline-none resize-none"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNuevo(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition-colors"
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void crearObra()}
                  disabled={guardando || !form.nombre.trim() || !businessId}
                  className="px-4 py-2 text-sm font-semibold bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {guardando ? 'Creando…' : 'Crear'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalEditar && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalEditar(null)}
          role="presentation"
        >
          <div
            className="bg-[#1a365d] border border-[#ed8936]/60 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-editar-obra"
          >
            <div className="px-4 py-3 sm:px-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#1a365d] z-10">
              <h3 id="modal-editar-obra" className="text-lg font-semibold text-[#ed8936]">
                Editar obra
              </h3>
              <button
                type="button"
                onClick={() => setModalEditar(null)}
                className="text-white/80 hover:text-white text-2xl leading-none px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
              <label className="space-y-1 block">
                <span className="text-xs text-white/70">Nombre *</span>
                <input
                  value={formEdit.nombre}
                  onChange={(e) => setFormEdit((p) => ({ ...p, nombre: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-white/70">Dirección</span>
                <input
                  value={formEdit.direccion}
                  onChange={(e) => setFormEdit((p) => ({ ...p, direccion: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-white/70">Estado</span>
                <select
                  value={formEdit.estado}
                  onChange={(e) => setFormEdit((p) => ({ ...p, estado: e.target.value as EstadoLabel }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                >
                  <option value="abierta">Abierta</option>
                  <option value="en_curso">En curso</option>
                  <option value="pausada">Pausada</option>
                  <option value="cerrada">Cerrada</option>
                </select>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Fecha inicio</span>
                  <input
                    type="date"
                    value={formEdit.fecha_inicio}
                    onChange={(e) => setFormEdit((p) => ({ ...p, fecha_inicio: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/70">Fecha fin</span>
                  <input
                    type="date"
                    value={formEdit.fecha_fin}
                    onChange={(e) => setFormEdit((p) => ({ ...p, fecha_fin: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                  />
                </label>
              </div>
              <label className="space-y-1 block">
                <span className="text-xs text-white/70">Cliente</span>
                <select
                  value={formEdit.cliente_id}
                  onChange={(e) => setFormEdit((p) => ({ ...p, cliente_id: e.target.value as string | '__none__' }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                >
                  <option value="__none__">Sin cliente</option>
                  {clientesOpciones.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-white/70">Descripción</span>
                <textarea
                  value={formEdit.descripcion}
                  onChange={(e) => setFormEdit((p) => ({ ...p, descripcion: e.target.value }))}
                  className="w-full min-h-[100px] px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white resize-none focus:ring-2 focus:ring-[#ed8936]/40 outline-none"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditar(null)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition-colors"
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void guardarEdicion()}
                  disabled={guardando || !formEdit.nombre.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

