'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from '@/app/dashboard/logout-button';
import VolverAlDashboard from '@/components/ui/volver-dashboard';

type DiarioEntrada = {
  id: string;
  obra_nombre: string;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
};

export default function DiarioPage() {
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
  const [agrupado, setAgrupado] = useState<Record<string, DiarioEntrada[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

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
        const res = await fetch(`/api/diario?business_id=${encodeURIComponent(bp.id)}`, {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          agrupado_por_obra?: Record<string, DiarioEntrada[]>;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? 'No se pudo cargar el diario');
          setAgrupado({});
          return;
        }
        const raw = json.agrupado_por_obra ?? {};
        const ordenado: Record<string, DiarioEntrada[]> = {};
        for (const [nombre, entradas] of Object.entries(raw)) {
          ordenado[nombre] = [...entradas].sort(
            (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
          );
        }
        setAgrupado(ordenado);
      } catch {
        setError('Error de conexión');
        setAgrupado({});
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [router, supabase]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">
        Cargando…
      </div>
    );
  }

  const obrasOrdenadas = Object.keys(agrupado).sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-white font-bold text-xl sm:text-2xl truncate">
            {businessName}
          </Link>
          <button
            type="button"
            onClick={() => setMenuMovilAbierto((v) => !v)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors"
            aria-label="Abrir menú"
          >
            ☰
          </button>
          <div className="hidden md:flex items-center gap-4">
            <Link href="/historial" className="text-sm text-gray-200 hover:text-white transition-colors">
              Historial
            </Link>
            <Link href="/mensajes" className="text-sm text-gray-200 hover:text-white transition-colors">
              Mensajes
            </Link>
            <Link href="/presupuestos" className="text-sm text-gray-200 hover:text-white transition-colors">
              Presupuestos
            </Link>
            <Link href="/albaranes" className="text-sm text-gray-200 hover:text-white transition-colors">
              Albaranes
            </Link>
            <span className="text-sm font-medium text-[#ed8936]">Diario</span>
            <Link href="/facturas" className="text-sm text-gray-200 hover:text-white transition-colors">
              Facturas
            </Link>
            <Link
              href="/agente"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors"
            >
              ✨ Agente IA
            </Link>
            <LogoutButton />
          </div>
        </div>

        {menuMovilAbierto && (
          <div className="md:hidden max-w-7xl mx-auto px-6 pb-4">
            <div className="bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <Link
                href="/historial"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Historial
              </Link>
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
              <span className="text-sm font-medium text-[#ed8936]">Diario</span>
              <Link
                href="/facturas"
                className="text-sm text-gray-200 hover:text-white"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Facturas
              </Link>
              <Link
                href="/agente"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] border border-[#ed8936] rounded-lg"
                onClick={() => setMenuMovilAbierto(false)}
              >
                ✨ Agente IA
              </Link>
              <LogoutButton />
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-3 pb-1">
        <VolverAlDashboard />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Diario de <span className="text-[#ed8936]">obra</span>
          </h1>
          <p className="text-sm text-white/70 mt-1">
            Entradas agrupadas por obra. Desde el agente puedes registrar nuevas notas o generar el PDF.
          </p>
        </div>

        {!businessId ? (
          <p className="text-white/70 text-sm">No hay un perfil de negocio asociado.</p>
        ) : error ? (
          <p className="text-red-300 text-sm">{error}</p>
        ) : loading ? (
          <p className="text-white/60">Cargando entradas…</p>
        ) : obrasOrdenadas.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1a365d]/80 p-6 text-white/70 text-sm">
            Aún no hay entradas en el diario. Usa el agente para crear la primera.
          </div>
        ) : (
          obrasOrdenadas.map((obraNombre) => {
            const entradas = agrupado[obraNombre] ?? [];
            const direccion = entradas[0]?.obra_direccion;
            return (
              <section
                key={obraNombre}
                className="rounded-xl border border-[#1a365d] bg-[#1a365d]/50 overflow-hidden"
              >
                <div className="px-4 py-3 sm:px-5 border-b border-white/10 bg-[#0f2744] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[#ed8936]">{obraNombre}</h2>
                    {direccion ? (
                      <p className="text-sm text-white/70 mt-0.5">{direccion}</p>
                    ) : null}
                  </div>
                  <Link
                    href={`/agente?mensaje=${encodeURIComponent(
                      `genera el PDF del diario de la obra ${obraNombre}`
                    )}`}
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white transition-colors shrink-0"
                  >
                    Generar PDF
                  </Link>
                </div>
                <ul className="divide-y divide-white/10">
                  {entradas.map((e) => (
                    <li key={e.id} className="p-4 sm:p-5 space-y-3">
                      <p className="text-xs font-medium text-[#ed8936] tabular-nums">
                        {new Date(e.fecha).toLocaleString('es-ES', {
                          dateStyle: 'full',
                          timeStyle: 'short',
                        })}
                      </p>
                      {e.texto ? (
                        <p className="text-sm text-white/90 whitespace-pre-wrap">{e.texto}</p>
                      ) : (
                        <p className="text-sm text-white/50 italic">Sin texto</p>
                      )}
                      {e.fotos && e.fotos.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {e.fotos.map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={url}
                                alt=""
                                className="w-full h-36 sm:h-44 object-cover rounded-lg border border-white/10"
                              />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {e.videos && e.videos.length > 0 ? (
                        <p className="text-xs text-white/65">
                          Vídeos adjuntos: {e.videos.length} — enlaces en el almacenamiento (no se
                          reproducen aquí)
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
