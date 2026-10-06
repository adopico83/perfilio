import { ivaPermitidoMasCercano, ivaPorcentajeDeFactura } from '@/lib/facturas/iva';
import { actualizarFactura } from '@/lib/facturas/editar';
import { ivaPorcentajeInicial } from '@/components/facturas/invoice-editor';
import { crearFakeDb, type Fila } from './helpers/fake-db';

describe('ivaPermitidoMasCercano', () => {
  it.each([
    [20.9, 21], [9.96, 10], [4.2, 4], [0, 0], [15.5, 21], [2, 4], [7, 10], [Number.NaN, 21], [Infinity, 21],
  ])('%s → %s', (entrada, esperado) => expect(ivaPermitidoMasCercano(entrada)).toBe(esperado));

  it('la factura al 10 % con céntimos que dan 9,9 abre el editor con 10 (no con 21)', () => {
    expect(ivaPorcentajeDeFactura(333.33, 33.0)).toBe(10); // 9,90 %
    expect(ivaPorcentajeInicial({ base_imponible: 333.33, iva: 33.0 })).toBe(10);
    expect(ivaPorcentajeInicial({ base_imponible: null, iva: null })).toBe(21);
  });
});

describe('actualizarFactura con IVA deducido o carrera de estado', () => {
  const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
  const lineas = [{ descripcion: 'Obra', cantidad: 1, precio_unitario: 1000 }];
  const fac = (extra: Fila = {}): Fila => ({ id: 'f1', business_id: BIZ, estado: 'pendiente', base_imponible: 333.33, iva: 33.0, total: 366.33, ...extra });

  it('sin iva_porcentaje usa el permitido más cercano (9,9 → 10), no 9,9', async () => {
    const d = crearFakeDb({ facturas: [fac()] });
    await actualizarFactura(d.client, BIZ, 'f1', { cliente_nombre: 'Ana', lineas });
    expect(d.tablas.facturas[0]).toMatchObject({ iva: 100, total: 1100 });
  });

  it('el update filtra también por estado pendiente', async () => {
    const d = crearFakeDb({ facturas: [fac()] });
    await actualizarFactura(d.client, BIZ, 'f1', { cliente_nombre: 'Ana', lineas });
    expect(d.updates[0].filtros).toEqual(expect.arrayContaining([['estado', 'pendiente']]));
  });

  it('si el estado cambia entre la lectura y la escritura → no_editable con el estado actual', async () => {
    const d = crearFakeDb({ facturas: [fac()] });
    // Justo antes del update otra petición la marca pagada: se simula en el primer select posterior a la lectura.
    const original = d.tablas.facturas[0];
    let lecturas = 0;
    const from = (d.client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    const client = {
      ...d.client,
      from: (t: string) => {
        const q = from(t) as { update: (v: Fila) => unknown };
        const upd = q.update.bind(q);
        q.update = (v: Fila) => {
          lecturas += 1;
          original.estado = 'pagada'; // cambia ANTES de aplicar el update
          return upd(v);
        };
        return q;
      },
    } as never;
    const r = await actualizarFactura(client, BIZ, 'f1', { cliente_nombre: 'Ana', lineas });
    expect(lecturas).toBe(1);
    expect(r).toMatchObject({ ok: false, code: 'no_editable' });
    expect((r as { error: string }).error).toContain('pagada');
    expect(original.cliente_nombre).toBeUndefined(); // no se escribió nada
  });
});
