'use client';

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import ToggleAgenteNavButton from '@/components/dashboard/toggle-agente-nav-button';

export type DashboardNavActive =
  | 'mensajes'
  | 'presupuestos'
  | 'albaranes'
  | 'facturas'
  | 'diario'
  | 'obras'
  | 'clientes'
  | 'operarios';

const NAV_ITEMS: { key: DashboardNavActive; href: string; label: string }[] = [
  { key: 'mensajes', href: '/mensajes', label: 'Mensajes' },
  { key: 'presupuestos', href: '/presupuestos', label: 'Presupuestos' },
  { key: 'albaranes', href: '/albaranes', label: 'Albaranes' },
  { key: 'facturas', href: '/facturas', label: 'Facturas' },
  { key: 'diario', href: '/diario', label: 'Diario' },
  { key: 'obras', href: '/obras', label: 'Obras' },
  { key: 'clientes', href: '/clientes', label: 'Clientes' },
  { key: 'operarios', href: '/operarios', label: 'Operarios' },
];

const PRIMARY_ORDER: DashboardNavActive[] = ['obras', 'operarios', 'diario'];
const MORE_KEYS = new Set<DashboardNavActive>([
  'mensajes',
  'presupuestos',
  'albaranes',
  'facturas',
  'clientes',
]);

function itemMeta(key: DashboardNavActive) {
  return NAV_ITEMS.find((i) => i.key === key)!;
}

function linkClass(active: boolean, compact: boolean): string {
  const size = compact ? 'text-xs sm:text-sm' : 'text-sm';
  return [
    size,
    'shrink-0 transition-colors',
    active ? 'font-medium text-[#ed8936]' : 'text-gray-200 hover:text-white',
  ].join(' ');
}

function NavMasDropdown({
  active,
  onNavigate,
}: {
  active: DashboardNavActive | null;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const moreItems = NAV_ITEMS.filter((i) => MORE_KEYS.has(i.key));
  const activeInMore = active != null && MORE_KEYS.has(active);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={[
          'inline-flex items-center gap-0.5 rounded-lg border px-2 py-1.5 sm:px-2.5 sm:py-1.5 text-xs sm:text-sm transition-colors touch-manipulation',
          open || activeInMore
            ? 'border-[#ed8936]/55 bg-[#ed8936]/15 text-[#f6ad55]'
            : 'border-white/15 text-white/85 hover:bg-white/10',
        ].join(' ')}
      >
        Más <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-[130] mt-1 min-w-[11rem] rounded-lg border border-white/10 bg-[#111827] py-1 shadow-xl"
          role="menu"
        >
          {moreItems.map((item) => {
            const isActive = active === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                className={[
                  'block px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-[#ed8936]/15 font-medium text-[#f6ad55]' : 'text-gray-200 hover:bg-white/10 hover:text-white',
                ].join(' ')}
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardMainNav({
  brand,
  betweenBrandAndMenu,
  menuMovilAbierto,
  setMenuMovilAbierto,
  active,
  desktopTrailing,
  mobileDrawerFooter,
}: {
  brand: ReactNode;
  betweenBrandAndMenu?: ReactNode;
  menuMovilAbierto: boolean;
  setMenuMovilAbierto: Dispatch<SetStateAction<boolean>>;
  active: DashboardNavActive | null;
  desktopTrailing: ReactNode;
  /** Contenido tras el botón Agente en el menú móvil (p. ej. Gmail + cerrar sesión). */
  mobileDrawerFooter: ReactNode;
}) {
  const closeMobile = () => setMenuMovilAbierto(false);

  const agenteBtnClassCompact =
    'inline-flex shrink-0 items-center px-3 py-1.5 sm:px-3.5 sm:py-1.5 text-xs sm:text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors';
  const agenteBtnClassWide =
    'inline-flex shrink-0 items-center px-3 py-1.5 2xl:px-4 2xl:py-2 text-xs 2xl:text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors';

  return (
    <div className="border-b border-white/10 bg-[#0f172a]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 min-w-0">
        {brand}
        {betweenBrandAndMenu ?? null}
        <button
          type="button"
          onClick={() => setMenuMovilAbierto((v) => !v)}
          className="md:hidden inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors ml-auto"
          aria-label="Abrir menú"
        >
          ☰
        </button>

        {/* Compacto: md–2xl — Obras, Operarios, Diario + Más + Agente; sin scroll horizontal */}
        <div className="hidden md:flex 2xl:hidden flex-1 min-w-0 items-center justify-end gap-2 sm:gap-3">
          <nav
            className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 sm:gap-2.5 pr-1"
            aria-label="Secciones"
          >
            {PRIMARY_ORDER.map((key) => {
              const item = itemMeta(key);
              const isActive = active === key;
              return isActive ? (
                <span key={key} className={linkClass(true, true)}>
                  {item.label}
                </span>
              ) : (
                <Link key={key} href={item.href} className={linkClass(false, true)}>
                  {item.label}
                </Link>
              );
            })}
            <NavMasDropdown active={active} onNavigate={() => {}} />
            <ToggleAgenteNavButton className={agenteBtnClassCompact} />
          </nav>
          <div className="flex shrink-0 flex-nowrap items-center gap-2">{desktopTrailing}</div>
        </div>

        {/* Ancho completo: 2xl+ — todas las pestañas */}
        <div className="hidden 2xl:flex flex-1 min-w-0 items-center justify-end gap-2 lg:gap-3">
          <nav
            className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 lg:gap-2.5 pr-1"
            aria-label="Secciones"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.key;
              return isActive ? (
                <span key={item.key} className={linkClass(true, false)}>
                  {item.label}
                </span>
              ) : (
                <Link key={item.key} href={item.href} className={linkClass(false, false)}>
                  {item.label}
                </Link>
              );
            })}
            <ToggleAgenteNavButton className={agenteBtnClassWide} />
          </nav>
          <div className="flex shrink-0 flex-nowrap items-center gap-2">{desktopTrailing}</div>
        </div>
      </div>

      {menuMovilAbierto ? (
        <div className="md:hidden max-w-7xl mx-auto px-6 pb-4">
          <div className="bg-[#111827] border border-white/10 rounded-xl p-4 flex flex-col gap-3">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.key;
              return isActive ? (
                <span key={item.key} className="text-sm font-medium text-[#ed8936]">
                  {item.label}
                </span>
              ) : (
                <Link
                  key={item.key}
                  href={item.href}
                  className="text-sm text-gray-200 hover:text-white"
                  onClick={closeMobile}
                >
                  {item.label}
                </Link>
              );
            })}
            <div onClick={closeMobile}>
              <ToggleAgenteNavButton className="w-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors" />
            </div>
            {mobileDrawerFooter}
          </div>
        </div>
      ) : null}
    </div>
  );
}
