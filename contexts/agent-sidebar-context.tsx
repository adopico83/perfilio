'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AgentSidebarContextValue = {
  isOpen: boolean;
  toggleAgente: () => void;
  abrirAgente: () => void;
  cerrarAgente: () => void;
};

const AgentSidebarContext = createContext<AgentSidebarContextValue | null>(null);

export function AgentSidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);

  const value = useMemo<AgentSidebarContextValue>(
    () => ({
      isOpen,
      toggleAgente: () => setIsOpen((v) => !v),
      abrirAgente: () => setIsOpen(true),
      cerrarAgente: () => setIsOpen(false),
    }),
    [isOpen]
  );

  return <AgentSidebarContext.Provider value={value}>{children}</AgentSidebarContext.Provider>;
}

export function useAgentSidebar() {
  const ctx = useContext(AgentSidebarContext);
  if (!ctx) throw new Error('useAgentSidebar debe usarse dentro de AgentSidebarProvider');
  return ctx;
}

