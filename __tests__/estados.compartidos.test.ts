import { ESTADOS_FACTURA, parseEstadoFactura, cambiarEstadoFactura } from '@/lib/facturas/estado';
import { cambiarEstadoAlbaran, ESTADOS_ALBARAN_EDITABLES } from '@/lib/albaranes/estado';
import { REGLAS_GENERALES } from '@/lib/agente/prompt-sistema';
import { crearFakeDb } from './helpers/fake-db';

const BIZ = 'biz-1';

describe('estados de factura (una sola regla para la API y el agente)', () => {
  it('solo pendiente | pagada | vencida; «pagado» y «cobrada» son pagada', () => {
    expect([...ESTADOS_FACTURA]).toEqual(['pendiente', 'pagada', 'vencida']);
    expect(parseEstadoFactura('pagado')).toBe('pagada');
    expect(parseEstadoFactura(' Cobrada ')).toBe('pagada');
    expect(parseEstadoFactura('vencido')).toBe('vencida');
    for (const raro of ['aceptado', 'facturado', '', null, undefined, 3]) expect(parseEstadoFactura(raro)).toBeNull();
  });
  it('cambiarEstadoFactura filtra por negocio y valida', async () => {
    const d = crearFakeDb({ facturas: [{ id: 'f1', business_id: BIZ, estado: 'pendiente' }, { id: 'f2', business_id: 'otro', estado: 'pendiente' }] });
    expect(await cambiarEstadoFactura(d.client, BIZ, 'f1', 'pagado')).toEqual({ ok: true, id: 'f1', estado: 'pagada' });
    expect(await cambiarEstadoFactura(d.client, BIZ, 'f2', 'pagada')).toMatchObject({ ok: false, code: 'no_encontrado' });
    expect(await cambiarEstadoFactura(d.client, BIZ, 'f1', 'aceptado')).toMatchObject({ ok: false, code: 'validacion' });
    expect(d.tablas.facturas[1].estado).toBe('pendiente');
  });
});

describe('estados de albarán', () => {
  it('solo pendiente | entregado, y «facturado» pide factura', async () => {
    expect([...ESTADOS_ALBARAN_EDITABLES]).toEqual(['pendiente', 'entregado']);
    const d = crearFakeDb({ albaranes: [{ id: 'a1', business_id: BIZ, estado: 'pendiente' }] });
    expect(await cambiarEstadoAlbaran(d.client, BIZ, 'a1', 'facturado')).toMatchObject({ ok: false, code: 'validacion' });
    expect(await cambiarEstadoAlbaran(d.client, BIZ, 'a1', 'entregado')).toMatchObject({ ok: true });
    expect(d.tablas.albaranes[0].estado).toBe('entregado');
  });
});

describe('prompt del agente', () => {
  it('menciona el resumen del día, los estados válidos y no inventar importes', () => {
    expect(REGLAS_GENERALES).toContain('resumen_del_dia');
    expect(REGLAS_GENERALES).toContain('pendiente, pagada o vencida');
    expect(REGLAS_GENERALES).toMatch(/Nunca inventes un importe, un cliente ni un id/);
  });
});
