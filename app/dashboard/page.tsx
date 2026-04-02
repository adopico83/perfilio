'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LogoutButton from './logout-button';
import {
  AlertTriangle,
  FileText,
  Package,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEmailModal } from '@/contexts/email-modal-context';
import { useObraModal } from '@/contexts/obra-modal-context';
import ToggleAgenteNavButton from '@/components/dashboard/toggle-agente-nav-button';

interface ResumenCounts {
  urgentes: number;
  presupuestos: number;
  albaranesPendientes: number;
  facturasPendientes: number;
}

interface EmailReciente {
  remitente: string | null;
  asunto: string | null;
  fechaIso: string | null;
  noLeido: boolean;
  cuerpo?: string | null;
  motivoUrgencia?: string[];
}

interface PresupuestoResumen {
  id: string;
  fecha: string | null;
  estado: string | null;
  created_at: string;
}

interface AgendaItem {
  id: string;
  titulo: string;
  fecha: string;
  hora: string | null;
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

interface DiarioEntradaWidget {
  id: string;
  obra_nombre: string;
  fecha: string;
  texto: string | null;
}

interface ObraActivaWidget {
  id: string;
  nombre: string;
  cliente_nombre: string | null;
  direccion: string | null;
  estado: string | null;
  fecha_inicio: string | null;
  num_documentos: number;
}

function estadoObraBadgeClass(estado: string | null | undefined): { label: string; className: string } {
  const s = (estado ?? 'abierta').toLowerCase();
  if (s === 'en_curso') return { label: 'En curso', className: 'bg-blue-500/20 text-blue-200 border border-blue-500/35' };
  if (s === 'cerrada') return { label: 'Cerrada', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' };
  if (s === 'pausada') return { label: 'Pausada', className: 'bg-amber-500/15 text-amber-200 border border-amber-500/30' };
  return { label: 'Abierta', className: 'bg-[#ed8936]/20 text-[#f6ad55] border border-[#ed8936]/40' };
}

interface UltimoClienteWidget {
  id: string;
  nombre: string;
  num_documentos: number;
}

const URGENTES_CACHE_KEY = 'perfilio_urgentes_cache';
const URGENTES_CACHE_MS = 15 * 60 * 1000;

type UrgentesCacheStored = {
  t: number;
  total: number;
  urgentes: EmailReciente[];
  normales: EmailReciente[];
};

function readUrgentesCache(): UrgentesCacheStored | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(URGENTES_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<UrgentesCacheStored>;
    if (
      typeof p.t !== 'number' ||
      typeof p.total !== 'number' ||
      !Array.isArray(p.urgentes) ||
      !Array.isArray(p.normales)
    ) {
      return null;
    }
    return {
      t: p.t,
      total: p.total,
      urgentes: p.urgentes as EmailReciente[],
      normales: p.normales as EmailReciente[],
    };
  } catch {
    return null;
  }
}

function writeUrgentesCache(
  total: number,
  urgentes: EmailReciente[],
  normales: EmailReciente[]
) {
  if (typeof window === 'undefined') return;
  try {
    const payload: UrgentesCacheStored = {
      t: Date.now(),
      total,
      urgentes,
      normales,
    };
    window.localStorage.setItem(URGENTES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const DIAS_SEMANA_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function formatEmailFecha(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function extractoDiario(texto: string | null, max = 80) {
  if (!texto) return '—';
  const t = texto.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Conteo de documentos desde GET /api/obras: prioriza total_documentos; si no viene, suma por tipo. */
function documentosDesdeObraApi(o: {
  total_documentos?: number;
  num_presupuestos?: number;
  num_facturas?: number;
  num_albaranes?: number;
  num_entradas_diario?: number;
}): number {
  if (typeof o.total_documentos === 'number') return o.total_documentos;
  return (
    (o.num_presupuestos ?? 0) +
    (o.num_facturas ?? 0) +
    (o.num_albaranes ?? 0) +
    (o.num_entradas_diario ?? 0)
  );
}

function getSaludo() {
  const hora = new Date().getHours();
  if (hora >= 6 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function construirCeldasMes(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const celdas: Array<{ dia: number | null; fechaStr: string | null }> = [];
  for (let i = 0; i < startOffset; i++) {
    celdas.push({ dia: null, fechaStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const fechaStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    celdas.push({ dia: d, fechaStr });
  }
  while (celdas.length % 7 !== 0) {
    celdas.push({ dia: null, fechaStr: null });
  }
  return celdas;
}

export default function DashboardPage() {
  const { abrirEmail, abrirUrgentes } = useEmailModal();
  const { abrirObra } = useObraModal();
  const router = useRouter();
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
    presupuestos: 0,
    albaranesPendientes: 0,
    facturasPendientes: 0,
  });
  const [ultimosPresupuestos, setUltimosPresupuestos] = useState<PresupuestoResumen[]>([]);
  const [agendaEventos, setAgendaEventos] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [importePendienteCobro, setImportePendienteCobro] = useState(0);
  const [importeTotalPresupuestado, setImporteTotalPresupuestado] = useState(0);
  const [totalMateriales, setTotalMateriales] = useState(0);
  const [desglosePendiente, setDesglosePendiente] = useState<FacturaPendienteItem[]>([]);
  const [desglosePresupuestado, setDesglosePresupuestado] = useState<PresupuestoMetricaItem[]>([]);
  const [desgloseMateriales, setDesgloseMateriales] = useState<PresupuestoMetricaItem[]>([]);
  const [modalMetrica, setModalMetrica] = useState<'pendiente' | 'presupuestado' | 'materiales' | null>(null);
  const [gmailConectado, setGmailConectado] = useState(false);
  const [gmailAccionLoading, setGmailAccionLoading] = useState(false);
  const [emailsRecientes, setEmailsRecientes] = useState<EmailReciente[]>([]);
  const [emailsUrgentes, setEmailsUrgentes] = useState<EmailReciente[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [ultimasEntradasDiario, setUltimasEntradasDiario] = useState<DiarioEntradaWidget[]>([]);
  const [ultimosClientes, setUltimosClientes] = useState<UltimoClienteWidget[]>([]);
  const [obrasActivas, setObrasActivas] = useState<ObraActivaWidget[]>([]);

  const [modalAgendaAbierto, setModalAgendaAbierto] = useState(false);
  const [mesCalendario, setMesCalendario] = useState(() => new Date());
  const [diaDetalleFecha, setDiaDetalleFecha] = useState<string | null>(null);
  const [agendaEditandoId, setAgendaEditandoId] = useState<string | null>(null);
  const [draftTitulo, setDraftTitulo] = useState('');
  const [draftHora, setDraftHora] = useState('');
  const [agendaAccionLoading, setAgendaAccionLoading] = useState(false);

  const eventosPorFecha = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const ev of agendaEventos) {
      const key = (ev.fecha ?? '').slice(0, 10);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''));
    }
    return map;
  }, [agendaEventos]);

  const abrirModalAgenda = () => {
    setMesCalendario(new Date());
    setDiaDetalleFecha(null);
    setAgendaEditandoId(null);
    setDraftTitulo('');
    setDraftHora('');
    setModalAgendaAbierto(true);
  };

  const cerrarModalAgenda = () => {
    setModalAgendaAbierto(false);
    setDiaDetalleFecha(null);
    setAgendaEditandoId(null);
    setDraftTitulo('');
    setDraftHora('');
  };

  const iniciarEdicionAgenda = (ev: AgendaItem) => {
    setAgendaEditandoId(ev.id);
    setDraftTitulo(ev.titulo);
    setDraftHora(ev.hora ?? '');
  };

  const cancelarEdicionAgenda = () => {
    setAgendaEditandoId(null);
    setDraftTitulo('');
    setDraftHora('');
  };

  const guardarEdicionAgenda = async () => {
    if (!agendaEditandoId || agendaAccionLoading) return;
    const titulo = draftTitulo.trim();
    if (!titulo) return;
    try {
      setAgendaAccionLoading(true);
      const horaVal = draftHora.trim();
      const { error } = await supabase
        .from('agenda')
        .update({
          titulo,
          hora: horaVal.length > 0 ? horaVal : null,
        })
        .eq('id', agendaEditandoId);

      if (error) return;

      setAgendaEventos((prev) =>
        prev.map((e) =>
          e.id === agendaEditandoId
            ? { ...e, titulo, hora: horaVal.length > 0 ? horaVal : null }
            : e
        )
      );
      cancelarEdicionAgenda();
    } finally {
      setAgendaAccionLoading(false);
    }
  };

  const eliminarEventoAgenda = async (ev: AgendaItem) => {
    if (agendaAccionLoading) return;
    if (!window.confirm('¿Eliminar este evento?')) return;
    try {
      setAgendaAccionLoading(true);
      const { error } = await supabase.from('agenda').delete().eq('id', ev.id);
      if (error) return;

      const fechaKey = (ev.fecha ?? '').slice(0, 10);
      setAgendaEventos((prev) => {
        const next = prev.filter((e) => e.id !== ev.id);
        if (diaDetalleFecha === fechaKey) {
          const quedanEseDia = next.filter((e) => (e.fecha ?? '').slice(0, 10) === fechaKey);
          if (quedanEseDia.length === 0) {
            queueMicrotask(() => setDiaDetalleFecha(null));
          }
        }
        return next;
      });
      if (agendaEditandoId === ev.id) cancelarEdicionAgenda();
    } finally {
      setAgendaAccionLoading(false);
    }
  };

  const celdasCalendario = useMemo(() => {
    const y = mesCalendario.getFullYear();
    const m = mesCalendario.getMonth();
    return construirCeldasMes(y, m);
  }, [mesCalendario]);

  const fechaHoyIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const conectarGmail = async () => {
    if (gmailAccionLoading) return;
    try {
      setGmailAccionLoading(true);
      const res = await fetch('/api/auth/gmail');
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) return;
      window.location.href = data.url;
    } catch {
      // Silencioso para no alterar UX actual.
    } finally {
      setGmailAccionLoading(false);
    }
  };

  const desconectarGmail = async () => {
    if (gmailAccionLoading) return;
    try {
      setGmailAccionLoading(true);
      const res = await fetch('/api/auth/gmail/disconnect', { method: 'POST' });
      if (res.ok) {
        setGmailConectado(false);
      }
    } catch {
      // Silencioso.
    } finally {
      setGmailAccionLoading(false);
    }
  };

  const loadAgenda = useCallback(async (businessIdOrEvent?: string | Event) => {
    try {
      let bid: string | undefined =
        typeof businessIdOrEvent === 'string' ? businessIdOrEvent : undefined;
      if (!bid) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;
        if (!userId) {
          setAgendaEventos([]);
          return;
        }
        const bizRes = await supabase
          .from('business_profiles')
          .select('id')
          .eq('user_id', userId)
          .limit(1)
          .single();
        bid = bizRes.data?.id;
      }
      if (!bid) {
        setAgendaEventos([]);
        return;
      }

      // Filtrar "próximos" incluyendo hoy mismo. Usamos ISO (UTC) para evitar
      // desajustes por zona horaria al formatear YYYY-MM-DD.
      const hoyStr = new Date().toISOString().slice(0, 10);

      console.log('businessId para agenda:', bid);
      const agendaRes = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('business_id', bid)
        .eq('completado', false)
        .gte('fecha', hoyStr)
        .order('fecha', { ascending: true })
        .limit(4);

      const { data, error } = agendaRes;
      console.log('Agenda:', data, error);

      if (!agendaRes.error && agendaRes.data) {
        setAgendaEventos(agendaRes.data as AgendaItem[]);
      }
    } catch {
      // Silencioso: la agenda es opcional en refresco parcial.
    }
  }, [supabase]);

  useEffect(() => {
    window.addEventListener('agenda-actualizada', loadAgenda);
    return () => window.removeEventListener('agenda-actualizada', loadAgenda);
  }, [loadAgenda]);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;

        if (!userId) {
          setGmailConectado(false);
          return;
        }

        const bizRes = await supabase
          .from('business_profiles')
          .select('id, nombre')
          .eq('user_id', userId)
          .limit(1)
          .single();

        const businessId = bizRes.data?.id;

        if (!bizRes.error && bizRes.data?.nombre) {
          setBusinessName(bizRes.data.nombre);
        }

        if (!businessId) {
          setCounts({
            urgentes: 0,
            presupuestos: 0,
            albaranesPendientes: 0,
            facturasPendientes: 0,
          });
          setUltimosPresupuestos([]);
          setAgendaEventos([]);
          setDesglosePendiente([]);
          setDesglosePresupuestado([]);
          setDesgloseMateriales([]);
          setImportePendienteCobro(0);
          setImporteTotalPresupuestado(0);
          setTotalMateriales(0);
          setUltimasEntradasDiario([]);
          setUltimosClientes([]);
          setObrasActivas([]);
          setEmailsUrgentes([]);

          const { data: gmailToken } = await supabase
            .from('gmail_tokens')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle();
          setGmailConectado(!!gmailToken);
          return;
        }

        const [
          presupuestosRes,
          albaranesRes,
          facturasRes,
          presListRes,
          _agendaCargada,
          facturasPendientesDataRes,
          presupuestosMetricasRes,
          presupuestosMaterialesRes,
        ] = await Promise.all([
          supabase
            .from('presupuestos')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId),
          supabase
            .from('albaranes')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('estado', 'pendiente'),
          supabase
            .from('facturas')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('estado', 'pendiente'),
          supabase
            .from('presupuestos')
            .select('id, fecha, estado, created_at')
            .eq('business_id', businessId)
            .order('created_at', { ascending: false })
            .limit(5),
          loadAgenda(businessId),
          supabase
            .from('facturas')
            .select('id, cliente_nombre, total')
            .eq('business_id', businessId)
            .eq('estado', 'pendiente'),
          supabase
            .from('presupuestos')
            .select('id, cliente_nombre, fecha, importe_total')
            .eq('business_id', businessId),
          supabase
            .from('presupuestos')
            .select('id, cliente_nombre, fecha, importe_total')
            .eq('business_id', businessId)
            .ilike('presupuesto_generado', '%material%'),
        ]);

        setCounts({
          urgentes: 0,
          presupuestos: presupuestosRes.count ?? 0,
          albaranesPendientes: albaranesRes.count ?? 0,
          facturasPendientes: facturasRes.count ?? 0,
        });

        if (!presListRes.error && presListRes.data) {
          setUltimosPresupuestos(presListRes.data as PresupuestoResumen[]);
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

        try {
          const diarioRes = await fetch(
            `/api/diario?business_id=${encodeURIComponent(businessId)}`,
            { credentials: 'include' }
          );
          if (diarioRes.ok) {
            const dj = (await diarioRes.json()) as {
              agrupado_por_obra?: Record<string, DiarioEntradaWidget[]>;
            };
            const grouped = dj.agrupado_por_obra ?? {};
            const flat = Object.values(grouped).flat() as DiarioEntradaWidget[];
            flat.sort(
              (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
            );
            setUltimasEntradasDiario(flat.slice(0, 3));
          } else {
            setUltimasEntradasDiario([]);
          }
        } catch {
          setUltimasEntradasDiario([]);
        }

        try {
          const obrasRes = await fetch(
            `/api/obras?business_id=${encodeURIComponent(businessId)}`,
            { credentials: 'include' }
          );
          if (!obrasRes.ok) {
            setObrasActivas([]);
          } else {
            const json = (await obrasRes.json()) as {
              obras?: Array<{
                id: string;
                nombre: string;
                cliente_nombre: string | null;
                direccion: string | null;
                estado: string | null;
                fecha_inicio: string | null;
                created_at: string;
                total_documentos?: number;
                num_presupuestos?: number;
                num_facturas?: number;
                num_albaranes?: number;
                num_entradas_diario?: number;
              }>;
            };
            const activas = (json.obras ?? []).filter((o) =>
              ['abierta', 'en_curso'].includes((o.estado ?? '').toLowerCase())
            );
            activas.sort(
              (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            const top = activas.slice(0, 5);
            setObrasActivas(
              top.map((o) => ({
                id: o.id,
                nombre: o.nombre,
                cliente_nombre: o.cliente_nombre ?? null,
                direccion: o.direccion ?? null,
                estado: o.estado ?? null,
                fecha_inicio: o.fecha_inicio ?? null,
                num_documentos: documentosDesdeObraApi(o),
              }))
            );
          }
        } catch {
          setObrasActivas([]);
        }

        try {
          const { data: ucRows } = await supabase
            .from('clientes')
            .select('id, nombre, created_at')
            .eq('business_id', businessId)
            .order('created_at', { ascending: false })
            .limit(3);
          const uc = (ucRows ?? []) as { id: string; nombre: string }[];
          const uids = uc.map((c) => c.id);
          if (uids.length === 0) {
            setUltimosClientes([]);
          } else {
            const [pR, fR, aR] = await Promise.all([
              supabase
                .from('presupuestos')
                .select('cliente_id')
                .eq('business_id', businessId)
                .in('cliente_id', uids),
              supabase
                .from('facturas')
                .select('cliente_id')
                .eq('business_id', businessId)
                .in('cliente_id', uids),
              supabase
                .from('albaranes')
                .select('cliente_id')
                .eq('business_id', businessId)
                .in('cliente_id', uids),
            ]);
            const bump = (rows: { cliente_id: string | null }[] | null) => {
              const m = new Map<string, number>();
              for (const id of uids) m.set(id, 0);
              for (const r of rows ?? []) {
                const cid = r.cliente_id;
                if (!cid) continue;
                m.set(cid, (m.get(cid) ?? 0) + 1);
              }
              return m;
            };
            const mp = bump(pR.data as { cliente_id: string | null }[] | null);
            const mf = bump(fR.data as { cliente_id: string | null }[] | null);
            const ma = bump(aR.data as { cliente_id: string | null }[] | null);
            setUltimosClientes(
              uc.map((c) => ({
                id: c.id,
                nombre: c.nombre,
                num_documentos:
                  (mp.get(c.id) ?? 0) + (mf.get(c.id) ?? 0) + (ma.get(c.id) ?? 0),
              }))
            );
          }
        } catch {
          setUltimosClientes([]);
        }

        const { data: gmailToken } = await supabase
          .from('gmail_tokens')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();
        setGmailConectado(!!gmailToken);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [loadAgenda, supabase]);

  useEffect(() => {
    if (loading) return;
    if (!gmailConectado) {
      setEmailsRecientes([]);
      setEmailsUrgentes([]);
      setCounts((prev) => ({ ...prev, urgentes: 0 }));
      setEmailsError(null);
      setEmailsLoading(false);
      return;
    }

    let cancelled = false;
    setEmailsLoading(true);
    setEmailsError(null);

    const applyCache = (c: UrgentesCacheStored) => {
      setCounts((prev) => ({ ...prev, urgentes: c.total }));
      setEmailsUrgentes(c.urgentes);
      setEmailsRecientes([...c.urgentes, ...c.normales].slice(0, 4));
    };

    const cached = readUrgentesCache();
    if (cached && Date.now() - cached.t < URGENTES_CACHE_MS) {
      applyCache(cached);
    }

    const restoreFromCacheIfAny = (): boolean => {
      const c = readUrgentesCache();
      if (!c) return false;
      applyCache(c);
      return true;
    };

    void (async () => {
      try {
        const res = await fetch('/api/gmail/urgentes');
        let data: {
          urgentes?: EmailReciente[];
          normales?: EmailReciente[];
          total_urgentes?: number;
          error?: string | null;
        };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          if (cancelled) return;
          setEmailsError('No se pudieron cargar los emails.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
            setEmailsUrgentes([]);
            setCounts((prev) => ({ ...prev, urgentes: 0 }));
          }
          return;
        }
        if (cancelled) return;
        if (!res.ok) {
          setEmailsError('No se pudieron cargar los emails.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
            setEmailsUrgentes([]);
            setCounts((prev) => ({ ...prev, urgentes: 0 }));
          }
          return;
        }
        if (data.error === 'gmail_not_connected') {
          setEmailsError('Gmail no está disponible. Conecta de nuevo desde el menú superior.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
          }
          return;
        }
        if (data.error === 'gmail_fetch_failed') {
          setEmailsError('No se pudo acceder a Gmail. Inténtalo de nuevo más tarde.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
          }
          return;
        }
        if (data.error) {
          setEmailsError('No se pudieron cargar los emails.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
            setEmailsUrgentes([]);
            setCounts((prev) => ({ ...prev, urgentes: 0 }));
          }
          return;
        }
        const urgentes = Array.isArray(data.urgentes) ? data.urgentes : [];
        const normales = Array.isArray(data.normales) ? data.normales : [];
        const totalUrg =
          typeof data.total_urgentes === 'number' ? data.total_urgentes : urgentes.length;
        setEmailsUrgentes(urgentes);
        setCounts((prev) => ({ ...prev, urgentes: totalUrg }));
        const merged = [...urgentes, ...normales];
        setEmailsRecientes(merged.slice(0, 4));
        writeUrgentesCache(totalUrg, urgentes, normales);
      } catch {
        if (!cancelled) {
          setEmailsError('Error de conexión al cargar emails.');
          if (!restoreFromCacheIfAny()) {
            setEmailsRecientes([]);
            setEmailsUrgentes([]);
            setCounts((prev) => ({ ...prev, urgentes: 0 }));
          }
        }
      } finally {
        if (!cancelled) setEmailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, gmailConectado]);

  const saludo = getSaludo();

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-3 min-w-0">
            {businessName === 'Pino Albañilería' ? (
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
            ) : (
              <span className="text-white font-bold text-2xl sm:text-3xl truncate max-w-[min(100vw-8rem,28rem)]">
                {businessName}
              </span>
            )}
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
            <Link href="/diario" className="text-sm text-gray-200 hover:text-white transition-colors">
              Diario
            </Link>
            <Link href="/obras" className="text-sm text-gray-200 hover:text-white transition-colors">
              Obras
            </Link>
            <Link href="/clientes" className="text-sm text-gray-200 hover:text-white transition-colors">
              Clientes
            </Link>
            <Link href="/facturas" className="text-sm text-gray-200 hover:text-white transition-colors">
              Facturas
            </Link>
            <ToggleAgenteNavButton className="inline-flex items-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors" />
            {gmailConectado ? (
              <button
                type="button"
                onClick={desconectarGmail}
                disabled={gmailAccionLoading}
                title="Pulsa para desconectar Gmail"
                aria-label="Gmail conectado. Pulsa para desconectar"
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-green-200 bg-green-900/40 border border-green-500/60 rounded-lg hover:bg-green-900/55 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {gmailAccionLoading ? '…' : 'Gmail conectado ✓'}
              </button>
            ) : (
              <button
                type="button"
                onClick={conectarGmail}
                disabled={gmailAccionLoading}
                title="Conectar cuenta de Gmail"
                aria-label="Conectar Gmail"
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-100 bg-gray-800/80 border border-red-500/45 rounded-lg hover:bg-gray-800 hover:border-red-400/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {gmailAccionLoading ? '…' : 'Conectar Gmail'}
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
                href="/diario"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Diario
              </Link>
              <Link
                href="/obras"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Obras
              </Link>
              <Link
                href="/clientes"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Clientes
              </Link>
              <Link
                href="/facturas"
                className="text-sm text-gray-200 hover:text-white transition-colors"
                onClick={() => setMenuMovilAbierto(false)}
              >
                Facturas
              </Link>
              <div onClick={() => setMenuMovilAbierto(false)}>
                <ToggleAgenteNavButton className="w-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors" />
              </div>
              {gmailConectado ? (
                <button
                  type="button"
                  onClick={() => {
                    void desconectarGmail();
                    setMenuMovilAbierto(false);
                  }}
                  disabled={gmailAccionLoading}
                  title="Pulsa para desconectar Gmail"
                  aria-label="Gmail conectado. Pulsa para desconectar"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-green-200 bg-green-900/40 border border-green-500/60 rounded-lg hover:bg-green-900/55 transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full"
                >
                  {gmailAccionLoading ? '…' : 'Gmail conectado ✓'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void conectarGmail();
                    setMenuMovilAbierto(false);
                  }}
                  disabled={gmailAccionLoading}
                  title="Conectar cuenta de Gmail"
                  aria-label="Conectar Gmail"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-red-100 bg-gray-800/80 border border-red-500/45 rounded-lg hover:bg-gray-800 hover:border-red-400/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full"
                >
                  {gmailAccionLoading ? '…' : 'Conectar Gmail'}
                </button>
              )}
              <div className="pt-1">
                <LogoutButton />
              </div>
            </div>
          </div>
        )}
      </div>

      <main className="max-w-7xl mx-auto px-6 py-3 lg:py-4 space-y-3 lg:space-y-3">
        <section className="flex flex-col gap-0.5">
          <h1 className="text-2xl sm:text-3xl font-bold">
            {saludo}, <span className="text-[#ed8936]">{businessName}</span>
          </h1>
          <p className="text-sm text-white/70">Aquí tienes el resumen de tu negocio</p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
            Resumen de hoy
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <div className="bg-[#111827] border border-red-500/40 rounded-xl py-2 px-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-300 uppercase tracking-wide">
                  Mensajes urgentes pendientes
                </span>
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold">{counts.urgentes}</div>
              <button
                type="button"
                onClick={() => abrirUrgentes(emailsUrgentes)}
                className="inline-flex items-center text-xs text-red-300 hover:text-red-100 mt-1 text-left"
              >
                Ver urgentes
                <ArrowRight className="w-3 h-3 ml-1" />
              </button>
            </div>

            <div className="bg-[#111827] border border-[#ed8936]/50 rounded-xl py-2 px-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  Presupuestos generados
                </span>
                <FileText className="w-5 h-5 text-[#ed8936]" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold">{counts.presupuestos}</div>
              <Link
                href="/presupuestos"
                className="inline-flex items-center text-xs text-[#fed7aa] hover:text-white mt-1"
              >
                Ver presupuestos
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-blue-500/40 rounded-xl py-2 px-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-200 uppercase tracking-wide">
                  Albaranes pendientes
                </span>
                <Package className="w-5 h-5 text-blue-300" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold">{counts.albaranesPendientes}</div>
              <Link
                href="/albaranes"
                className="inline-flex items-center text-xs text-blue-200 hover:text-blue-50 mt-1"
              >
                Ver albaranes
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </div>

            <div className="bg-[#111827] border border-emerald-500/40 rounded-xl py-2 px-3 flex flex-col gap-1">
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
          <h2 className="text-sm font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
            Métricas económicas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setModalMetrica('pendiente')}
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl py-2 px-3 flex flex-col gap-1 hover:bg-[#1e3a5f] transition-colors"
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
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl py-2 px-3 flex flex-col gap-1 hover:bg-[#1e3a5f] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  📄 Importe total presupuestado
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[#ed8936]">
                {loading ? '—' : `${importeTotalPresupuestado.toFixed(2)} €`}
              </div>
              <span className="text-xs text-white/60">Clic para ver desglose por presupuesto</span>
            </button>
            <button
              type="button"
              onClick={() => setModalMetrica('materiales')}
              className="text-left bg-[#1a365d] border border-[#ed8936]/50 rounded-xl py-2 px-3 flex flex-col gap-1 hover:bg-[#1e3a5f] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#fed7aa] uppercase tracking-wide">
                  🧱 Total materiales
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[#ed8936]">
                {loading ? '—' : `${totalMateriales.toFixed(2)} €`}
              </div>
              <span className="text-xs text-white/60">Clic para ver desglose</span>
            </button>
          </div>
        </section>

        <section aria-label="Presupuestos, agenda y correo">
          <h2 className="text-sm font-semibold text-white/60 mb-1.5 uppercase tracking-wide lg:sr-only">
            Actividad reciente
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-2 lg:items-stretch">
            {/* Columna: Últimos presupuestos */}
            <div className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col min-h-0 max-h-64">
              <div className="flex items-center justify-between shrink-0 mb-2">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                  Últimos presupuestos
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {loading ? (
                  <p className="text-white/60 text-xs">Cargando...</p>
                ) : ultimosPresupuestos.length === 0 ? (
                  <p className="text-white/60 text-xs">Aún no hay presupuestos generados.</p>
                ) : (
                  <ul className="space-y-2 text-xs sm:text-sm">
                    {ultimosPresupuestos.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {p.fecha ?? new Date(p.created_at).toLocaleDateString('es-ES')}
                          </p>
                          <p className="text-white/60 text-[11px] sm:text-xs">
                            Estado: {(p.estado ?? 'borrador').toString()}
                          </p>
                        </div>
                        <Link
                          href={`/presupuestos?id=${encodeURIComponent(p.id)}`}
                          className="inline-flex items-center shrink-0 text-[11px] sm:text-xs text-[#ed8936] hover:text-[#f6ad55]"
                        >
                          Ver
                          <ArrowRight className="w-3 h-3 ml-0.5" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Columna: Agenda */}
            <button
              type="button"
              onClick={abrirModalAgenda}
              className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 w-full min-h-0 max-h-64 text-left cursor-pointer transition-all hover:border-[#ed8936]/55 hover:ring-1 hover:ring-[#ed8936]/25 focus:outline-none focus:ring-2 focus:ring-[#ed8936]/40 group flex flex-col"
            >
              <div className="flex items-center justify-between gap-2 shrink-0 mb-2">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide group-hover:text-white">
                  Agenda
                </h3>
                <span
                  className="text-[11px] sm:text-xs font-medium text-[#ed8936] opacity-80 group-hover:opacity-100 shrink-0"
                  aria-hidden
                >
                  Ver calendario →
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {loading ? (
                  <p className="text-white/60 text-xs">Cargando...</p>
                ) : agendaEventos.length === 0 ? (
                  <p className="text-white/60 text-xs">Sin eventos próximos</p>
                ) : (
                  <ul className="space-y-2 text-xs sm:text-sm">
                    {agendaEventos.map((ev) => {
                      const [y, mo, d] = ev.fecha.split('-').map(Number);
                      const fechaLabel = Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)
                        ? new Date(y, mo - 1, d).toLocaleDateString('es-ES', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : ev.fecha;
                      return (
                        <li
                          key={ev.id}
                          className="flex items-start justify-between gap-2 border-b border-white/10 pb-1.5 last:border-b-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="font-medium leading-snug">{ev.titulo}</p>
                            <p className="text-white/60 text-[11px] sm:text-xs">
                              {fechaLabel}
                              {ev.hora ? ` · ${ev.hora}` : ''}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </button>

            {/* Columna: Últimos emails */}
            <div className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col min-h-0 max-h-64">
              <div className="flex items-center justify-between shrink-0 mb-2">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                  Últimos emails
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {!gmailConectado ? (
                  <p className="text-white/70 text-xs leading-snug">
                    Conecta Gmail desde el menú superior para ver la bandeja de entrada.
                  </p>
                ) : emailsLoading ? (
                  <p className="text-white/60 text-xs">Cargando correos…</p>
                ) : emailsError ? (
                  <p className="text-red-200/95 text-xs leading-snug">{emailsError}</p>
                ) : emailsRecientes.length === 0 ? (
                  <p className="text-white/60 text-xs">No hay emails recientes.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {emailsRecientes.map((email, idx) => (
                      <li
                        key={`${email.fechaIso ?? ''}-${idx}`}
                        className="border-b border-white/10 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <button
                          type="button"
                          onClick={() => abrirEmail(email)}
                          className="w-full text-left rounded-md p-1 -m-1 hover:bg-white/5 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start gap-1.5">
                          {email.noLeido ? (
                            <span
                              className="mt-1 size-1.5 shrink-0 rounded-full bg-[#ed8936]"
                              title="No leído"
                              aria-hidden
                            />
                          ) : (
                            <span className="mt-1 size-1.5 shrink-0" aria-hidden />
                          )}
                            <div className="min-w-0 flex-1">
                            <p
                              className={`text-[11px] sm:text-xs leading-tight truncate ${
                                email.noLeido ? 'font-semibold text-white' : 'font-medium text-white/90'
                              }`}
                            >
                              {email.remitente?.trim() || '(Sin remitente)'}
                            </p>
                            <p
                              className={`text-[11px] sm:text-xs leading-tight line-clamp-2 mt-0.5 ${
                                email.noLeido ? 'font-semibold text-white' : 'text-white/80'
                              }`}
                            >
                              {email.asunto?.trim() || '(Sin asunto)'}
                            </p>
                            <p className="text-[10px] sm:text-[11px] text-[#ed8936]/90 mt-0.5 tabular-nums">
                              {formatEmailFecha(email.fechaIso)}
                            </p>
                          </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="shrink-0 mt-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  className="text-xs sm:text-sm font-medium text-[#ed8936] hover:text-[#f6ad55] transition-colors"
                >
                  Ver todos
                </button>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Diario de obra y clientes" className="w-full">
          <h2 className="text-sm font-semibold text-white/60 mb-1.5 uppercase tracking-wide">
            Diario de obra
          </h2>
          <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 lg:max-w-full">
            <div className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col min-h-0">
              <div className="flex items-center justify-between shrink-0 mb-1.5">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                  ÚLTIMAS ENTRADAS DIARIO
                </h3>
              </div>
              <div className="min-h-0 max-h-40 overflow-y-auto overscroll-contain">
                {loading ? (
                  <p className="text-white/60 text-xs">Cargando...</p>
                ) : ultimasEntradasDiario.length === 0 ? (
                  <p className="text-white/60 text-xs">Sin entradas en el diario todavía</p>
                ) : (
                  <ul className="space-y-1.5 text-xs sm:text-sm">
                    {ultimasEntradasDiario.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/diario?obra=${encodeURIComponent(e.obra_nombre)}`
                            )
                          }
                          className="w-full text-left rounded-md px-1.5 py-1.5 -mx-1.5 -my-0.5 border-b border-white/10 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/70"
                        >
                          <p className="font-bold text-white truncate">{e.obra_nombre}</p>
                          <p className="text-[11px] sm:text-xs text-white/60 tabular-nums mt-0.5">
                            {new Date(e.fecha).toLocaleString('es-ES', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                          <p className="text-white/80 text-[11px] sm:text-xs mt-0.5 line-clamp-2">
                            {extractoDiario(e.texto)}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="shrink-0 mt-2 pt-2 border-t border-white/10">
                <Link
                  href="/diario"
                  className="inline-flex items-center text-xs sm:text-sm font-medium text-[#ed8936] hover:text-[#f6ad55] transition-colors"
                >
                  Ver diario completo →
                </Link>
              </div>
            </div>

            <div className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col min-h-0">
              <div className="flex items-center justify-between shrink-0 mb-1.5">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                  Obras activas
                </h3>
              </div>
              <div className="min-h-0 max-h-40 overflow-y-auto overscroll-contain">
                {loading ? (
                  <p className="text-white/60 text-xs">Cargando...</p>
                ) : obrasActivas.length === 0 ? (
                  <p className="text-white/60 text-xs leading-snug">
                    No hay obras activas. Crea una nueva desde el agente o desde /obras
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-xs sm:text-sm">
                    {obrasActivas.map((o) => {
                      const eb = estadoObraBadgeClass(o.estado);
                      const dirTrunc =
                        o.direccion && o.direccion.length > 42
                          ? `${o.direccion.slice(0, 40)}…`
                          : o.direccion;
                      return (
                      <li
                        key={o.id}
                        className="border-b border-white/10 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <button
                          type="button"
                          onClick={() => abrirObra(o.id)}
                          className="w-full text-left rounded-md px-1.5 py-1.5 -m-1 hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ed8936]/70"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-bold text-white truncate min-w-0">{o.nombre}</p>
                            <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${eb.className}`}>
                              {eb.label}
                            </span>
                          </div>
                          <p className="text-[11px] sm:text-xs text-white/70 mt-0.5 truncate">
                            {o.cliente_nombre ?? 'Sin cliente'}
                          </p>
                          {dirTrunc ? (
                            <p className="text-[10px] sm:text-[11px] text-white/55 mt-0.5 truncate" title={o.direccion ?? undefined}>
                              {dirTrunc}
                            </p>
                          ) : null}
                          <p className="text-[11px] sm:text-xs text-[#ed8936]/90 mt-0.5 tabular-nums">
                            {o.num_documentos}{' '}
                            {o.num_documentos === 1 ? 'documento' : 'documentos'}
                          </p>
                          {o.fecha_inicio ? (
                            <p className="text-[10px] sm:text-[11px] text-white/55 mt-0.5 tabular-nums">
                              Inicio: {o.fecha_inicio}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    );
                    })}
                  </ul>
                )}
              </div>
              <div className="shrink-0 mt-2 pt-2 border-t border-white/10">
                <Link
                  href="/obras"
                  className="inline-flex items-center text-xs sm:text-sm font-medium text-[#ed8936] hover:text-[#f6ad55] transition-colors"
                >
                  Ver todas →
                </Link>
              </div>
            </div>

            <div className="bg-[#111827] border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col min-h-0">
              <div className="flex items-center justify-between shrink-0 mb-1.5">
                <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
                  CLIENTES
                </h3>
              </div>
              <div className="min-h-0 max-h-40 overflow-y-auto overscroll-contain">
                {loading ? (
                  <p className="text-white/60 text-xs">Cargando...</p>
                ) : ultimosClientes.length === 0 ? (
                  <p className="text-white/60 text-xs">Aún no hay clientes registrados</p>
                ) : (
                  <ul className="space-y-1.5 text-xs sm:text-sm">
                    {ultimosClientes.map((c) => (
                      <li
                        key={c.id}
                        className="border-b border-white/10 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <p className="font-bold text-white truncate">{c.nombre}</p>
                        <p className="text-[11px] sm:text-xs text-white/70 mt-0.5">
                          {c.num_documentos}{' '}
                          {c.num_documentos === 1 ? 'documento asociado' : 'documentos asociados'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="shrink-0 mt-2 pt-2 border-t border-white/10">
                <Link
                  href="/clientes"
                  className="inline-flex items-center text-xs sm:text-sm font-medium text-[#ed8936] hover:text-[#f6ad55] transition-colors"
                >
                  Ver todos →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {modalAgendaAbierto && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 sm:p-4"
            onClick={cerrarModalAgenda}
            role="presentation"
          >
            <div
              className="bg-[#1a365d] border border-[#ed8936]/60 rounded-xl w-full max-w-4xl max-h-[min(92vh,900px)] overflow-hidden shadow-xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-agenda-titulo"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 border-b border-white/10 shrink-0">
                <h3 id="modal-agenda-titulo" className="text-lg font-semibold text-[#ed8936]">
                  Calendario de agenda
                </h3>
                <button
                  type="button"
                  onClick={cerrarModalAgenda}
                  className="text-white/80 hover:text-white text-2xl leading-none px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
                  aria-label="Cerrar calendario"
                >
                  ×
                </button>
              </div>

              <div className="px-3 sm:px-5 py-3 flex items-center justify-between gap-2 border-b border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setDiaDetalleFecha(null);
                    setMesCalendario(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                    );
                  }}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-white/15 text-white hover:bg-white/10 transition-colors"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <p className="text-center text-base sm:text-lg font-semibold text-white capitalize flex-1 min-w-0 truncate px-1">
                  {new Date(
                    mesCalendario.getFullYear(),
                    mesCalendario.getMonth(),
                    1
                  ).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDiaDetalleFecha(null);
                    setMesCalendario(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                    );
                  }}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-white/15 text-white hover:bg-white/10 transition-colors"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-4 sm:px-5">
                <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 text-center text-[10px] sm:text-xs font-semibold text-white/60 uppercase tracking-wide">
                  {DIAS_SEMANA_CORTO.map((d) => (
                    <div key={d} className="py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 sm:gap-2">
                  {celdasCalendario.map((celda, idx) => {
                    if (!celda.dia || !celda.fechaStr) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[52px] sm:min-h-[72px] rounded-lg bg-transparent"
                        />
                      );
                    }
                    const { fechaStr } = celda;
                    const eventosDia = eventosPorFecha.get(fechaStr) ?? [];
                    const tieneEventos = eventosDia.length > 0;
                    const esHoy = fechaStr === fechaHoyIso;
                    const primero = eventosDia[0];

                    return (
                      <button
                        key={fechaStr}
                        type="button"
                        disabled={!tieneEventos}
                        onClick={() => tieneEventos && setDiaDetalleFecha(fechaStr)}
                        className={[
                          'min-h-[52px] sm:min-h-[72px] rounded-lg border p-1 sm:p-1.5 flex flex-col items-stretch text-left transition-colors min-w-0',
                          esHoy
                            ? 'border-[#ed8936] bg-[#0f172a]/80'
                            : 'border-white/10 bg-[#0f172a]/40',
                          tieneEventos
                            ? 'hover:bg-[#0f172a] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#ed8936]/50'
                            : 'opacity-90 cursor-default',
                        ].join(' ')}
                      >
                        <span className="text-[11px] sm:text-sm font-semibold text-white shrink-0">
                          {celda.dia}
                        </span>
                        {tieneEventos && (
                          <div className="mt-0.5 flex-1 flex flex-col justify-end min-h-0 gap-0.5">
                            <span className="hidden sm:block text-[10px] sm:text-[11px] leading-tight text-[#ed8936] font-medium truncate">
                              {primero?.titulo ?? 'Evento'}
                            </span>
                            {eventosDia.length > 1 && (
                              <span className="hidden sm:block text-[9px] text-white/50">
                                +{eventosDia.length - 1} más
                              </span>
                            )}
                            <span className="sm:hidden flex justify-center pt-0.5">
                              <span
                                className="inline-block w-2 h-2 rounded-full bg-[#ed8936]"
                                title={eventosDia.map((e) => e.titulo).join(', ')}
                              />
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {diaDetalleFecha && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <p className="text-sm font-semibold text-[#ed8936] mb-3">
                      {new Date(diaDetalleFecha + 'T12:00:00').toLocaleDateString('es-ES', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                    <ul className="space-y-2">
                      {(eventosPorFecha.get(diaDetalleFecha) ?? []).map((ev) => (
                        <li
                          key={ev.id}
                          className="rounded-lg border border-white/10 bg-[#0f172a]/95 px-3 py-2.5"
                        >
                          {agendaEditandoId === ev.id ? (
                            <div className="space-y-2">
                              <div>
                                <label
                                  htmlFor={`agenda-titulo-${ev.id}`}
                                  className="sr-only"
                                >
                                  Título
                                </label>
                                <input
                                  id={`agenda-titulo-${ev.id}`}
                                  type="text"
                                  value={draftTitulo}
                                  onChange={(e) => setDraftTitulo(e.target.value)}
                                  disabled={agendaAccionLoading}
                                  className="w-full px-2.5 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/50 focus:border-[#ed8936] outline-none"
                                  placeholder="Título"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`agenda-hora-${ev.id}`}
                                  className="sr-only"
                                >
                                  Hora
                                </label>
                                <input
                                  id={`agenda-hora-${ev.id}`}
                                  type="text"
                                  value={draftHora}
                                  onChange={(e) => setDraftHora(e.target.value)}
                                  disabled={agendaAccionLoading}
                                  className="w-full px-2.5 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936]/50 focus:border-[#ed8936] outline-none"
                                  placeholder="Hora (opcional)"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={cancelarEdicionAgenda}
                                  disabled={agendaAccionLoading}
                                  className="px-3 py-1.5 text-sm rounded-lg border border-white/25 text-white/90 hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void guardarEdicionAgenda()}
                                  disabled={agendaAccionLoading || !draftTitulo.trim()}
                                  className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Guardar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-white text-sm">{ev.titulo}</p>
                                {ev.hora ? (
                                  <p className="text-xs text-[#ed8936] mt-1">{ev.hora}</p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => iniciarEdicionAgenda(ev)}
                                  disabled={agendaAccionLoading}
                                  className="p-2 rounded-lg text-white/80 hover:text-[#ed8936] hover:bg-white/10 transition-colors disabled:opacity-50"
                                  title="Editar"
                                  aria-label="Editar evento"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void eliminarEventoAgenda(ev)}
                                  disabled={agendaAccionLoading}
                                  className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                                  title="Eliminar"
                                  aria-label="Eliminar evento"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
