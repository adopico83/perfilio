'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

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

      const businessId = await getBusinessIdClient(supabase);
      if (!businessId) {
        setBusinessId(null);
        setLoading(false);
        return;
      }

      setBusinessId(businessId);
      const { data: bp } = await supabase
        .from('business_profiles')
        .select('nombre')
        .eq('id', businessId)
        .maybeSingle();
      if (bp?.nombre) setBusinessName(bp.nombre);

      try {
        const res = await fetch(`/api/clientes?business_id=${encodeURIComponent(businessId)}`, {
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
      <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center text-zinc-900">
        Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <DashboardMainNav
        brand={
          <Link
            href="/dashboard"
            className="text-zinc-900 font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)] sm:max-w-[min(260px,40vw)]"
          >
            {businessName}
          </Link>
        }
        menuMovilAbierto={menuMovilAbierto}
        setMenuMovilAbierto={setMenuMovilAbierto}
        active="clientes"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">
              <span className="text-[#A04A2F]">Clientes</span>
            </h1>
            <p className="text-sm text-zinc-600 mt-1">
              Fichas de contacto y documentos asociados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalNuevo(true)}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-[#A04A2F] hover:bg-[#8a3f28] rounded-lg transition-colors"
          >
            Nuevo cliente
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="text-sm text-zinc-600 sr-only" htmlFor="buscar-cliente">
            Buscar por nombre
          </label>
          <input
            id="buscar-cliente"
            type="search"
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full sm:max-w-xs rounded-lg border border-zinc-400/50 bg-[#E5DFD0]/80 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#A04A2F]/60"
          />
        </div>

        {error ? <p className="text-red-300 text-sm">{error}</p> : null}

        {!businessId ? (
          <p className="text-zinc-600 text-sm">No hay un perfil de negocio asociado.</p>
        ) : loading ? (
          <p className="text-zinc-500">Cargando clientes…</p>
        ) : filtrados.length === 0 ? (
          <div className="rounded-xl border border-zinc-400/40 bg-[#E5DFD0]/80 p-6 text-zinc-600 text-sm">
            {clientes.length === 0
              ? 'Aún no hay clientes. Crea el primero con «Nuevo cliente».'
              : 'Ningún cliente coincide con la búsqueda.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-400/40 bg-[#E5DFD0]/60">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
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
                  <tr key={c.id} className="bg-[#E5DFD0] border-b border-zinc-300/50 hover:bg-[#D4CCBC]">
                    <td className="px-4 py-3 font-medium text-zinc-900">{c.nombre}</td>
                    <td className="px-4 py-3 text-zinc-700 tabular-nums">{c.telefono ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-700 max-w-[12rem] truncate">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_presupuestos}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_facturas}</td>
                    <td className="px-4 py-3 tabular-nums">{c.num_albaranes}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="text-[#A04A2F] hover:text-[#A04A2F] font-medium"
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
            className="bg-[#E5DFD0] border border-[#A04A2F]/50 rounded-xl w-full max-w-md shadow-xl p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-nuevo-cliente-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="modal-nuevo-cliente-titulo" className="text-lg font-semibold text-[#A04A2F] mb-4">
              Nuevo cliente
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Teléfono</label>
                <input
                  value={form.telefono}
                  onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Dirección</label>
                <input
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">NIF/CIF</label>
                <input
                  value={form.nif}
                  onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Notas</label>
                <textarea
                  value={form.notas}
                  onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-400/50 bg-[#EFEADF] px-3 py-2 text-sm text-zinc-900 resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                disabled={guardando}
                onClick={() => setModalNuevo(false)}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-400/50 text-zinc-800 hover:bg-[#E5DFD0]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardando || !form.nombre.trim()}
                onClick={() => void crearCliente()}
                className="px-4 py-2 text-sm rounded-lg bg-[#A04A2F] hover:bg-[#8a3f28] text-white disabled:opacity-50"
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
