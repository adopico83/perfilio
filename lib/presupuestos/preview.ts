/**
 * Previsualización de un presupuesto antes de confirmarlo: agrupa capítulos y
 * partidas, delega el cálculo de base/IVA/total en `generarTextoCanonico`
 * (mismo redondeo por línea) y reporta avisos de negocio sin bloquear salvo
 * que falte precio en alguna partida.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TOLERANCIA_IMPORTE,
  generarTextoCanonico,
  type PartidaCanonicaEntrada,
} from '@/lib/presupuestos/texto-canonico';
import { insertarPresupuestoConNumeroCorrelativo } from '@/lib/presupuestos/numero';

const MAX_PARTIDAS = 100;

export type PartidaPreviewEntrada = {
  descripcion: string;
  cantidad: number;
  unidad?: string;
  precio_unitario?: number;
  importe_declarado?: number;
};

export type CapituloPreviewEntrada = {
  nombre?: string;
  partidas: PartidaPreviewEntrada[];
};

export type PreviewPresupuestoInput = {
  cliente_nombre: string;
  obra_id?: string | null;
  iva_porcentaje?: number; // default 21
  observaciones?: string;
  capitulos: CapituloPreviewEntrada[];
  total_declarado?: number;
};

export type AvisoPreview =
  | { tipo: 'falta_cliente' }
  | { tipo: 'sin_obra' }
  | { tipo: 'falta_precio'; partida: number; descripcion: string }
  | { tipo: 'importe_corregido'; partida: number; declarado: number; calculado: number }
  | { tipo: 'total_corregido'; declarado: number; calculado: number };

export type PartidaPreviewSalida = {
  n: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio: number | null;
  importe: number | null;
};

export type CapituloPreviewSalida = {
  nombre: string;
  partidas: PartidaPreviewSalida[];
  subtotal: number | null;
};

export type PreviewPresupuesto = {
  confirmable: boolean;
  avisos: AvisoPreview[];
  capitulos: CapituloPreviewSalida[];
  base_imponible: number | null;
  iva_importe: number | null;
  total: number | null;
  texto_canonico: string | null;
};

export type ResultadoPreviewPresupuesto =
  | ({ ok: true } & PreviewPresupuesto)
  | { ok: false; error: string };

type PartidaAplanada = {
  capituloIdx: number;
  capituloNombre: string;
  entrada: PartidaPreviewEntrada;
  precioValido: number | null;
};

export function calcularPreviewPresupuesto(
  input: PreviewPresupuestoInput
): ResultadoPreviewPresupuesto {
  if (typeof input.cliente_nombre !== 'string') {
    return { ok: false, error: 'cliente_nombre debe ser una cadena de texto.' };
  }
  if (!Array.isArray(input.capitulos)) {
    return { ok: false, error: 'capitulos debe ser una lista.' };
  }

  const ivaPct = input.iva_porcentaje === undefined ? 21 : input.iva_porcentaje;

  // Aplanamos manteniendo el capítulo de origen (orden de primera aparición,
  // 'GENERAL' si no se informó), igual criterio que usa generarTextoCanonico.
  const aplanadas: PartidaAplanada[] = [];
  const nombresCapitulo: string[] = [];
  input.capitulos.forEach((cap, capituloIdx) => {
    const nombre = (cap.nombre ?? '').trim() || 'GENERAL';
    nombresCapitulo.push(nombre);
    for (const entrada of cap.partidas ?? []) {
      const precioValido =
        typeof entrada.precio_unitario === 'number' &&
        Number.isFinite(entrada.precio_unitario) &&
        entrada.precio_unitario >= 0
          ? entrada.precio_unitario
          : null;
      aplanadas.push({ capituloIdx, capituloNombre: nombre, entrada, precioValido });
    }
  });

  if (aplanadas.length < 1 || aplanadas.length > MAX_PARTIDAS) {
    return {
      ok: false,
      error: `El número de partidas debe estar entre 1 y ${MAX_PARTIDAS} (recibidas: ${aplanadas.length}).`,
    };
  }

  const avisos: AvisoPreview[] = [];
  if (input.cliente_nombre.trim() === '') {
    avisos.push({ tipo: 'falta_cliente' });
  }
  if (input.obra_id === undefined || input.obra_id === null) {
    avisos.push({ tipo: 'sin_obra' });
  }

  const faltanPrecio = aplanadas
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.precioValido === null);

  if (faltanPrecio.length > 0) {
    for (const { p, i } of faltanPrecio) {
      avisos.push({ tipo: 'falta_precio', partida: i, descripcion: p.entrada.descripcion });
    }

    // Sin precio en todas las partidas no se puede calcular base/IVA/total ni
    // el texto canónico; se devuelven los capítulos tal cual para que el
    // humano vea qué falta, con precio/importe a null donde no hay dato.
    const capitulos = agruparSalida(
      aplanadas.map((p, i) => ({
        n: i + 1,
        descripcion: p.entrada.descripcion,
        cantidad: p.entrada.cantidad,
        unidad: p.entrada.unidad ?? null,
        precio: p.precioValido,
        importe: null,
      })),
      nombresCapitulo,
      aplanadas.map((p) => p.capituloIdx)
    );

    return {
      ok: true,
      confirmable: false,
      avisos,
      capitulos,
      base_imponible: null,
      iva_importe: null,
      total: null,
      texto_canonico: null,
    };
  }

  const partidasCanonicas: PartidaCanonicaEntrada[] = aplanadas.map((p) => ({
    concepto: p.entrada.descripcion,
    cantidad: p.entrada.cantidad,
    precio: p.precioValido as number,
    capitulo: p.capituloNombre,
  }));

  const resultado = generarTextoCanonico(partidasCanonicas, ivaPct);
  if (!resultado.ok) {
    return { ok: false, error: resultado.error };
  }

  resultado.partidas.forEach((partidaCalculada, i) => {
    const declarado = aplanadas[i].entrada.importe_declarado;
    if (
      declarado !== undefined &&
      Math.abs(declarado - partidaCalculada.importe) > TOLERANCIA_IMPORTE + 1e-9
    ) {
      avisos.push({
        tipo: 'importe_corregido',
        partida: i,
        declarado,
        calculado: partidaCalculada.importe,
      });
    }
  });

  if (
    input.total_declarado !== undefined &&
    Math.abs(input.total_declarado - resultado.total) > TOLERANCIA_IMPORTE + 1e-9
  ) {
    avisos.push({
      tipo: 'total_corregido',
      declarado: input.total_declarado,
      calculado: resultado.total,
    });
  }

  const capitulos = agruparSalida(
    resultado.partidas.map((partidaCalculada, i) => ({
      n: i + 1,
      descripcion: partidaCalculada.concepto,
      cantidad: partidaCalculada.cantidad,
      unidad: aplanadas[i].entrada.unidad ?? null,
      precio: partidaCalculada.precio,
      importe: partidaCalculada.importe,
    })),
    nombresCapitulo,
    aplanadas.map((p) => p.capituloIdx)
  );

  return {
    ok: true,
    // Solo falta_precio bloquea la confirmación: falta_cliente, sin_obra,
    // importe_corregido y total_corregido son avisos informativos.
    confirmable: true,
    avisos,
    capitulos,
    base_imponible: resultado.base,
    iva_importe: resultado.ivaImporte,
    total: resultado.total,
    texto_canonico: resultado.texto,
  };
}

/**
 * Reagrupa una lista plana de partidas de salida en capítulos, respetando el
 * orden de primera aparición del nombre de capítulo (mismo criterio que
 * generarTextoCanonico). `capituloIdxPorPartida[i]` es el índice del capítulo
 * de entrada del que proviene la partida i.
 */
