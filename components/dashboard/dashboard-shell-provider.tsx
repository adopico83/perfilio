'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import DashboardShell from './dashboard-shell';
import { AgentSidebarProvider } from '@/contexts/agent-sidebar-context';

const DASHBOARD_PREFIXES = [
  '/dashboard',
  '/mensajes',
  '/presupuestos',
  '/albaranes',
  '/diario',
  '/clientes',
  '/facturas',
  '/obras',
  '/operarios',
];

export default function DashboardShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const isDashboardRoute = DASHBOARD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isDashboardRoute) return <>{children}</>;
  return (
    <AgentSidebarProvider>
      <DashboardShell>{children}</DashboardShell>
    </AgentSidebarProvider>
  );
}

