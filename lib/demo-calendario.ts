export type AgendaEvento = {
  id: string;
  titulo: string;
  fecha: string;
  hora: string | null;
};

export type CeldaMes = { dia: number | null; fechaStr: string | null };

export function fechaIso(value: string | null | undefined): string {
  return (value ?? '').slice(0, 10);
}

export function horaCorta(hora: string | null | undefined): string | null {
  if (!hora) return null;
  const m = hora.match(/^(\d{1,2}:\d{2})/);
  return m?.[1] ?? hora;
}

export function etiquetaFecha(fecha: string): string {
  const iso = fechaIso(fecha);
  const [y, mo, d] = iso.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return fecha;
  return new Date(y, mo - 1, d).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Lunes en la primera columna, igual que el calendario del dashboard. */
export function construirCeldasMes(year: number, month: number): CeldaMes[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const celdas: CeldaMes[] = [];
  for (let i = 0; i < startOffset; i++) {
    celdas.push({ dia: null, fechaStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const fechaStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    celdas.push({ dia: d, fechaStr });
  }
  while (celdas.length % 7 !== 0) {
    celdas.push({ dia: null, fechaStr: null });
  }
  return celdas;
}

export function eventosPorFecha(eventos: AgendaEvento[]): Map<string, AgendaEvento[]> {
  const map = new Map<string, AgendaEvento[]>();
  for (const ev of eventos) {
    const key = fechaIso(ev.fecha);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(ev);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''));
  }
  return map;
}
