/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import AgenteContextChips, { chipsObra, chipsPresupuesto } from '@/components/dashboard/agente-context-chips';
import { AgentSidebarProvider, useAgentSidebar } from '@/contexts/agent-sidebar-context';

function PendingPromptProbe() {
  const { pendingPrompt } = useAgentSidebar();
  return <p data-testid="pending">{pendingPrompt ?? ''}</p>;
}

describe('AgenteContextChips', () => {
  it('chips de obra rellenan el prompt del agente sin llamar a la API', () => {
    const chips = chipsObra('Reforma piso');
    expect(chips.map((c) => c.label)).toEqual(['Añade partida', 'Envía presupuesto']);

    render(
      <AgentSidebarProvider>
        <AgenteContextChips chips={chips} />
        <PendingPromptProbe />
      </AgentSidebarProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Añade partida' }));
    expect(screen.getByTestId('pending').textContent).toMatch(/Añade una partida al presupuesto de la obra Reforma piso/);
  });

  it('chips de presupuesto incluyen el nombre de la obra', () => {
    const chips = chipsPresupuesto('Reforma piso');
    expect(chips[1].prompt).toMatch(/Envía este presupuesto de Reforma piso/);
  });
});
