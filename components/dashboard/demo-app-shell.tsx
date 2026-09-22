'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import AgentSidebar from '@/components/dashboard/agent-sidebar';
import { DEMO_NAV_ITEMS } from '@/components/dashboard/demo-nav';
import DemoSkyline from '@/components/dashboard/demo-skyline';
import { useAgentSidebar } from '@/contexts/agent-sidebar-context';
import LogoutButton from '@/app/dashboard/logout-button';

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
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Demo">
      {DEMO_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <Link key={item.href} href={item.href} className={navItemClass(active)} onClick={onNavigate}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <button type="button" onClick={onAgente} className={navItemClass(agenteOpen)}>
        <Sparkles className="size-4 shrink-0" aria-hidden />
        Agente IA
      </button>
    </nav>
  );
}

export default function DemoAppShell({
  businessName,
  children,
}: {
  businessName: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname() || '/dashboard';
  const { isOpen, toggleAgente, cerrarAgente } = useAgentSidebar();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closedOnMount = useRef(false);

  useEffect(() => {
    if (closedOnMount.current) return;
    closedOnMount.current = true;
    cerrarAgente();
  }, [cerrarAgente]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const brand = businessName?.trim() || 'Perfilio';

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-400/30 bg-[#E5DFD0] md:flex">
          <div className="px-5 py-5">
            <Link href="/dashboard" className="block font-bold text-lg tracking-tight text-zinc-900">
              Perfilio
            </Link>
            <p className="mt-1 text-[11px] text-zinc-600 leading-snug truncate" title={brand}>
              {brand}
            </p>
          </div>
          <SidebarNav
            pathname={pathname}
            agenteOpen={isOpen}
            onAgente={toggleAgente}
            onNavigate={() => {}}
          />
          <DemoSkyline />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-400/30 bg-[#EFEADF] px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="md:hidden inline-flex size-10 items-center justify-center rounded-lg border border-zinc-400/40 text-zinc-800"
                aria-label="Abrir menú"
                onClick={() => setMobileNavOpen(true)}
              >
                ☰
              </button>
              <p className="truncate text-sm font-semibold text-zinc-800">{brand}</p>
            </div>
            <LogoutButton />
          </header>

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto">{children}</div>
            {isOpen ? (
              <div className="hidden lg:block w-[25%] min-w-[320px] max-w-[420px] border-l border-zinc-400/30">
                <div className="sticky top-0 h-[calc(100vh-3.5rem)]">
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
        <div className="md:hidden fixed inset-0 z-[80]">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Cerrar menú"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 flex w-64 flex-col overflow-hidden bg-[#E5DFD0] shadow-xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-400/30">
              <span className="font-bold text-zinc-900">Perfilio</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg text-zinc-700"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-3">
              <SidebarNav
                pathname={pathname}
                agenteOpen={isOpen}
                onAgente={() => {
                  toggleAgente();
                  setMobileNavOpen(false);
                }}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </div>
            <DemoSkyline />
          </div>
        </div>
      ) : null}
    </div>
  );
}
