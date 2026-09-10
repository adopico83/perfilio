import { ctaHoy, pickHoy, pickObraHoy, pickPresupuestoHoy } from '@/lib/hoy';

const obraReforma = {
  id: 'obra-1',
  nombre: 'Reforma piso',
  cliente_nombre: 'Ainhoa Etxeberria',
  estado: 'abierta',
  direccion: 'Calle Beraun, Errenteria',
};

const obraOtra = {
  id: 'obra-2',
  nombre: 'Local comercial',
  cliente_nombre: 'Iker Agirre',
  estado: 'abierta',
};

const presPendiente = {
  id: 'pre-1',
  estado: 'pendiente',
  obra_id: 'obra-1',
  importe_total: 11803.55,
};

describe('pickHoy', () => {
  it('prefiere la obra Reforma piso y el presupuesto pendiente', () => {
    const hoy = pickHoy([obraOtra, obraReforma], [
      { id: 'pre-x', estado: 'aceptado', obra_id: 'obra-2' },
      presPendiente,
    ]);
    expect(hoy.obra?.id).toBe('obra-1');
    expect(hoy.presupuesto?.id).toBe('pre-1');
    expect(hoy.cta).toEqual({
      href: '/presupuestos?id=pre-1',
      label: 'Presupuesto de esta obra',
    });
  });

  it('ignora obras cerradas', () => {
    expect(pickObraHoy([{ ...obraReforma, estado: 'cerrada' }])).toBeNull();
  });

  it('si no hay presupuesto, el CTA abre la ficha de obra', () => {
    expect(ctaHoy(obraReforma, null)).toEqual({
      href: `/obras?id=${obraReforma.id}`,
      label: 'Ver ficha de la obra',
    });
    expect(pickPresupuestoHoy(obraReforma, [])).toBeNull();
  });

  it('en borrador el CTA es seguir el presupuesto', () => {
    expect(
      ctaHoy(obraReforma, { id: 'pre-b', estado: 'borrador', obra_id: 'obra-1' })?.label
    ).toBe('Seguir el presupuesto');
  });
});
