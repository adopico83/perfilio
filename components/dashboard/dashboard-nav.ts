/** Destinos reales del nav de producción (antes, barra superior). */
export const DASHBOARD_NAV_ITEMS = [
  { key: 'mensajes', href: '/mensajes', label: 'Mensajes' },
  { key: 'presupuestos', href: '/presupuestos', label: 'Presupuestos' },
  { key: 'albaranes', href: '/albaranes', label: 'Albaranes' },
  { key: 'facturas', href: '/facturas', label: 'Facturas' },
  { key: 'gastos', href: '/gastos', label: 'Gastos' },
  { key: 'diario', href: '/diario', label: 'Diario' },
  { key: 'obras', href: '/obras', label: 'Obras' },
  { key: 'clientes', href: '/clientes', label: 'Clientes' },
  { key: 'operarios', href: '/operarios', label: 'Operarios' },
] as const;

export type DashboardNavKey = (typeof DASHBOARD_NAV_ITEMS)[number]['key'];

export function activeDashboardNavKey(pathname: string): DashboardNavKey | null {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const hit = DASHBOARD_NAV_ITEMS.find(
    (item) => path === item.href || path.startsWith(`${item.href}/`)
  );
  return hit?.key ?? null;
}
