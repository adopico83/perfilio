'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import ToggleAgenteNavButton from '@/components/dashboard/toggle-agente-nav-button';

type ClienteRow = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  num_presupuestos: number;
  num_facturas: number;
  num_albaranes: number;
};

export default function ClientesPage() {
  const router = useRouter();
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [authChecking, setAuthChecking] = useState(true);
  const [businessName, setBusinessName] = useState('tu negocio');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    nombre: '',
    telefono: '',
    email: '',
    direccion: '',
    nif: '',
    notas: '',
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
      setAuthChecking(false);

      const { data: bp } = await supabase
        .from('business_profiles')
        .select('id, nombre')
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle();

      if (!bp?.id) {
        setBusinessId(null);
        setLoading(false);
        return;
      }

      setBusinessId(bp.id);
      if (bp.nombre) setBusinessName(bp.nombre);

      try {
        const res = await fetch(`/api/clientes?business_id=${encodeURIComponent(bp.id)}`, {
          credentials: 'include',
        });
        const json = (await res.json()) as { clientes?: ClienteRow[]; error?: string };
        if (!res.ok) {
          setError(json.error ?? 'No se pudieron cargar los clientes');
          setClientes([]);
          return;
        }
        setClientes(json.clientes ?? []);
      } catch {
        setError('Error de conexión');
        setClientes([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [router, supabase]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [clientes, busqueda]);

  const crearCliente = async () => {
    const nombre = form.nombre.trim();
    if (!businessId || !nombre) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          nombre,
          telefono: form.telefono.trim() || undefined,
          email: form.email.trim() || undefined,
          direccion: form.direccion.trim() || undefined,
          nif: form.nif.trim() || undefined,
          notas: form.notas.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { cliente?: { id: string }; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear');
        return;
      }
      setModalNuevo(false);
      setForm({
        nombre: '',
        telefono: '',
        email: '',
        direccion: '',
        nif: '',
        notas: '',
      });
      const listRes = await fetch(
        `/api/clientes?business_id=${encodeURIComponent(businessId)}`,
        { credentials: 'include' }
      );
      const listJson = (await listRes.json()) as { clientes?: ClienteRow[] };
      if (listRes.ok) setClientes(listJson.clientes ?? []);
    } finally {
      setGuardando(false);
    }
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
      <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="text-white font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
          <button
            type="button"
            onClick={() => setMenuMovilAbierto((v) => !v)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors ml-auto"
            aria-label="Abrir menú"
          >
            ☰
          </button>
          <div className="hidden md:flex flex-1 min-w-0 items-center justify-end gap-2 lg:gap-3">
            <nav
              className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Secciones"
            >
              <div className="flex w-max max-w-full ml-auto flex-nowrap items-center justify-end gap-2 lg:gap-2.5 pr-1">
                <Link
                  href="/mensajes"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Mensajes
                </Link>
                <Link
                  href="/presupuestos"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Presupuestos
                </Link>
                <Link
                  href="/albaranes"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Albaranes
                </Link>
                <Link
                  href="/facturas"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Facturas
                </Link>
                <Link
                  href="/diario"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Diario
                </Link>
                <Link
                  href="/obras"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Obras
                </Link>
                <span className="text-xs lg:text-sm font-medium text-[#ed8936] shrink-0">Clientes</span>
                <Link
                  href="/operarios"
                  className="text-xs lg:text-sm text-gray-200 hover:text-white transition-colors shrink-0"
                >
                  Operarios
                </Link>
                <ToggleAgenteNavButton className="inline-flex shrink-0 items-center px-3 py-1.5 lg:px-4 lg:py-2 text-xs lg:text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors" />
              </div>
            </nav>
            <div className="flex shrink-0 flex-nowrap items-center gap-2">
              <LogoutButton />
            </div>
          </div>
        </div>

        {menuMovilAbierto && (
          <div className="md:hidden max-w-7xl mx-auto px-6 pb-4">
            <div className="bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <Link
                href="/mensajes"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Mensajes
              </Link>
              <Link
                href="/presupuestos"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Presupuestos
              </Link>
              <Link
                href="/albaranes"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Albaranes
              </Link>
              <Link
                href="/facturas"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Facturas
              </Link>
              <Link
                href="/diario"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Diario
              </Link>
              <Link
                href="/obras"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Obras
              </Link>
              <span className="text-sm font-medium text-[#ed8936]">Clientes</span>
              <Link
                href="/operarios"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Operarios
              </Link>
              <div onClick={() => setMenuMovilAbierto(false)}>
                <ToggleAgenteNavButton className="w-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] border border-[#ed8936] rounded-lg" />
              </div>
              <LogoutButton />
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              <span className="text-[#ed8936]">Clientes</span>
            </h1>
            <p className="text-sm text-white/70 mt-1">
              Fichas de contacto y documentos asociados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalNuevo(true)}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-[#ed8936] hover:bg-[#dd6b20] rounded-lg transition-colors"
          >
            Nuevo cliente
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="text-sm text-white/70 sr-only" htmlFor="buscar-cliente">
            Buscar por nombre
          </label>
          <input
            id="buscar-cliente"
            type="search"
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full sm:max-w-xs rounded-lg border border-white/15 bg-[#1a365d]/80 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#ed8936]/60"
          />
        </div>

        {error ? <p className="text-red-300 text-sm">{error}</p> : null}

        {!businessId ? (
          <p className="text-white/70 text-sm">No hay un perfil de negocio asociado.</p>
        ) : loading ? (
          <p className="text-white/60">Cargando clientes…</p>
        ) : filtrados.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1a365d]/80 p-6 text-white/70 text-sm">
            {clientes.length === 0
              ? 'Aún no hay clientes. Crea el primero con «Nuevo cliente».'
              : 'Ningún cliente coincide con la búsqueda.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1a365d]/60">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Presup.</th>
                  <th className="px-4 py-3 font-medium">Fact.</th>
                  <th className="px-4 py-3 font-medium">Alb.</th>
                  <th className="px-4 py-3 font-medium text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">{c.nombre}</td>
                    <td className="px-4 py-3 text-white/85 tabular-nums">{c.telefono ?? '—'}</td>
                    <td className="px-4 py-3 text-white/85 max-w-[12rem] truncate">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_presupuestos}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_facturas}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_albaranes}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="text-[#ed8936] hover:text-[#f6ad55] font-medium"
                      >
                        Ver ficha →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modalNuevo && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
          role="presentation"
          onClick={() => !guardando && setModalNuevo(false)}
        >
          <div
            className="bg-[#1a365d] border border-[#ed8936]/50 rounded-xl w-full max-w-md shadow-xl p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-nuevo-cliente-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="modal-nuevo-cliente-titulo" className="text-lg font-semibold text-[#ed8936] mb-4">
              Nuevo cliente
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/60 block mb-1">Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 block mb-1">Teléfono</label>
                <input
                  value={form.telefono}
                  onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 block mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 block mb-1">Dirección</label>
                <input
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 block mb-1">NIF/CIF</label>
                <input
                  value={form.nif}
                  onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-white/60 block mb-1">Notas</label>
                <textarea
                  value={form.notas}
                  onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-white/15 bg-[#0f2744] px-3 py-2 text-sm text-white resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                disabled={guardando}
                onClick={() => setModalNuevo(false)}
                className="px-4 py-2 text-sm rounded-lg border border-white/20 text-white/90 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardando || !form.nombre.trim()}
                onClick={() => void crearCliente()}
                className="px-4 py-2 text-sm rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
