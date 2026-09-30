'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DemoCalendarioMes } from '@/components/dashboard/demo-calendario-card';
import { useDemoTenant } from '@/lib/use-demo-tenant';
import { DEMO_MOCK_ENABLED, getDemoAgendaMes } from '@/lib/demo-data';

/**
 * Agenda a página completa del tenant demo: el mismo calendario que abre la card del dashboard,
 * con las citas del mock. El resto de usuarios no tiene esta página y vuelve al dashboard.
 */
export default function AgendaPage() {
  const router = useRouter();
  const demo = useDemoTenant() && DEMO_MOCK_ENABLED;
  const [mes, setMes] = useState(() => new Date());
  const eventosMes = useMemo(() => getDemoAgendaMes(mes.getFullYear(), mes.getMonth()), [mes]);

  useEffect(() => {
    if (!demo) router.replace('/dashboard');
  }, [demo, router]);

  if (!demo) return null;

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-zinc-900 sm:text-3xl">Agenda</h1>
      <div className="overflow-hidden rounded-2xl border border-zinc-400/40 bg-[#E5DFD0] shadow-sm">
        <DemoCalendarioMes mes={mes} eventosMes={eventosMes} onMes={setMes} />
      </div>
    </div>
  );
}
