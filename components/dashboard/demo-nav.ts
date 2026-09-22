import {
  BookOpen,
  Building2,
  FileText,
  LayoutDashboard,
  Mail,
  Package,
  Receipt,
  Users,
  Wallet,
  HardHat,
  type LucideIcon,
} from 'lucide-react';

/** Destinos reales del top nav de Pino (`dashboard-main-nav`), más el home del shell demo. */
export const DEMO_NAV_ITEMS: {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
}[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    match: (p) => p === '/dashboard' || p === '/',
  },
  {
    href: '/mensajes',
    label: 'Mensajes',
    icon: Mail,
    match: (p) => p.startsWith('/mensajes'),
  },
  {
    href: '/presupuestos',
    label: 'Presupuestos',
    icon: FileText,
    match: (p) => p.startsWith('/presupuestos'),
  },
  {
    href: '/albaranes',
    label: 'Albaranes',
    icon: Package,
    match: (p) => p.startsWith('/albaranes'),
  },
  {
    href: '/facturas',
    label: 'Facturas',
    icon: Receipt,
    match: (p) => p.startsWith('/facturas'),
  },
  {
    href: '/gastos',
    label: 'Gastos',
    icon: Wallet,
    match: (p) => p.startsWith('/gastos'),
  },
  {
    href: '/diario',
    label: 'Diario',
    icon: BookOpen,
    match: (p) => p.startsWith('/diario'),
  },
  {
    href: '/obras',
    label: 'Obras',
    icon: Building2,
    match: (p) => p.startsWith('/obras'),
  },
  {
    href: '/clientes',
    label: 'Clientes',
    icon: Users,
    match: (p) => p.startsWith('/clientes'),
  },
  {
    href: '/operarios',
    label: 'Operarios',
    icon: HardHat,
    match: (p) => p.startsWith('/operarios'),
  },
];
