import { calcularPreviewPresupuesto } from '@/lib/presupuestos/preview';

describe('calcularPreviewPresupuesto', () => {
  it('IVA 21%: calcula base, IVA y total sin avisos bloqueantes', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [
        {
          partidas: [{ descripcion: 'Alicatado', cantidad: 20, precio_unitario: 35 }],
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confirmable).toBe(true);
    expect(r.base_imponible).toBe(700);
    expect(r.iva_importe).toBe(147);
    expect(r.total).toBe(847);
    expect(r.avisos.some((a) => a.tipo === 'falta_precio')).toBe(false);
    expect(r.avisos.some((a) => a.tipo === 'importe_corregido')).toBe(false);
    expect(r.avisos.some((a) => a.tipo === 'total_corregido')).toBe(false);
  });

  it('IVA 10%: importes de miles y decimales', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 10,
      capitulos: [
        {
          partidas: [{ descripcion: 'Reforma integral', cantidad: 1, precio_unitario: 12345.67 }],
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base_imponible).toBe(12345.67);
    expect(r.iva_importe).toBe(1234.57);
    expect(r.total).toBe(13580.24);
  });

  it('decimales y redondeo por línea', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [
        {
          partidas: [
            { descripcion: 'A', cantidad: 2.75, precio_unitario: 18.4 },
            { descripcion: 'B', cantidad: 3, precio_unitario: 33.33 },
          ],
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const partidas = r.capitulos.flatMap((c) => c.partidas);
    expect(partidas[0].importe).toBe(50.6);
    expect(partidas[1].importe).toBe(99.99);
    expect(r.base_imponible).toBe(150.59);
    expect(r.iva_importe).toBe(31.62);
    expect(r.total).toBe(182.21);
  });

  it('redondeo por línea antes de sumar (caso crítico)', () => {
    const partidaRepetida = { descripcion: 'C', cantidad: 0.5, precio_unitario: 0.03 };
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [{ partidas: [partidaRepetida, partidaRepetida, partidaRepetida] }],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const partidas = r.capitulos.flatMap((c) => c.partidas);
    expect(partidas[0].importe).toBe(0.02);
    expect(partidas[1].importe).toBe(0.02);
    expect(partidas[2].importe).toBe(0.02);
    // Cada línea redondea 0.5*0.03=0.015 a 0.02 antes de sumar: 0.02*3=0.06,
    // no 0.05 (que sería sumar en bruto 3*0.015=0.045 y redondear al final).
    expect(r.base_imponible).toBe(0.06);
  });

  it('importe_declarado y total_declarado erróneos generan avisos pero usan los valores calculados', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      total_declarado: 900,
      capitulos: [
        {
          partidas: [
            {
              descripcion: 'Alicatado',
              cantidad: 20,
              precio_unitario: 35,
              importe_declarado: 750,
            },
          ],
        },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base_imponible).toBe(700);
    expect(r.total).toBe(847);
    expect(
      r.avisos.some(
        (a) => a.tipo === 'importe_corregido' && a.declarado === 750 && a.calculado === 700
      )
    ).toBe(true);
    expect(
      r.avisos.some(
        (a) => a.tipo === 'total_corregido' && a.declarado === 900 && a.calculado === 847
      )
    ).toBe(true);
  });

  it('partida sin precio: no confirmable, aviso falta_precio', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [{ partidas: [{ descripcion: 'Sin precio', cantidad: 5 }] }],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confirmable).toBe(false);
    expect(r.avisos.some((a) => a.tipo === 'falta_precio')).toBe(true);
    expect(r.base_imponible).toBeNull();
    expect(r.iva_importe).toBeNull();
    expect(r.total).toBeNull();
  });

  it('rechaza 0 partidas en total', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [{ partidas: [] }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(typeof r.error).toBe('string');
  });

  it('rechaza más de 100 partidas en total', () => {
    const muchas = Array.from({ length: 101 }, (_, i) => ({
      descripcion: `Partida ${i}`,
      cantidad: 1,
      precio_unitario: 1,
    }));
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [{ partidas: muchas }],
    });
    expect(r.ok).toBe(false);
  });

  it('rechaza cliente_nombre de tipo incorrecto', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 123 as unknown as string,
      iva_porcentaje: 21,
      capitulos: [{ partidas: [{ descripcion: 'A', cantidad: 1, precio_unitario: 1 }] }],
    });
    expect(r.ok).toBe(false);
  });

  it('cliente_nombre vacío: aviso falta_cliente, no bloquea confirmable', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: '   ',
      iva_porcentaje: 21,
      capitulos: [{ partidas: [{ descripcion: 'A', cantidad: 1, precio_unitario: 1 }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisos.some((a) => a.tipo === 'falta_cliente')).toBe(true);
    expect(r.confirmable).toBe(true);
  });

  it('obra_id ausente: aviso sin_obra, no bloquea confirmable', () => {
    const r = calcularPreviewPresupuesto({
      cliente_nombre: 'Juan',
      iva_porcentaje: 21,
      capitulos: [{ partidas: [{ descripcion: 'A', cantidad: 1, precio_unitario: 1 }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisos.some((a) => a.tipo === 'sin_obra')).toBe(true);
    expect(r.confirmable).toBe(true);
  });
});