function agruparSalida(
  partidas: PartidaPreviewSalida[],
  nombresCapitulo: string[],
  capituloIdxPorPartida: number[]
): CapituloPreviewSalida[] {
  const orden: string[] = [];
  const porNombre = new Map<string, PartidaPreviewSalida[]>();

  partidas.forEach((partida, i) => {
    const nombre = nombresCapitulo[capituloIdxPorPartida[i]] ?? 'GENERAL';
    if (!porNombre.has(nombre)) {
      porNombre.set(nombre, []);
      orden.push(nombre);
    }
    porNombre.get(nombre)!.push(partida);
  });

  return orden.map((nombre) => {
    const partidasCap = porNombre.get(nombre)!;
    const importes = partidasCap.map((p) => p.importe);
    const subtotal = importes.every((imp) => imp !== null)
      ? Math.round(
          (importes.reduce((s: number, imp) => s + (imp as number), 0) + Number.EPSILON) * 100
        ) / 100
      : null;
    return { nombre, partidas: partidasCap, subtotal };
  });
}

const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

/** Aplana los capítulos de salida a partidas aptas para volver a pasar por generarTextoCanonico. */
function aplanarParaGuardar(capitulos: CapituloPreviewSalida[]): Array<{
  concepto: string;
  cantidad: number;
  precio: number | null;
  capitulo: string;
  unidad: string | null;
}> {
  const partidas: Array<{
    concepto: string;
    cantidad: number;
    precio: number | null;
    capitulo: string;
    unidad: string | null;
  }> = [];
  for (const capitulo of capitulos) {
    for (const partida of capitulo.partidas) {
      partidas.push({
        concepto: partida.descripcion,
        cantidad: partida.cantidad,
        precio: partida.precio,
        capitulo: capitulo.nombre,
        unidad: partida.unidad,
      });
    }
  }
  return partidas;
}

