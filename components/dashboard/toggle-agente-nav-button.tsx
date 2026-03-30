'use client';

import { useAgentSidebar } from '@/contexts/agent-sidebar-context';

export default function ToggleAgenteNavButton({ className }: { className: string }) {
  const { toggleAgente } = useAgentSidebar();

  return (
    <button type="button" onClick={toggleAgente} className={className}>
      ✨ Agente IA
    </button>
  );
}

