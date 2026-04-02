'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ObraModalState = {
  isOpen: boolean;
  obraId: string | null;
};

type ObraModalContextValue = ObraModalState & {
  abrirObra: (obra_id: string) => void;
  cerrarObra: () => void;
};

const ObraModalContext = createContext<ObraModalContextValue | null>(null);

export function ObraModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ObraModalState>({ isOpen: false, obraId: null });

  const abrirObra = useCallback((obra_id: string) => {
    const id = String(obra_id ?? '').trim();
    if (!id) return;
    setState({ isOpen: true, obraId: id });
  }, []);

  const cerrarObra = useCallback(() => {
    setState({ isOpen: false, obraId: null });
  }, []);

  const value = useMemo<ObraModalContextValue>(() => ({ ...state, abrirObra, cerrarObra }), [state, abrirObra, cerrarObra]);

  return <ObraModalContext.Provider value={value}>{children}</ObraModalContext.Provider>;
}

export function useObraModal() {
  const ctx = useContext(ObraModalContext);
  if (!ctx) throw new Error('useObraModal debe usarse dentro de ObraModalProvider');
  return ctx;
}

