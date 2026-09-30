'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgendaEvento } from '@/lib/demo-calendario';

/** Cita de la agenda demo; las creadas a mano llevan además obra y nota opcionales. */
export type DemoCita = AgendaEvento & {
  obra_nombre?: string | null;
  nota?: string | null;
};

export type NuevaCitaDemo = {
  titulo: string;
  fecha: string;
  hora: string | null;
  obra_nombre?: string | null;
  nota?: string | null;
};

type DemoAgendaValue = {
  /** Citas añadidas a mano (solo estado local: se pierden al recargar). */
  citas: DemoCita[];
  anadirCita: (cita: NuevaCitaDemo) => DemoCita;
};

const SIN_PROVEEDOR: DemoAgendaValue = {
  citas: [],
  anadirCita: (cita) => ({ id: 'demo-cita-sin-proveedor', ...cita, obra_nombre: cita.obra_nombre ?? null, nota: cita.nota ?? null }),
};

const DemoAgendaContext = createContext<DemoAgendaValue>(SIN_PROVEEDOR);

/** Estado local compartido entre la página Agenda y la card del dashboard. Nunca escribe en Supabase. */
export function DemoAgendaProvider({ children }: { children: ReactNode }) {
  const [citas, setCitas] = useState<DemoCita[]>([]);
  const contador = useRef(0);

  const anadirCita = useCallback((cita: NuevaCitaDemo): DemoCita => {
    contador.current += 1;
    const nueva: DemoCita = {
      id: `demo-cita-local-${Date.now()}-${contador.current}`,
      titulo: cita.titulo,
      fecha: cita.fecha,
      hora: cita.hora,
      obra_nombre: cita.obra_nombre ?? null,
      nota: cita.nota ?? null,
    };
    setCitas((prev) => [...prev, nueva]);
    return nueva;
  }, []);

  const value = useMemo(() => ({ citas, anadirCita }), [citas, anadirCita]);
  return <DemoAgendaContext.Provider value={value}>{children}</DemoAgendaContext.Provider>;
}

export function useDemoAgenda(): DemoAgendaValue {
  return useContext(DemoAgendaContext);
}

function ordenar<T extends AgendaEvento>(eventos: T[]): T[] {
  return [...eventos].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? '').localeCompare(b.hora ?? '')
  );
}

/** Próximas citas (hoy en adelante): las del mock más las añadidas a mano. */
export function mezclarProximos(
  base: DemoCita[],
  locales: DemoCita[],
  hoy: string,
  limite = 4
): DemoCita[] {
  return ordenar([...base, ...locales].filter((e) => e.fecha >= hoy)).slice(0, limite);
}

/** Citas de un mes (`month` 0-11): las del mock más las añadidas a mano. */
export function mezclarMes(base: DemoCita[], locales: DemoCita[], year: number, month: number): DemoCita[] {
  const prefijo = `${year}-${String(month + 1).padStart(2, '0')}`;
  return ordenar([...base, ...locales].filter((e) => e.fecha.startsWith(prefijo)));
}
