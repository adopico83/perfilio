import { parsePresupuestoGenerado } from '@/lib/pdf/parser';

const ESTADOS_OBRA_ACTIVOS = new Set(['abierta', 'en_curso']);
const ESTADOS_PRESUPUESTO_ACCION = new Set(['pendiente', 'borrador']);

export type HoyObra = {
  id: string;
  nombre: string;
  cliente_nombre: string | null;
  estado: string | null;
  direccion?: string | null;
};

export type HoyPresupuesto = {
  id: string;
  estado: string | null;
  obra_id: string | null;
  importe_total?: number | null;
  cliente_nombre?: string | null;
  presupuesto_generado?: string | null;
};

export type PartidaVisibleHoy = {
  concepto: string;
  importe: number;
};

export type HoyCta = {
  href: string;
  label: string;
};

function normEstado(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Prefiere la obra seed «Reforma piso»; si no, la primera activa (el caller ordena). */
export function pickObraHoy(obras: HoyObra[]): HoyObra | null {
  const activas = obras.filter((o) => {
    const estado = normEstado(o.estado) || 'abierta';
    return ESTADOS_OBRA_ACTIVOS.has(estado);
  });
  if (activas.length === 0) return null;
  const reforma = activas.find((o) => o.nombre.trim().toLowerCase() === 'reforma piso');
  return reforma ?? activas[0] ?? null;
}

export function pickPresupuestoHoy(
  obra: HoyObra | null,
  presupuestos: HoyPresupuesto[]
): HoyPresupuesto | null {
  if (!obra) return null;
  const deObra = presupuestos.filter((p) => p.obra_id === obra.id);
  const accionable = deObra.find((p) => ESTADOS_PRESUPUESTO_ACCION.has(normEstado(p.estado)));
  return accionable ?? deObra[0] ?? null;
}

export function ctaHoy(obra: HoyObra | null, presupuesto: HoyPresupuesto | null): HoyCta | null {
  if (!obra) return null;
  if (presupuesto) {
    const estado = normEstado(presupuesto.estado);
    const label =
      estado === 'pendiente'
        ? 'Presupuesto de esta obra'
        : estado === 'borrador'
          ? 'Seguir el presupuesto'
          : 'Ver presupuesto';
    return { href: `/presupuestos?id=${encodeURIComponent(presupuesto.id)}`, label };
  }
  return { href: `/obras?id=${encodeURIComponent(obra.id)}`, label: 'Ver ficha de la obra' };
}

export function pickHoy(obras: HoyObra[], presupuestos: HoyPresupuesto[]) {
  const obra = pickObraHoy(obras);
  const presupuesto = pickPresupuestoHoy(obra, presupuestos);
  return { obra, presupuesto, cta: ctaHoy(obra, presupuesto) };
}

/** Calle + barrio/pueblo para la card de presupuesto (p. ej. «Calle Beraun · Errenteria»). */
export function lineaCalleBarrio(direccion: string | null | undefined): string | null {
  if (!direccion?.trim()) return null;
  const parts = direccion
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const calleRaw = parts[0] ?? direccion.trim();
  const calle = calleRaw.replace(/\s+\d+(?:[^\s,]*)?$/, '').trim() || calleRaw;
  const ultimo = parts[parts.length - 1] ?? '';
  const ciudad = ultimo.replace(/^\d{4,5}\s*/, '').trim();
  if (calle && ciudad && calle.toLocaleLowerCase('es') !== ciudad.toLocaleLowerCase('es')) {
    return `${calle} · ${ciudad}`;
  }
  return calle || ciudad || direccion.trim();
}

function etiquetaPartida(raw: string): string {
  const cleaned = raw.replace(/^CAP[IÍ]TULO\s+/i, '').trim();
  if (!cleaned) return raw.trim();
  const lower = cleaned.toLocaleLowerCase('es');
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

function acortarConcepto(concepto: string): string {
  const t = concepto.trim();
  if (t.length <= 36) return t;
  const corte = t.slice(0, 36);
  const lastSpace = corte.lastIndexOf(' ');
  return `${(lastSpace > 12 ? corte.slice(0, lastSpace) : corte).trim()}…`;
}

/** 4–6 partidas del texto `presupuesto_generado` (formato seed / PDF). */
export function partidasVisiblesHoy(
  texto: string | null | undefined,
  max = 6
): PartidaVisibleHoy[] {
  if (!texto?.trim() || max <= 0) return [];
  const parsed = parsePresupuestoGenerado(texto);
  const out: PartidaVisibleHoy[] = [];
  for (const cap of parsed.capitulos) {
    const labelCap = etiquetaPartida(cap.nombre);
    if (cap.partidas.length === 1) {
      out.push({
        concepto: labelCap || acortarConcepto(cap.partidas[0].concepto),
        importe: cap.partidas[0].importe,
      });
    } else {
      for (const p of cap.partidas) {
        out.push({ concepto: acortarConcepto(p.concepto), importe: p.importe });
        if (out.length >= max) break;
      }
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