/**
 * Guarda una previsualización confirmable en `presupuesto_previews`, lista
 * para que `confirmarPreviewPresupuesto` la recalcule y la convierta en un
 * presupuesto real. No debe llamarse con un cálculo no confirmable: es una
 * defensa, el llamador ya debería haberlo comprobado.
 */
export async function guardarPreviewPresupuesto(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  input: PreviewPresupuestoInput,
  calculo: PreviewPresupuesto,
  now: Date
): Promise<{ ok: true; previewId: string; expiresAt: string } | { ok: false; error: string }> {
  if (!calculo.confirmable) {
    return { ok: false, error: 'La previsualización no es confirmable, no se puede guardar.' };
  }

  const partidas = aplanarParaGuardar(calculo.capitulos);
  const expiresAt = new Date(now.getTime() + VEINTICUATRO_HORAS_MS).toISOString();

  const { data, error } = await supabase
    .from('presupuesto_previews')
    .insert({
      business_id: businessId,
      creado_por: userId,
      cliente_nombre: input.cliente_nombre,
      obra_id: input.obra_id ?? null,
      iva_porcentaje: input.iva_porcentaje ?? 21,
      partidas,
      texto_canonico: calculo.texto_canonico,
      base_imponible: calculo.base_imponible,
      iva_importe: calculo.iva_importe,
      total: calculo.total,
      avisos: calculo.avisos,
      observaciones: input.observaciones ?? null,
      estado: 'pendiente',
      expires_at: expiresAt,
      created_at: now.toISOString(),
    })
    .select('id, expires_at')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo guardar la previsualización.' };
  }

  return {
    ok: true,
    previewId: (data as { id: string }).id,
    expiresAt: (data as { expires_at: string }).expires_at,
  };
}

