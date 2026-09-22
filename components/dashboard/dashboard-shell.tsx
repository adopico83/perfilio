'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Building2,
  FileText,
  HardHat,
  Mail,
  Package,
  Receipt,
  Sparkles,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import AgentSidebar from './agent-sidebar';
import BusinessBrand from './business-brand';
import { DASHBOARD_NAV_ITEMS, activeDashboardNavKey, type DashboardNavKey } from './dashboard-nav';
import { useAgentSidebar } from '@/contexts/agent-sidebar-context';
import { useSession } from '@/components/providers/session-provider';
import LogoutButton from '@/app/dashboard/logout-button';

const NAV_ICONS: Record<DashboardNavKey, LucideIcon> = {
  mensajes: Mail,
  presupuestos: FileText,
  albaranes: Package,
  facturas: Receipt,
  gastos: Wallet,
  diario: BookOpen,
  obras: Building2,
  clientes: Users,
  operarios: HardHat,
};

function navItemClass(active: boolean): string {
  return [
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
    active
      ? 'bg-[#A04A2F] text-white'
      : 'text-zinc-800 hover:bg-[#A04A2F]/10 hover:text-[#A04A2F]',
  ].join(' ');
}

function SidebarNav({
  pathname,
  agenteOpen,
  onAgente,
  onNavigate,
}: {
  pathname: string;
  agenteOpen: boolean;
  onAgente: () => void;
  onNavigate: () => void;
}) {
  const activeKey = activeDashboardNavKey(pathname);

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Secciones">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.key];
        const active = activeKey === item.key;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={navItemClass(active)}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <button type="button" onClick={onAgente} className={navItemClass(agenteOpen)} aria-pressed={agenteOpen}>
        <Sparkles className="size-4 shrink-0" aria-hidden />
        Agente IA
      </button>
    </nav>
  );
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/dashboard';
  const { isOpen, toggleAgente } = useAgentSidebar();
  const { businessName } = useSession();
  const [navPinnedTo, setNavPinnedTo] = useState<string | null>(null);
  const mobileNavOpen = navPinnedTo === pathname;

  const brandName = businessName?.trim() || 'Perfilio';

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-zinc-400/30 bg-[#E5DFD0] md:flex">
          <div className="px-5 py-5">
            <Link href="/dashboard" className="block text-lg font-bold tracking-tight text-zinc-900">
              Perfilio
            </Link>
            <p className="mt-1 truncate text-[11px] leading-snug text-zinc-600" title={brandName}>
              {brandName}
            </p>
          </div>
          <SidebarNav pathname={pathname} agenteOpen={isOpen} onAgente={toggleAgente} onNavigate={() => {}} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-zinc-400/30 bg-[#EFEADF]/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-400/40 text-zinc-800 md:hidden"
                aria-label="Abrir menú"
                aria-expanded={mobileNavOpen}
                onClick={() => setNavPinnedTo(pathname)}
              >
                ☰
              </button>
              <BusinessBrand name={businessName} />
            </div>
            <div className="hidden sm:block">
              <LogoutButton />
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <div className={isOpen ? 'min-w-0 flex-1' : 'min-w-0 w-full flex-1'}>{children}</div>
            {isOpen ? (
              <div className="hidden w-[25%] min-w-[320px] max-w-[420px] shrink-0 border-l border-zinc-400/30 lg:block">
                <div className="sticky top-[4.75rem] h-[calc(100dvh-4.75rem)]">
                  <AgentSidebar />
                </div>
              </div>
            ) : null}
            {isOpen ? (
              <div className="lg:hidden">
                <AgentSidebar />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-[80] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Cerrar menú"
            onClick={() => setNavPinnedTo(null)}
          />
          <div className="absolute bottom-0 left-0 top-0 flex w-64 flex-col bg-[#E5DFD0] shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-400/30 px-4 py-4">
              <Link href="/dashboard" className="font-bold text-zinc-900" onClick={() => setNavPinnedTo(null)}>
                Perfilio
              </Link>
              <button
                type="button"
                onClick={() => setNavPinnedTo(null)}
                className="rounded-lg p-2 text-zinc-700"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <SidebarNav
                pathname={pathname}
                agenteOpen={isOpen}
                onAgente={() => {
                  toggleAgente();
                  setNavPinnedTo(null);
                }}
                onNavigate={() => setNavPinnedTo(null)}
              />
            </div>
            <div className="border-t border-zinc-400/30 p-4 sm:hidden">
              <LogoutButton />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
