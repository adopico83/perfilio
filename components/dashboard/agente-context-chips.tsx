'use client';

import { useAgentSidebar } from '@/contexts/agent-sidebar-context';

export type AgenteChip = {
  id: string;
  label: string;
  prompt: string;
};

export function chipsObra(obraNombre: string): AgenteChip[] {
  const nombre = obraNombre.trim() || 'esta obra';
  return [
    {
      id: 'anade-partida',
      label: 'Añade partida',
      prompt: `Añade una partida al presupuesto de la obra ${nombre}`,
    },
    {
      id: 'envia-presupuesto',
      label: 'Envía presupuesto',
      prompt: `Envía el presupuesto de la obra ${nombre} al cliente`,
    },
  ];
}

export function chipsPresupuesto(obraNombre?: string | null): AgenteChip[] {
  const deObra = obraNombre?.trim() ? ` de ${obraNombre.trim()}` : '';
  return [
    {
      id: 'anade-partida',
      label: 'Añade partida',
      prompt: `Añade una partida a este presupuesto${deObra}`,
    },
    {
      id: 'envia-presupuesto',
      label: 'Envía presupuesto',
      prompt: `Envía este presupuesto${deObra} al cliente para que lo dé por bueno`,
    },
  ];
}

export default function AgenteContextChips({
  chips,
  onBeforeSuggest,
}: {
  chips: AgenteChip[];
  /** p. ej. cerrar el modal para que se vea el panel del agente */
  onBeforeSuggest?: () => void;
}) {
  const { sugerirPrompt } = useAgentSidebar();

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Sugerencias para el agente">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => {
            onBeforeSuggest?.();
            sugerirPrompt(chip.prompt);
          }}
          className="inline-flex items-center px-3 py-1.5 rounded-full border border-[#A04A2F]/45 bg-[#A04A2F]/10 text-xs font-medium text-[#A04A2F] hover:bg-[#A04A2F]/20 transition-colors touch-manipulation"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