/** YYYY-MM-DD en Europe/Madrid a partir de `now` (determinista para tests). */
function ymdMadrid(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

type PreviewRowLeida = {
  id: string;
  business_id: string;
  cliente_nombre: string;
  obra_id: string | null;
  iva_porcentaje: number;
  partidas: PartidaCanonicaEntrada[];
  texto_canonico: string;
  base_imponible: number | null;
  iva_importe: number | null;
  total: number;
  observaciones: string | null;
  estado: string;
  presupuesto_id: string | null;
  expires_at: string;
};

async function revertirAPendiente(supabase: SupabaseClient, previewId: string): Promise<void> {
  await supabase
    .from('presupuesto_previews')
    .update({ estado: 'pendiente' })
    .eq('id', previewId)
    .select('id')
    .maybeSingle();
}

/**
 * Confirma una previsualización ya guardada: la reclama atómicamente, recalcula
 * desde las partidas guardadas (nunca desde un total aportado por el modelo) y
 * crea el presupuesto definitivo con numeración correlativa. Confirmar la misma
 * previsualización dos veces es idempotente: devuelve el presupuesto ya creado.
 */
export async function confirmarPreviewPresupuesto(
  supabase: SupabaseClient,
  businessId: string,
  previewId: string,
  now: Date
): Promise<
  | {
      ok: true;
      presupuestoId: string;
      numeroPresupuesto: number;
      clienteNombre: string;
      baseImponible: number | null;
      ivaImporte: number | null;
      total: number;
      estado: string;
      fecha: string;
    }
  | { ok: false; code: 'no_encontrado' | 'preview_ajena' | 'preview_caducada' | 'en_curso' | 'validacion'; error: string }
> {
  const { data: rowData, error: readError } = await supabase
    .from('presupuesto_previews')
    .select('*')
    .eq('id', previewId)
    .maybeSingle();

  if (readError || !rowData) {
    return { ok: false, code: 'no_encontrado', error: 'No se encontró la previsualización.' };
  }
  const row = rowData as unknown as PreviewRowLeida;

  if (row.business_id !== businessId) {
    return { ok: false, code: 'preview_ajena', error: 'Esta previsualización no pertenece a este negocio.' };
  }

  if (row.estado === 'confirmado') {
    const { data: presData, error: presError } = await supabase
      .from('presupuestos')
      .select('id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha')
      .eq('id', row.presupuesto_id)
      .maybeSingle();
    if (presError || !presData) {
      return { ok: false, code: 'validacion', error: 'No se pudo releer el presupuesto ya confirmado.' };
    }
    const pres = presData as {
      id: string;
      numero_presupuesto: number;
      cliente_nombre: string;
      importe_total: number;
      estado: string;
      fecha: string;
    };
    return {
      ok: true,
      presupuestoId: pres.id,
      numeroPresupuesto: pres.numero_presupuesto,
      clienteNombre: pres.cliente_nombre,
      baseImponible: row.base_imponible,
      ivaImporte: row.iva_importe,
      total: pres.importe_total,
      estado: pres.estado,
      fecha: pres.fecha,
    };
  }

  if (new Date(row.expires_at).getTime() < now.getTime()) {
    return { ok: false, code: 'preview_caducada', error: 'La previsualización ha caducado, pide una nueva.' };
  }

  const { data: claimData, error: claimError } = await supabase
    .from('presupuesto_previews')
    .update({ estado: 'confirmando' })
    .eq('id', previewId)
    .eq('business_id', businessId)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle();

  if (claimError || !claimData) {
    return { ok: false, code: 'en_curso', error: 'Otra confirmación de esta previsualización está en curso.' };
  }

  const recalculo = generarTextoCanonico(row.partidas, row.iva_porcentaje);
  if (!recalculo.ok || Math.abs(recalculo.total - row.total) > TOLERANCIA_IMPORTE + 1e-9) {
    await revertirAPendiente(supabase, previewId);
    return {
      ok: false,
      code: 'validacion',
      error: 'La previsualización no se pudo recalcular; pide una nueva.',
    };
  }

  const fecha = ymdMadrid(now);
  const presupuestoGenerado =
    row.texto_canonico + (row.observaciones ? `\n\nObservaciones: ${row.observaciones}` : '');

  const creado = await insertarPresupuestoConNumeroCorrelativo(
    supabase,
    businessId,
    {
      cliente_nombre: row.cliente_nombre,
      presupuesto_generado: presupuestoGenerado,
      importe_total: row.total,
      fecha,
      estado: 'borrador',
      ...(row.obra_id ? { obra_id: row.obra_id } : {}),
    },
    'id, numero_presupuesto, cliente_nombre, importe_total, estado, fecha'
  );

  if (!creado.ok) {
    await revertirAPendiente(supabase, previewId);
    return { ok: false, code: 'validacion', error: creado.error };
  }

  const presupuesto = creado.data as {
    id: string;
    numero_presupuesto: number;
    cliente_nombre: string;
    importe_total: number;
    estado: string;
    fecha: string;
  };

  await supabase
    .from('presupuesto_previews')
    .update({ estado: 'confirmado', presupuesto_id: presupuesto.id, confirmed_at: now.toISOString() })
    .eq('id', previewId)
    .select('id')
    .maybeSingle();

  return {
    ok: true,
    presupuestoId: presupuesto.id,
    numeroPresupuesto: presupuesto.numero_presupuesto,
    clienteNombre: row.cliente_nombre,
    baseImponible: row.base_imponible,
    ivaImporte: row.iva_importe,
    total: row.total,
    estado: 'borrador',
    fecha,
  };
}
