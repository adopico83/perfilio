/**
 * Densidad única del panel.
 * Resumen, métricas, actividad y el pulse comparten padding, ritmo y tipo
 * para que esas bandas bajen de altura y quepan mejor en el viewport.
 * Los números grandes se quedan en text-xl / text-2xl (legibles); el ahorro
 * está en la interlínea, el padding y no apilar rótulo + cifra en dos bloques.
 */
/**
 * Ancho del cromo según el agente. La densidad vertical es la misma en los dos estados:
 * con el agente cerrado el panel ocupa todo el ancho; con él abierto se queda en max-w-7xl.
 */
export function dashMain(agentOpen: boolean): string {
  const rhythm = 'py-2 space-y-2';
  return agentOpen
    ? `max-w-7xl mx-auto px-6 ${rhythm}`
    : `w-full max-w-none px-4 sm:px-6 ${rhythm}`;
}

/** Cuatro columnas antes cuando el lienzo es el ancho completo (agente cerrado). */
export function dashResumenGrid(agentOpen: boolean): string {
  return agentOpen
    ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-1.5'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5';
}

export const dash = {
  greetingWrap: 'flex flex-col gap-0.5',
  greeting: 'text-xl sm:text-2xl font-bold leading-tight',
  greetingRow:
    'flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3',
  greetingSub: 'text-xs text-zinc-900/70',

  sectionToggle:
    'flex w-full items-center justify-between gap-2 mb-1 text-left sm:pointer-events-none sm:cursor-default',
  sectionTitle: 'text-[11px] font-semibold text-zinc-900/60 uppercase tracking-wide',

  metricasGrid: 'grid grid-cols-1 sm:grid-cols-3 gap-1.5',
  actividadGrid: 'grid grid-cols-1 lg:grid-cols-3 gap-1.5 lg:items-stretch',
  widgetsGrid: 'w-full grid grid-cols-1 lg:grid-cols-3 gap-1.5 lg:max-w-full',

  resumenCard: 'bg-[#E5DFD0] rounded-lg py-1.5 px-2.5 flex flex-col gap-0.5',
  metricaCard:
    '@container text-left bg-[#E5DFD0] border border-[#A04A2F]/60 rounded-lg py-1.5 px-2.5 flex flex-col gap-0.5 hover:bg-[#D4CCBC] transition-all duration-150',
  activityCard:
    'bg-[#E5DFD0] border border-white/10 rounded-lg p-2 flex flex-col min-h-0 max-h-40',
  widgetCard: 'bg-[#E5DFD0] border border-white/10 rounded-lg p-2 flex flex-col min-h-0',

  labelRow: 'flex items-center justify-between gap-2',
  label: 'text-[11px] font-semibold text-zinc-800 uppercase tracking-wide leading-tight',
  stat: 'text-xl font-bold leading-none tabular-nums',
  money: 'text-2xl font-bold font-mono leading-none tabular-nums text-[#A04A2F]',
  moneyBase: 'text-base font-bold font-mono leading-none tabular-nums text-[#c97c5a]',
  metricRow:
    'flex flex-col gap-0.5 @[22rem]:flex-row @[22rem]:items-baseline @[22rem]:justify-between @[22rem]:gap-2',
  metricRowLabel: 'min-w-0 @[22rem]:truncate',
  metricRowValue: 'shrink-0',
  subLabel: 'text-[11px] leading-tight text-zinc-900/80',
  subLabelStrong: 'text-[11px] leading-tight text-zinc-900/90',
  hint: 'text-[11px] leading-tight text-zinc-900/60',
  link: 'inline-flex items-center text-[11px] leading-tight text-[#A04A2F] hover:text-[#8a3f28]',
  icon: 'w-4 h-4 shrink-0',

  activityHead: 'flex items-center justify-between gap-2 shrink-0 mb-1',
  activityTitle: 'text-[11px] font-semibold text-zinc-900/80 uppercase tracking-wide',
  activityBody: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
  activityList: 'space-y-1 text-xs',
  activityItem:
    'flex items-center justify-between gap-2 border-b border-white/10 pb-1 last:border-b-0 last:pb-0 rounded-md hover:bg-[#D4CCBC] hover:scale-[1.01] cursor-pointer transition-all duration-150',
  agendaItem:
    'flex items-start justify-between gap-2 border-b border-white/10 pb-1 last:border-b-0 last:pb-0 rounded-sm hover:bg-[#D4CCBC] cursor-pointer transition-colors duration-150',
  widgetScroll: 'min-h-0 max-h-36 overflow-y-auto overscroll-contain',
  widgetList: 'space-y-1 text-xs',
  widgetFooter: 'shrink-0 mt-1.5 pt-1.5 border-t border-white/10',
  widgetFooterLink:
    'inline-flex items-center text-xs font-medium text-[#A04A2F] hover:text-[#c97c5a] transition-colors',

  pulse:
    'h-auto rounded-lg border border-zinc-400/50 bg-[#E5DFD0]/75 px-2.5 py-1.5 shadow-lg backdrop-blur-md',
  pulseSkeleton:
    'h-auto rounded-lg border border-zinc-400/50 bg-[#E5DFD0]/70 px-2.5 py-1.5 shadow-lg backdrop-blur-md',
  pulseHead: 'mb-1 flex items-center justify-between gap-2',
  pulseTitle: 'truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-600',
  pulseBadge:
    'shrink-0 rounded-full border border-[#A04A2F]/35 bg-[#A04A2F]/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-zinc-900',
  pulseGrid:
    'flex gap-1.5 overflow-x-auto pb-0.5 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0',
  pulseCard:
    'flex min-w-[8.25rem] flex-1 cursor-pointer flex-col rounded-md border border-zinc-400/30 bg-white/[0.04] px-2 py-1 transition hover:border-[#A04A2F]/40 hover:bg-white/[0.06] hover:brightness-110',
  pulseKind: 'flex min-w-0 items-center gap-1 text-[11px] font-semibold leading-tight text-zinc-700',
  pulseText: 'line-clamp-1 text-[11px] leading-snug text-zinc-600',
  pulseEmpty:
    'rounded-md border border-zinc-400/30 bg-white/[0.04] px-2 py-1 text-[11px] leading-snug text-zinc-600',
} as const;
