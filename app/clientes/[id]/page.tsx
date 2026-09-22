'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import VolverAlDashboard from '@/components/ui/volver-dashboard';

type Cliente = {
  id: string;
  business_id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  nif: string | null;
  notas: string | null;
};

type PresRow = {
  id: string;
  estado: string | null;
  importe_total: number | null;
  fecha: string | null;
};
type FacRow = {
  id: string;
  estado: string | null;
  total: number | null;
  fecha: string | null;
  numero_factura: string | null;
};
type AlbRow = {
  id: string;
  estado: string | null;
  fecha: string | null;
  total: number | null;
  numero_albaran: string | null;
};
type DioRow = {
  id: string;
  obra_nombre: string;
  texto: string | null;
  fecha: string;
};
type GasRow = {
  id: string;
  proveedor: string;
  descripcion: string | null;
  importe: number | null;
  importe_total: number | null;
  fecha: string | null;
};

export default function ClienteFichaPage() {
  const router = useRouter();
  const params = useParams();
  const clienteId = typeof params.id === 'string' ? params.id : '';

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [authChecking, setAuthChecking] = useState(true);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [presupuestos, setPresupuestos] = useState<PresRow[]>([]);
  const [facturas, setFacturas] = useState<FacRow[]>([]);
  const [albaranes, setAlbaranes] = useState<AlbRow[]>([]);
  const [gastos, setGastos] = useState<GasRow[]>([]);
  const [diario, setDiario] = useState<DioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalEditar, setModalEditar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    nombre: '',
    telefono: '',
    email: '',
    direccion: '',
    nif: '',
    notas: '',
  });

  const cargar = useCallback(async () => {
    if (!clienteId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${encodeURIComponent(clienteId)}`, {
        credentials: 'include',
      });
      const json = (await res.json()) as {
        cliente?: Cliente;
        presupuestos?: PresRow[];
        facturas?: FacRow[];
        albaranes?: AlbRow[];
        gastos?: GasRow[];
        diario_obra?: DioRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar la ficha');
        setCliente(null);
        return;
      }
      const c = json.cliente ?? null;
      setCliente(c);
      if (c) {
        setForm({
          nombre: c.nombre,
          telefono: c.telefono ?? '',
          email: c.email ?? '',
          direccion: c.direccion ?? '',
          nif: c.nif ?? '',
          notas: c.notas ?? '',
        });
      }
      setPresupuestos(json.presupuestos ?? []);
      setFacturas(json.facturas ?? []);
      setAlbaranes(json.albaranes ?? []);
      setGastos(json.gastos ?? []);
      setDiario(json.diario_obra ?? []);
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [clienteId]);

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
    };
    void run();
  }, [router, supabase]);

  useEffect(() => {
    if (!authChecking && clienteId) void cargar();
  }, [authChecking, clienteId, cargar]);

  const guardarEdicion = async () => {
    if (!cliente?.id) return;
    const nombre = form.nombre.trim();
    if (!nombre) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/clientes', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cliente.id,
          nombre,
          telefono: form.telefono.trim() || null,
          email: form.email.trim() || null,
          direccion: form.direccion.trim() || null,
          nif: form.nif.trim() || null,
          notas: form.notas.trim() || null,
        }),
      });
      const json = (await res.json()) as { cliente?: Cliente; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo guardar');
        return;
      }
      if (json.cliente) setCliente(json.cliente);
      setModalEditar(false);
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
      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        {error ? <p className="text-red-300 text-sm">{error}</p> : null}
        {loading ? (
          <p className="text-zinc-500">Cargando ficha…</p>
        ) : !cliente ? (
          <p className="text-zinc-600">Cliente no encontrado.</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">{cliente.nombre}</h1>
                <dl className="mt-4 space-y-2 text-sm text-zinc-700">
                  <div>
                    <dt className="text-zinc-500 inline mr-2">Teléfono</dt>
                    <dd className="inline">{cliente.telefono ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 inline mr-2">Email</dt>
                    <dd className="inline">{cliente.email ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 inline mr-2">Dirección</dt>
                    <dd className="inline">{cliente.direccion ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 inline mr-2">NIF/CIF</dt>
                    <dd className="inline">{cliente.nif ?? '—'}</dd>
                  </div>
                  {cliente.notas ? (
                    <div className="pt-2">
                      <dt className="text-zinc-500 block mb-1">Notas</dt>
                      <dd className="text-zinc-800 whitespace-pre-wrap">{cliente.notas}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <button
                type="button"
                onClick={() => setModalEditar(true)}
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-[#A04A2F] text-[#A04A2F] hover:bg-[#A04A2F]/15 transition-colors"
              >
                Editar datos
              </button>
            </div>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                Presupuestos
              </h2>
              {presupuestos.length === 0 ? (
                <p className="text-zinc-500 text-sm">Sin presupuestos vinculados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-400/40">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 text-left">Estado</th>
                        <th className="px-3 py-2 text-left">Importe</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {presupuestos.map((p) => (
                        <tr key={p.id} className="border-b border-zinc-400/30">
                          <td className="px-3 py-2">{p.estado ?? '—'}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {p.importe_total != null ? `${p.importe_total} €` : '—'}
                          </td>
                          <td className="px-3 py-2">{p.fecha ?? '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/presupuestos?id=${encodeURIComponent(p.id)}`}
                              className="text-[#A04A2F] hover:text-[#A04A2F]"
                            >
                              Ver →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">Facturas</h2>
              {facturas.length === 0 ? (
                <p className="text-zinc-500 text-sm">Sin facturas vinculadas.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-400/40">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 text-left">Estado</th>
                        <th className="px-3 py-2 text-left">Importe</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturas.map((f) => (
                        <tr key={f.id} className="border-b border-zinc-400/30">
                          <td className="px-3 py-2">{f.estado ?? '—'}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {f.total != null ? `${f.total} €` : '—'}
                          </td>
                          <td className="px-3 py-2">{f.fecha ?? '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/facturas?id=${encodeURIComponent(f.id)}`}
                              className="text-[#A04A2F] hover:text-[#A04A2F]"
                            >
                              Ver →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">Albaranes</h2>
              {albaranes.length === 0 ? (
                <p className="text-zinc-500 text-sm">Sin albaranes vinculados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-400/40">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 text-left">Estado</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-right">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {albaranes.map((a) => (
                        <tr key={a.id} className="border-b border-zinc-400/30">
                          <td className="px-3 py-2">{a.estado ?? '—'}</td>
                          <td className="px-3 py-2">{a.fecha ?? '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/albaranes?id=${encodeURIComponent(a.id)}`}
                              className="text-[#A04A2F] hover:text-[#A04A2F]"
                            >
                              Ver →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                Gastos
              </h2>
              {gastos.length === 0 ? (
                <p className="text-zinc-500 text-sm">Sin gastos asociados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-400/40">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-400/40 bg-[#EFEADF]/90 text-zinc-700">
                        <th className="px-3 py-2 text-left">Proveedor</th>
                        <th className="px-3 py-2 text-left">Descripción</th>
                        <th className="px-3 py-2 text-left">Importe</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gastos.map((g) => {
                        const imp =
                          g.importe_total != null && Number.isFinite(Number(g.importe_total))
                            ? Number(g.importe_total)
                            : g.importe != null && Number.isFinite(Number(g.importe))
                              ? Number(g.importe)
                              : null;
                        return (
                          <tr key={g.id} className="border-b border-zinc-400/30">
                            <td className="px-3 py-2">{g.proveedor ?? '—'}</td>
                            <td className="px-3 py-2 text-zinc-700 max-w-[14rem] truncate" title={g.descripcion ?? undefined}>
                              {g.descripcion?.trim() ? g.descripcion : '—'}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {imp != null ? `${imp.toFixed(2)} €` : '—'}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{g.fecha ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                Diario de obra
              </h2>
              {diario.length === 0 ? (
                <p className="text-zinc-500 text-sm">Sin entradas de diario asociadas.</p>
              ) : (
                <ul className="space-y-3">
                  {diario.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-lg border border-zinc-400/40 bg-[#E5DFD0]/60 p-4 text-sm"
                    >
                      <p className="font-semibold text-[#A04A2F]">{d.obra_nombre}</p>
                      <p className="text-xs text-zinc-500 tabular-nums mt-1">
                        {new Date(d.fecha).toLocaleString('es-ES', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                      {d.texto ? (
                        <p className="text-zinc-700 mt-2 whitespace-pre-wrap">{d.texto}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {modalEditar && cliente && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
          onClick={() => !guardando && setModalEditar(false)}
          role="presentation"
        >
          <div
            className="bg-[#E5DFD0] border border-[#A04A2F]/50 rounded-xl w-full max-w-md shadow-xl p-5"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[#A04A2F] mb-4">Editar cliente</h2>
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
                onClick={() => setModalEditar(false)}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-400/50 text-zinc-800 hover:bg-[#E5DFD0]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardando || !form.nombre.trim()}
                onClick={() => void guardarEdicion()}
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
