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
