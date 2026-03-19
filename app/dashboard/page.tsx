'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import LogoutButton from './logout-button';
import { AlertTriangle, MessageCircle, FileText, Package, ArrowRight } from 'lucide-react';

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

interface FacturaPendienteItem {
  id: string;
  cliente_nombre: string | null;
  total: number;
}

interface PresupuestoMetricaItem {
  id: string;
  cliente_nombre: string | null;
  fecha: string | null;
  importe_total: number | null;
}

export default function DashboardPage() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

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

  const [importePendienteCobro, setImportePendienteCobro] = useState(0);
  const [importeTotalPresupuestado, setImporteTotalPresupuestado] = useState(0);
  const [totalMateriales, setTotalMateriales] = useState(0);
  const [desglosePendiente, setDesglosePendiente] = useState<FacturaPendienteItem[]>([]);
  const [desglosePresupuestado, setDesglosePresupuestado] = useState<PresupuestoMetricaItem[]>([]);
  const [desgloseMateriales, setDesgloseMateriales] = useState<PresupuestoMetricaItem[]>([]);
  const [modalMetrica, setModalMetrica] = useState<'pendiente' | 'presupuestado' | 'materiales' | null>(null);
  const [gmailConectado, setGmailConectado] = useState(false);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  const conectarGmail = async () => {
    try {
      const res = await fetch('/api/auth/gmail');
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) return;
      window.location.href = data.url;
    } catch {
      // Silencioso para no alterar UX actual.
    }
  };

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
          facturasPendientesDataRes,
          presupuestosMetricasRes,
          presupuestosMaterialesRes,
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
            supabase
              .from('facturas')
              .select('id, cliente_nombre, total')
              .eq('estado', 'pendiente'),
            supabase
              .from('presupuestos')
              .select('id, cliente_nombre, fecha, importe_total'),
            supabase
              .from('presupuestos')
              .select('id, cliente_nombre, fecha, importe_total')
              .ilike('presupuesto_generado', '%material%'),
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

        if (!facturasPendientesDataRes.error && facturasPendientesDataRes.data) {
          const list = facturasPendientesDataRes.data as { id: string; cliente_nombre: string | null; total: number }[];
          setDesglosePendiente(list);
          setImportePendienteCobro(list.reduce((s, f) => s + (Number(f.total) || 0), 0));
        }
        if (!presupuestosMetricasRes.error && presupuestosMetricasRes.data) {
          const list = presupuestosMetricasRes.data as { id: string; cliente_nombre: string | null; fecha: string | null; importe_total: number | null }[];
          setDesglosePresupuestado(list);
          setImporteTotalPresupuestado(list.reduce((s, p) => s + (Number(p.importe_total) || 0), 0));
        }
        if (!presupuestosMaterialesRes.error && presupuestosMaterialesRes.data) {
          const list = presupuestosMaterialesRes.data as { id: string; cliente_nombre: string | null; fecha: string | null; importe_total: number | null }[];
          setDesgloseMateriales(list);
          setTotalMateriales(list.reduce((s, p) => s + (Number(p.importe_total) || 0), 0));
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: gmailToken } = await supabase
            .from('gmail_tokens')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
          setGmailConectado(!!gmailToken);
        } else {
          setGmailConectado(false);
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
            <Link href="/facturas" className="text-sm text-gray-200 hover:text-white transition-colors">
              Facturas
            </Link>
            <Link
              href="/agente"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors"
            >
              ✨ Agente IA
            </Link>
            {gmailConectado ? (
              <span className="inline-flex items-center px-4 py-2 text-sm font-medium text-green-300 bg-green-900/30 border border-green-500/50 rounded-lg">
                Gmail conectado ✓
              </span>
            ) : (
              <button
                type="button"
                onClick={conectarGmail}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-[#1a365d] border border-[#ed8936] rounded-lg hover:bg-[#22466f] transition-colors"
              >
                Conectar Gmail
              </button>
            )}
            <LogoutButton />
          </div>
        </div>

        {menuMovilAbierto && (
          <div className="md:hidden max-w-7xl mx-auto px-6 pb-4">
            <div className="bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
              <Link
                href="/historial"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Historial
              </Link>
              <Link
                href="/mensajes"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Mensajes
              </Link>
              <Link
                href="/presupuestos"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Presupuestos
              </Link>
              <Link
                href="/albaranes"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Albaranes
              </Link>
              <Link
                href="/facturas"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Facturas
              </Link>
              <Link
                href="/agente"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                ✨ Agente IA
              </Link>
              {gmailConectado ? (
                <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-green-300 bg-green-900/30 border border-green-500/50 rounded-lg">
                  Gmail conectado ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={conectarGmail}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-[#1a365d] border border-[#ed8936] rounded-lg hover:bg-[#22466f] transition-colors"
                >
                  Conectar Gmail
                </button>
              )}
              <div className="pt-1">
                <LogoutButton />
              </div>
            </div>
          </div>
        )}
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
            Métricas económicas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setModalMetrica('pendiente')}
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1e3a5f] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  💰 Importe pendiente de cobro
                </span>
              </div>
              <div className="text-2xl font-bold text-[#ed8936]">
                {loading ? '—' : `${importePendienteCobro.toFixed(2)} €`}
              </div>
              <span className="text-xs text-white/60">Clic para ver desglose por factura</span>
            </button>
            <button
              type="button"
              onClick={() => setModalMetrica('presupuestado')}
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1e3a5f] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  📄 Importe total presupuestado
                </span>
              </div>
              <div className="text-2xl font-bold text-[#ed8936]">
                {loading ? '—' : `${importeTotalPresupuestado.toFixed(2)} €`}
              </div>
              <span className="text-xs text-white/60">Clic para ver desglose por presupuesto</span>
            </button>
            <button
              type="button"
              onClick={() => setModalMetrica('materiales')}
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl p-4 flex flex-col gap-2 hover:bg-[#1e3a5f] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  🧱 Total materiales
                </span>
              </div>
              <div className="text-2xl font-bold text-[#ed8936]">
                {loading ? '—' : `${totalMateriales.toFixed(2)} €`}
              </div>
              <span className="text-xs text-white/60">Clic para ver desglose</span>
            </button>
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

        {modalMetrica && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setModalMetrica(null)}
          >
            <div
              className="bg-[#1a365d] border border-[#ed8936]/50 rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-semibold text-[#fed7aa]">
                  {modalMetrica === 'pendiente' && 'Importe pendiente de cobro'}
                  {modalMetrica === 'presupuestado' && 'Importe total presupuestado'}
                  {modalMetrica === 'materiales' && 'Total materiales'}
                </h3>
                <button
                  type="button"
                  onClick={() => setModalMetrica(null)}
                  className="text-white/70 hover:text-white text-2xl leading-none"
                >
                  ×
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                {modalMetrica === 'pendiente' && (
                  <ul className="space-y-3 text-sm">
                    {desglosePendiente.length === 0 ? (
                      <li className="text-white/60">No hay facturas pendientes.</li>
                    ) : (
                      desglosePendiente.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 last:border-b-0"
                        >
                          <span className="font-medium">{f.cliente_nombre ?? 'Sin nombre'}</span>
                          <span className="text-[#ed8936] font-semibold">{Number(f.total).toFixed(2)} €</span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
                {modalMetrica === 'presupuestado' && (
                  <ul className="space-y-3 text-sm">
                    {desglosePresupuestado.length === 0 ? (
                      <li className="text-white/60">No hay presupuestos con importe.</li>
                    ) : (
                      desglosePresupuestado.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 last:border-b-0"
                        >
                          <div>
                            <p className="font-medium">{p.cliente_nombre ?? '—'}</p>
                            <p className="text-white/60 text-xs">{p.fecha ?? '—'}</p>
                          </div>
                          <span className="text-[#ed8936] font-semibold">
                            {(p.importe_total != null ? Number(p.importe_total) : 0).toFixed(2)} €
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
                {modalMetrica === 'materiales' && (
                  <ul className="space-y-3 text-sm">
                    {desgloseMateriales.length === 0 ? (
                      <li className="text-white/60">No hay presupuestos de materiales.</li>
                    ) : (
                      desgloseMateriales.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 last:border-b-0"
                        >
                          <div>
                            <p className="font-medium">{p.cliente_nombre ?? '—'}</p>
                            <p className="text-white/60 text-xs">{p.fecha ?? '—'}</p>
                          </div>
                          <span className="text-[#ed8936] font-semibold">
                            {(p.importe_total != null ? Number(p.importe_total) : 0).toFixed(2)} €
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
