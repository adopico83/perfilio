import type { SupabaseClient } from '@supabase/supabase-js';
import * as z from 'zod/v4';
import type { LineaFactura } from '@/lib/facturas/desde-presupuesto';

/** IVA que se puede elegir al editar una factura. */
export const IVA_PORCENTAJES_PERMITIDOS = [0, 4, 10, 21] as const;
const IVA_POR_DEFECTO = 21;

const redondear = (n: number) => Math.round(n * 100) / 100;

export const editarFacturaSchema = z.object({
  cliente_nombre: z
    .string({ error: 'El cliente es obligatorio' })
    .trim()
    .min(1, 'El cliente no puede estar vacío')
    .max(255, 'El nombre del cliente es demasiado largo (máximo 255 caracteres)'),
  lineas: z
    .array(
      z.object({
        descripcion: z.string().trim().min(1, 'Cada línea necesita una descripción'),
        cantidad: z.number({ error: 'La cantidad debe ser un número' }).gt(0, 'La cantidad debe ser mayor que 0'),
        precio_unitario: z
          .number({ error: 'El precio debe ser un número' })
          .min(0, 'El precio no puede ser negativo'),
        unidad: z.string().trim().max(20).nullish(),
        capitulo: z.string().trim().max(255).nullish(),
      }),
      { error: 'Hacen falta las líneas de la factura' }
    )
    .min(1, 'La factura necesita al menos una línea')
    .max(200, 'Demasiadas líneas (máximo 200)'),
  iva_porcentaje: z
    .number()
    .refine((n) => (IVA_PORCENTAJES_PERMITIDOS as readonly number[]).includes(n), {
      message: `El IVA debe ser uno de: ${IVA_PORCENTAJES_PERMITIDOS.join(', ')}`,
    })
    .optional(),
});

export type EditarFacturaInput = z.input<typeof editarFacturaSchema>;

export type FacturaEditada = {
  id: string;
  business_id: string;
  numero_factura: number | string | null;
  cliente_nombre: string | null;
  descripcion_trabajos: string | null;
  lineas: LineaFactura[];
  base_imponible: number;
  iva: number;
  total: number;
  estado: string | null;
};

export type ResultadoEdicion =
  | { ok: true; factura: FacturaEditada }
  | { ok: false; code: 'validacion' | 'no_encontrada' | 'no_editable' | 'error'; error: string };

/** Mensaje en español a partir de los fallos de zod («lineas.0.cantidad: …»). */
export function mensajeValidacion(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const ruta = i.path.length ? `${i.path.join('.')}: ` : '';
      return `${ruta}${i.message}`;
    })
    .join('; ');
}

/** Texto legible de las líneas (es lo que se ve en listados; el PDF usa `lineas`). */
export function descripcionLegible(lineas: LineaFactura[]): string {
  return lineas
    .map(
      (l) =>
        `${l.descripcion} — ${l.cantidad} ${l.unidad ?? 'ud'} × ${l.precio_unitario} € = ${l.importe.toFixed(2)} €`
    )
    .join('\n');
}

/**
 * Edita una factura de un negocio. El servidor calcula TODOS los importes: del cliente solo se
 * fía de cantidades, precios y del % de IVA (que debe estar en la lista permitida).
 * Solo se pueden editar facturas pendientes (una pagada/vencida ya se ha cobrado o reclamado).
 */
export async function actualizarFactura(
  supabase: SupabaseClient,
  businessId: string,
  facturaId: string,
  input: unknown
): Promise<ResultadoEdicion> {
  const parsed = editarFacturaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'validacion', error: mensajeValidacion(parsed.error) };
  }
  const datos = parsed.data;

  const { data: actual, error: errLeer } = await supabase
    .from('facturas')
    .select('id, estado, base_imponible, iva')
    .eq('id', facturaId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (errLeer) return { ok: false, code: 'error', error: errLeer.message };
  if (!actual) return { ok: false, code: 'no_encontrada', error: 'Factura no encontrada' };

  const estado = (actual as { estado?: string | null }).estado ?? 'pendiente';
  if (estado !== 'pendiente') {
    return {
      ok: false,
      code: 'no_editable',
      error: `Solo se pueden editar facturas pendientes; esta está «${estado}».`,
    };
  }

  // Sin iva_porcentaje se conserva el que ya tenía la factura (iva / base), o 21 si no se puede saber.
  let pct = datos.iva_porcentaje;
  if (pct === undefined) {
    const baseActual = Number((actual as { base_imponible?: unknown }).base_imponible);
    const ivaActual = Number((actual as { iva?: unknown }).iva);
    pct =
      Number.isFinite(baseActual) && Number.isFinite(ivaActual) && baseActual > 0
        ? Math.round((ivaActual / baseActual) * 1000) / 10
        : IVA_POR_DEFECTO;
  }

  const lineas: LineaFactura[] = datos.lineas.map((l) => ({
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    unidad: l.unidad?.trim() || null,
    precio_unitario: l.precio_unitario,
    importe: redondear(l.cantidad * l.precio_unitario),
    capitulo: l.capitulo?.trim() || null,
  }));
  const base = redondear(lineas.reduce((s, l) => s + l.importe, 0));
  const iva = redondear((base * pct) / 100);
  const total = redondear(base + iva);

  const { data: guardada, error: errGuardar } = await supabase
    .from('facturas')
    .update({
      cliente_nombre: datos.cliente_nombre,
      lineas,
      descripcion_trabajos: descripcionLegible(lineas),
      base_imponible: base,
      iva,
      total,
    })
    .eq('id', facturaId)
    .eq('business_id', businessId)
    .select(
      'id, business_id, numero_factura, cliente_nombre, descripcion_trabajos, lineas, base_imponible, iva, total, estado'
    )
    .maybeSingle();
  if (errGuardar) return { ok: false, code: 'error', error: errGuardar.message };
  if (!guardada) return { ok: false, code: 'no_encontrada', error: 'Factura no encontrada' };

  return { ok: true, factura: guardada as unknown as FacturaEditada };
}
