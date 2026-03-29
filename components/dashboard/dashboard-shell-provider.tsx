'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import DashboardShell from './dashboard-shell';

const DASHBOARD_PREFIXES = [
  '/dashboard',
  '/mensajes',
  '/presupuestos',
  '/albaranes',
  '/diario',
  '/facturas',
];

export default function DashboardShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const isDashboardRoute = DASHBOARD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isDashboardRoute) return <>{children}</>;
  return <DashboardShell>{children}</DashboardShell>;
}

