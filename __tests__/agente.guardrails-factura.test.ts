import { applyPerfilioGuardrails } from '@/lib/agente/guardrails';

describe('guardarraíl de factura desde presupuesto', () => {
  it('convertir_presupuesto_a_factura YA NO se bloquea por no traer «estado» (antes siempre se bloqueaba)', () => {
    for (const args of [{ presupuesto_id: 'x' }, { numero: 7 }, { query: 'Paqui' }]) {
      const r = applyPerfilioGuardrails([{ tool: 'convertir_presupuesto_a_factura', args }], 'hazme la factura');
      expect(r.ok).toBe(true);
    }
  });
  it('sigue cortando un presupuesto que el plan marca como «facturado»', () => {
    const r = applyPerfilioGuardrails(
      [{ tool: 'convertir_presupuesto_a_factura', args: { presupuesto_id: 'x', estado: 'facturado' } }],
      ''
    );
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/ya está en estado «facturado»/);
  });
  it('crear_factura (factura suelta) no se confunde con una factura de presupuesto', () => {
    expect(applyPerfilioGuardrails([{ tool: 'crear_factura', args: { descripcion_trabajos: 'x' } }], '').ok).toBe(true);
    expect(applyPerfilioGuardrails([{ tool: 'crear_factura_rara', args: {} }], '').ok).toBe(true);
  });
  it('el borrado de presupuestos conserva sus reglas', () => {
    expect(applyPerfilioGuardrails([{ tool: 'eliminar_presupuesto', args: {} }], '').ok).toBe(false);
    expect(applyPerfilioGuardrails([{ tool: 'eliminar_presupuesto', args: { estado: 'aceptado' } }], '').ok).toBe(false);
    expect(applyPerfilioGuardrails([{ tool: 'eliminar_presupuesto', args: { estado: 'borrador' } }], '').ok).toBe(true);
  });
});
