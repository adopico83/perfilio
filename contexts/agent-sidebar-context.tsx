'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type AgentSidebarContextValue = {
  isOpen: boolean;
  toggleAgente: () => void;
  abrirAgente: () => void;
  cerrarAgente: () => void;
  pendingPrompt: string | null;
  /** Abre el panel y deja el texto listo en el compositor (no llama a /api/agente). */
  sugerirPrompt: (texto: string) => void;
  consumePendingPrompt: () => void;
};

const AgentSidebarContext = createContext<AgentSidebarContextValue | null>(null);

export function AgentSidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const toggleAgente = useCallback(() => setIsOpen((v) => !v), []);
  const abrirAgente = useCallback(() => setIsOpen(true), []);
  const cerrarAgente = useCallback(() => setIsOpen(false), []);
  const sugerirPrompt = useCallback((texto: string) => {
    const t = texto.trim();
    if (!t) return;
    setIsOpen(true);
    setPendingPrompt(t);
  }, []);
  const consumePendingPrompt = useCallback(() => setPendingPrompt(null), []);

  const value = useMemo<AgentSidebarContextValue>(
    () => ({
      isOpen,
      toggleAgente,
      abrirAgente,
      cerrarAgente,
      pendingPrompt,
      sugerirPrompt,
      consumePendingPrompt,
    }),
    [
      isOpen,
      toggleAgente,
      abrirAgente,
      cerrarAgente,
      pendingPrompt,
      sugerirPrompt,
      consumePendingPrompt,
    ]
  );

  return <AgentSidebarContext.Provider value={value}>{children}</AgentSidebarContext.Provider>;
}

export function useAgentSidebar() {
  const ctx = useContext(AgentSidebarContext);
  if (!ctx) throw new Error('useAgentSidebar debe usarse dentro de AgentSidebarProvider');
  return ctx;
}
