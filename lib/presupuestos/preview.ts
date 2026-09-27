/**
 * Previsualización de un presupuesto antes de confirmarlo: agrupa capítulos y
 * partidas, delega el cálculo de base/IVA/total en `generarTextoCanonico`
 * (mismo redondeo por línea) y reporta avisos de negocio sin bloquear salvo
 * que falte precio en alguna partida.
 */

import {
  TOLERANCIA_IMPORTE,
  generarTextoCanonico,
  type PartidaCanonicaEntrada,
} from '@/lib/presupuestos/texto-canonico';

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
