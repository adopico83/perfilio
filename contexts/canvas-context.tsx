'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type CanvasTipo =
  | 'presupuestos'
  | 'facturas'
  | 'albaranes'
  | 'emails'
  | 'gastos'
  | 'diario';

type CanvasState = {
  isOpen: boolean;
  tipo: CanvasTipo | '';
  datos: unknown[];
  titulo: string;
};

type CanvasContextValue = CanvasState & {
  abrirCanvas: (tipo: string, datos: unknown[], titulo: string) => void;
  cerrarCanvas: () => void;
};

const CanvasContext = createContext<CanvasContextValue | null>(null);

const ALLOWED_TIPOS = new Set<string>([
  'presupuestos',
  'facturas',
  'albaranes',
  'emails',
  'gastos',
  'diario',
]);

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CanvasState>({
    isOpen: false,
    tipo: '',
    datos: [],
    titulo: '',
  });

  const abrirCanvas = useCallback((tipo: string, datos: unknown[], titulo: string) => {
    const t = ALLOWED_TIPOS.has(tipo) ? (tipo as CanvasTipo) : '';
    setState({
      isOpen: true,
      tipo: t,
      datos: Array.isArray(datos) ? datos : [],
      titulo: titulo.trim() || 'Vista visual',
    });
  }, []);

  const cerrarCanvas = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const value = useMemo<CanvasContextValue>(
    () => ({
      ...state,
      abrirCanvas,
      cerrarCanvas,
    }),
    [state, abrirCanvas, cerrarCanvas]
  );

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error('useCanvas debe usarse dentro de CanvasProvider');
  }
  return ctx;
}
