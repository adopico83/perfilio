import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { generarTextoCanonico } from '@/lib/presupuestos/texto-canonico';

describe('generarTextoCanonico', () => {
  it('el texto se lee con parsePresupuestoGenerado: mismas partidas, base, IVA y total', () => {
    const r = generarTextoCanonico(
      [
        { concepto: 'Alicatado', cantidad: 15, precio: 50, capitulo: 'COCINA' },
        { concepto: 'Rejuntado', cantidad: 12.5, precio: 3.2, capitulo: 'COCINA' },
        { concepto: 'Demolición de tabique', cantidad: 1, precio: 1234.56, capitulo: 'DEMOLICIONES' },
        { concepto: 'Solado', cantidad: 0.333, precio: 33.33 },
      ],
      21
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const parsed = parsePresupuestoGenerado(r.texto);
    expect(parsed.capitulos.map((c) => c.nombre)).toEqual([
      'CAPÍTULO COCINA',
      'CAPÍTULO DEMOLICIONES',
      'CAPÍTULO GENERAL',
    ]);
    expect(parsed.capitulos.flatMap((c) => c.partidas)).toEqual(
      r.partidas.map((p) => ({
        concepto: p.concepto,
        cantidad: p.cantidad,
        precio: p.precio,
        importe: p.importe,
      }))
    );
    expect(parsed.capitulos[0].total).toBe(790);
    expect(parsed.baseImponible).toBe(r.base);
    expect(parsed.porcentajeIva).toBe(21);
    expect(parsed.importeIva).toBe(r.ivaImporte);
    expect(parsed.total).toBe(r.total);

    expect(r.base).toBe(2035.66);
    expect(r.ivaImporte).toBe(427.49);
    expect(r.total).toBe(2463.15);
  });

  it('importes de miles y decimales sobreviven al ida y vuelta', () => {
    const r = generarTextoCanonico(
      [{ concepto: 'Reforma integral', cantidad: 1, precio: 12345.67 }],
      10
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = parsePresupuestoGenerado(r.texto);
    expect(parsed.capitulos[0].partidas[0].importe).toBe(12345.67);
    expect(parsed.baseImponible).toBe(12345.67);
    expect(parsed.porcentajeIva).toBe(10);
    expect(parsed.total).toBe(r.total);
  });

  it('el concepto no puede romper el formato de línea', () => {
    const r = generarTextoCanonico(
      [{ concepto: 'Puerta | roble\nlacada', cantidad: 2, precio: 100 }],
      21
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = parsePresupuestoGenerado(r.texto);
    expect(parsed.capitulos[0].partidas[0].concepto).toBe('Puerta / roble lacada');
    expect(parsed.capitulos[0].partidas[0].importe).toBe(200);
  });

  it('acepta un importe declarado con 1 céntimo de diferencia', () => {
    const r = generarTextoCanonico(
      [{ concepto: 'Pintura', cantidad: 3, precio: 33.33, importe: 100 }],
      21
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.partidas[0].importe).toBe(99.99);
  });

  it('rechaza un importe distinto de cantidad × precio', () => {
    const r = generarTextoCanonico(
      [
        { concepto: 'Alicatado', cantidad: 15, precio: 50, importe: 750 },
        { concepto: 'Solado', cantidad: 20, precio: 35, importe: 650 },
      ],
      21
    );
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining('Partida 2 («Solado»): el importe 650,00 € no coincide'),
    });
  });

  it.each([
    ['cantidad NaN', { cantidad: Number.NaN, precio: 10 }],
    ['cantidad infinita', { cantidad: Infinity, precio: 10 }],
    ['cantidad negativa', { cantidad: -1, precio: 10 }],
    ['precio NaN', { cantidad: 1, precio: Number.NaN }],
    ['precio infinito', { cantidad: 1, precio: Infinity }],
    ['precio negativo', { cantidad: 1, precio: -10 }],
    ['cantidad no numérica', { cantidad: '3' as unknown as number, precio: 10 }],
  ])('rechaza %s', (_nombre, valores) => {
    const r = generarTextoCanonico([{ concepto: 'Partida', ...valores }], 21);
    expect(r.ok).toBe(false);
  });

  it('rechaza lista vacía, concepto vacío e IVA no entero', () => {
    expect(generarTextoCanonico([], 21).ok).toBe(false);
    expect(generarTextoCanonico([{ concepto: '  ', cantidad: 1, precio: 1 }], 21).ok).toBe(false);
    expect(generarTextoCanonico([{ concepto: 'A', cantidad: 1, precio: 1 }], 10.5).ok).toBe(false);
    expect(generarTextoCanonico([{ concepto: 'A', cantidad: 1, precio: 1 }], Number.NaN).ok).toBe(false);
  });
});
