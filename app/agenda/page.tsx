'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DemoCalendarioMes } from '@/components/dashboard/demo-calendario-card';
import { mezclarMes, useDemoAgenda } from '@/contexts/demo-agenda-context';
import { useDemoTenant } from '@/lib/use-demo-tenant';
import { DEMO_MOCK_ENABLED, getDemoAgendaMes, getDemoObras } from '@/lib/demo-data';

/**
 * Agenda del tenant demo: página normal dentro del shell (con el menú izquierdo), con el mismo calendario
 * que abre la card del dashboard. Las citas añadidas a mano viven en un contexto local y se pierden al recargar.
 * El resto de usuarios no tiene esta página y vuelve al dashboard.
 */
export default function AgendaPage() {
  const router = useRouter();
  const demo = useDemoTenant() && DEMO_MOCK_ENABLED;
  const { citas, anadirCita } = useDemoAgenda();
  const [mes, setMes] = useState(() => new Date());
  const eventosMes = useMemo(
    () => mezclarMes(getDemoAgendaMes(mes.getFullYear(), mes.getMonth()), citas, mes.getFullYear(), mes.getMonth()),
    [mes, citas]
  );
  const obras = useMemo(() => getDemoObras().map((o) => o.nombre), []);

  useEffect(() => {
    if (!demo) router.replace('/dashboard');
  }, [demo, router]);

  if (!demo) return null;

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 rounded-lg border border-[#A04A2F]/50 px-4 py-2 text-sm font-semibold text-[#A04A2F] hover:bg-[#A04A2F]/10"
      >
        ← Volver al Dashboard
      </Link>
      <h1 className="mb-4 text-2xl font-bold text-zinc-900 sm:text-3xl">Agenda</h1>
      <div className="overflow-hidden rounded-2xl border border-zinc-400/40 bg-[#E5DFD0] shadow-sm">
        <DemoCalendarioMes mes={mes} eventosMes={eventosMes} onMes={setMes} onAnadir={anadirCita} obras={obras} />
      </div>
    </div>
  );
}
