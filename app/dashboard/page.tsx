'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import LogoutButton from './logout-button';
import { AlertTriangle, MessageCircle, FileText, Package, ArrowRight } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ResumenCounts {
  urgentes: number;
  pendientes: number;
  presupuestos: number;
  albaranesPendientes: number;
  facturasPendientes: number;
}

interface PresupuestoResumen {
  id: string;
  fecha: string | null;
  estado: string | null;
  created_at: string;
}

interface MensajeResumen {
  id: string;
  customer_name: string | null;
  created_at: string;
}

export default function DashboardPage() {
  const [businessName, setBusinessName] = useState('tu negocio');
  const [counts, setCounts] = useState<ResumenCounts>({
    urgentes: 0,
    pendientes: 0,
    presupuestos: 0,
    albaranesPendientes: 0,
    facturasPendientes: 0,
  });
  const [ultimosPresupuestos, setUltimosPresupuestos] = useState<PresupuestoResumen[]>([]);
  const [ultimosMensajes, setUltimosMensajes] = useState<MensajeResumen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [
          bizRes,
          urgentesRes,
          pendientesRes,
          presupuestosRes,
          albaranesRes,
          facturasRes,
          presListRes,
          msgListRes,
        ] =
          await Promise.all([
            supabase.from('business_profiles').select('nombre').limit(1).single(),
            supabase
              .from('conversations')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'pending')
              .eq('priority', 'urgent'),
            supabase
              .from('conversations')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'pending'),
            supabase.from('presupuestos').select('id', { count: 'exact', head: true }),
            supabase
              .from('albaranes')
              .select('id', { count: 'exact', head: true })
              .eq('estado', 'pendiente'),
            supabase
              .from('facturas')
              .select('id', { count: 'exact', head: true })
              .eq('estado', 'pendiente'),
            supabase
              .from('presupuestos')
              .select('id, fecha, estado, created_at')
              .order('created_at', { ascending: false })
              .limit(3),
            supabase
              .from('conversations')
              .select('id, customer_name, created_at')
              .eq('status', 'pending')
              .order('created_at', { ascending: false })
              .limit(3),
          ]);

        if (!bizRes.error && bizRes.data?.nombre) {
          setBusinessName(bizRes.data.nombre);
        }

        setCounts({
          urgentes: urgentesRes.count ?? 0,
          pendientes: pendientesRes.count ?? 0,
          presupuestos: presupuestosRes.count ?? 0,
          albaranesPendientes: albaranesRes.count ?? 0,
          facturasPendientes: facturasRes.count ?? 0,
        });

        if (!presListRes.error && presListRes.data) {
          setUltimosPresupuestos(presListRes.data as PresupuestoResumen[]);
        }
        if (!msgListRes.error && msgListRes.data) {
          setUltimosMensajes(msgListRes.data as MensajeResumen[]);
        }
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  const hora = new Date().getHours();
  const saludo = hora < 14 ? 'Buenos días' : 'Buenas tardes';

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-3">
            <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 16px)',
                    gridTemplateRows: 'repeat(2, 16px)',
                    gap: '2px',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ background: '#888' }}></div>
                  <div style={{ background: '#1a6ec7' }}></div>
                  <div style={{ background: '#888' }}></div>
                  <div style={{ background: '#1a6ec7' }}></div>
                  <div style={{ background: '#888' }}></div>
                  <div style={{ background: '#1a6ec7' }}></div>
                </div>
                <span
                  style={{
                    color: '#1a6ec7',
                    fontWeight: 'bold',
                    fontSize: '34px',
                    lineHeight: '34px',
                    letterSpacing: '0px',
                    padding: '0',
                    margin: '0',
                  }}
                >
                  PINO
                </span>
              </div>
              <span
                style={{
                  color: '#888',
                  fontSize: '9.5px',
                  letterSpacing: '8.2px',
                  marginTop: '1px',
                }}
              >
                ALBAÑILERÍA
              </span>
            </div>
          </a>

          <div className="flex items-center gap-4">
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
      </div>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <section className="flex flex-col gap-2">
          <h1 className="text-3xl sm:text-4xl font-bold">
            {saludo}, <span className="text-[#ed8936]">{businessName}</span>
          </h1>
          <p className="text-white/70">Aquí tienes el resumen de tu negocio</p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wide">
            Resumen de hoy
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <div className="bg-[#111827] border border-red-500/40 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-300 uppercase tracking-wide">
                  Mensajes urgentes pendientes
                </span>
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-3xl font-bold">{counts.urgentes}</div>
              <Link
                href="/mensajes"
                className="inline-flex items-center text-xs text-red-300 hover:text-red-100 mt-1"
              >
                Ver urgentes
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-yellow-500/40 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-yellow-200 uppercase tracking-wide">
                  Mensajes pendientes
                </span>
                <MessageCircle className="w-5 h-5 text-yellow-300" />
              </div>
              <div className="text-3xl font-bold">{counts.pendientes}</div>
              <Link
                href="/mensajes"
                className="inline-flex items-center text-xs text-yellow-200 hover:text-yellow-50 mt-1"
              >
                Ir a bandeja
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-[#ed8936]/50 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  Presupuestos generados
                </span>
                <FileText className="w-5 h-5 text-[#ed8936]" />
              </div>
              <div className="text-3xl font-bold">{counts.presupuestos}</div>
              <Link
                href="/presupuestos"
                className="inline-flex items-center text-xs text-[#fed7aa] hover:text-white mt-1"
              >
                Ver presupuestos
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-blue-500/40 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-200 uppercase tracking-wide">
                  Albaranes pendientes
                </span>
                <Package className="w-5 h-5 text-blue-300" />
              </div>
              <div className="text-3xl font-bold">{counts.albaranesPendientes}</div>
              <Link
                href="/albaranes"
                className="inline-flex items-center text-xs text-blue-200 hover:text-blue-50 mt-1"
              >
                Ver albaranes
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-emerald-500/40 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-200 uppercase tracking-wide">
                  Facturas pendientes de cobro
                </span>
              </div>
              <div className="text-3xl font-bold">{counts.facturasPendientes}</div>
              <Link
                href="/facturas"
                className="inline-flex items-center text-xs text-emerald-200 hover:text-emerald-50 mt-1"
              >
                Ver facturas
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wide">
            Accesos directos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link
              href="/agente"
              className="group bg-[#111827] border border-[#ed8936]/60 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1f2937] transition-colors"
            >
              <span className="text-2xl mb-1">✨</span>
              <span className="font-semibold">Agente IA</span>
              <span className="text-sm text-white/70">Habla con tu asistente inteligente</span>
            </Link>
            <Link
              href="/mensajes"
              className="group bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1f2937] transition-colors"
            >
              <span className="text-2xl mb-1">📋</span>
              <span className="font-semibold">Mensajes</span>
              <span className="text-sm text-white/70">Revisa y aprueba respuestas</span>
            </Link>
            <Link
              href="/presupuestos"
              className="group bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1f2937] transition-colors"
            >
              <span className="text-2xl mb-1">📄</span>
              <span className="font-semibold">Presupuestos</span>
              <span className="text-sm text-white/70">Consulta y exporta tus presupuestos</span>
            </Link>
            <Link
              href="/albaranes"
              className="group bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1f2937] transition-colors"
            >
              <span className="text-2xl mb-1">📦</span>
              <span className="font-semibold">Albaranes</span>
              <span className="text-sm text-white/70">Seguimiento de entregas y facturación</span>
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#111827] border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                Últimos presupuestos
              </h2>
            </div>
            {loading ? (
              <p className="text-white/60 text-sm">Cargando...</p>
            ) : ultimosPresupuestos.length === 0 ? (
              <p className="text-white/60 text-sm">Aún no hay presupuestos generados.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {ultimosPresupuestos.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">
                        {p.fecha ?? new Date(p.created_at).toLocaleDateString('es-ES')}
                      </p>
                      <p className="text-white/60 text-xs">
                        Estado: {(p.estado ?? 'borrador').toString()}
                      </p>
                    </div>
                    <Link
                      href="/presupuestos"
                      className="inline-flex items-center text-xs text-[#ed8936] hover:text-[#f6ad55]"
                    >
                      Ver
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-[#111827] border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                Últimos mensajes pendientes
              </h2>
            </div>
            {loading ? (
              <p className="text-white/60 text-sm">Cargando...</p>
            ) : ultimosMensajes.length === 0 ? (
              <p className="text-white/60 text-sm">Sin mensajes pendientes. Todo al día.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {ultimosMensajes.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{m.customer_name ?? 'Cliente sin nombre'}</p>
                      <p className="text-white/60 text-xs">
                        {new Date(m.created_at).toLocaleString('es-ES')}
                      </p>
                    </div>
                    <Link
                      href="/mensajes"
                      className="inline-flex items-center text-xs text-[#ed8936] hover:text-[#f6ad55]"
                    >
                      Abrir
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
