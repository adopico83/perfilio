/**
 * Comprobación de COHERENCIA: lo que se va a escribir tiene que ser lo que se enseñó antes del «Sí».
 *
 * Cada función de abajo calcula, con el MISMO código que usa la tool para guardar, lo que se va a escribir, y exige que el resumen
 * mostrado lo diga. Si no coinciden, no se propone y, si ya estaba propuesta, no se ejecuta. (Ronda 9: un extra «95 más IVA»
 * enseñó 114,95 € y guardó 95.)
 */
import { totalExtraConIva } from '@/lib/presupuestos/extra';
import { generarTextoCanonico } from '@/lib/presupuestos/texto-canonico';

export const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const num = (v: unknown): number | null => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const horasTxt = (n: number) => String(n).replace('.', ',');

type Regla = (args: Record<string, unknown>) => Array<{ esperado: string; que: string }>;

const REGLAS: Record<string, Regla> = {
  // Se guarda importe_total = base + 21 %.
  registrar_extra: (a) => {
    const b = num(a.importe);
    return b == null ? [] : [{ esperado: eur(totalExtraConIva(b)), que: 'el total del extra (con IVA)' }];
  },
  crear_factura: (a) => {
    const t = num(a.total);
    return t == null ? [] : [{ esperado: eur(t), que: 'el total de la factura' }];
  },
  registrar_gasto_ticket: (a) => {
    const t = num(a.importe_total);
    return t == null ? [] : [{ esperado: eur(t), que: 'el total del gasto' }];
  },
  registrar_jornada: (a) => {
    const h = num(a.horas_reales);
    return h == null ? [] : [{ esperado: `${horasTxt(h)} h`, que: 'las horas' }];
  },
  generar_presupuesto_por_dictado: (a) => {
    const ps = Array.isArray(a.partidas_resueltas) ? (a.partidas_resueltas as Array<Record<string, unknown>>) : [];
    if (!ps.length) return [];
    // El mismo cálculo que usa la tool para guardar el total.
    const canon = generarTextoCanonico(ps.map((p) => ({ concepto: String(p.descripcion ?? ''), cantidad: Number(p.cantidad), precio: Number(p.precio_unitario) })), 21);
    return canon.ok ? [{ esperado: eur(canon.total), que: 'el total del presupuesto' }] : [];
  },
  crear_recordatorio: (a) => [
    ...(typeof a.fecha === 'string' ? [{ esperado: a.fecha, que: 'la fecha' }] : []),
    ...(typeof a.hora === 'string' ? [{ esperado: a.hora, que: 'la hora' }] : []),
  ],
  modificar_evento_agenda: (a) => [
    ...(typeof a.nueva_fecha === 'string' ? [{ esperado: a.nueva_fecha, que: 'la nueva fecha' }] : []),
    ...(typeof a.nueva_hora === 'string' ? [{ esperado: a.nueva_hora, que: 'la nueva hora' }] : []),
  ],
};

/** null si lo que se va a escribir coincide con lo mostrado; si no, el motivo. */
export function comprobarCoherencia(tool: string, args: Record<string, unknown>, resumen: string): string | null {
  const regla = REGLAS[tool];
  if (!regla) return null;
  const texto = resumen.toLowerCase();
  for (const r of regla(args)) {
    if (!texto.includes(r.esperado.toLowerCase())) return `Lo que se iba a guardar (${r.que}: ${r.esperado}) no coincide con lo que te enseñé.`;
  }
  return null;
}
