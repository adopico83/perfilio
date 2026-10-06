/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { ResumenHoyView } from '@/components/dashboard/resumen-hoy-card';
import { calcularResumenDia } from '@/lib/resumen-diario/calcular';

const NOW = new Date('2026-10-05T05:30:00Z');

describe('tarjeta «Hoy»', () => {
  it('dice «Todo en orden» si no hay nada', () => {
    const r = calcularResumenDia({ citas: [], obras: [], diario: [], presupuestos: [], facturas: [] }, NOW);
    render(<ResumenHoyView resumen={r} />);
    expect(screen.getByText('Todo en orden')).toBeTruthy();
  });

  it('cada punto enlaza a su obra, cita, presupuesto o factura', () => {
    const r = calcularResumenDia(
      {
        citas: [{ id: 'c1', titulo: 'Medición', hora: '09:00', fecha: '2026-10-05' }],
        obras: [{ id: 'o1', nombre: 'Reforma piso', estado: 'en_curso', created_at: '2026-08-01T00:00:00Z' }],
        diario: [],
        presupuestos: [
          { id: 'p1', estado: 'pendiente', cliente_nombre: 'Ana', importe_total: 900, fecha: '2026-09-01' },
        ],
        facturas: [
          { id: 'f1', estado: 'vencida', numero_factura: 'F-1', cliente_nombre: 'Luis', total: 100, fecha_vencimiento: '2026-10-01' },
          { id: 'f2', estado: 'pendiente', numero_factura: 'F-2', cliente_nombre: 'Eva', total: 50, fecha_vencimiento: '2026-10-30' },
        ],
      },
      NOW
    );
    render(<ResumenHoyView resumen={r} />);
    const href = (texto: RegExp) => screen.getByText(texto).closest('a')?.getAttribute('href');
    expect(href(/Medición/)).toBe('/agenda');
    expect(href(/Reforma piso/)).toBe('/obras?id=o1');
    expect(href(/Presupuesto · Ana|Ana/)).toBe('/presupuestos?id=p1');
    expect(href(/Factura F-1/)).toBe('/facturas?id=f1');
    expect(href(/Factura F-2/)).toBe('/facturas?id=f2');
    expect(screen.queryByText('Todo en orden')).toBeNull();
  });

  it('enseña el margen en riesgo y las obras que terminan sin factura, con enlace a la obra', () => {
    const r = calcularResumenDia(
      {
        citas: [],
        obras: [
          { id: 'o1', nombre: 'Ático Gros', estado: 'activa', created_at: '2026-10-04T00:00:00Z' },
          { id: 'o2', nombre: 'Baño Irún', estado: 'en_curso', created_at: '2026-10-04T00:00:00Z', fecha_fin: '2026-10-07' },
        ],
        diario: [],
        presupuestos: [],
        facturas: [],
        jornadas: [{ obra_id: 'o1', horas_reales: 30 }],
        presupuestosObra: [{ obra_id: 'o1', importe_total: 1000, estado: 'aceptado' }],
        facturasObra: [],
      },
      NOW
    );
    render(<ResumenHoyView resumen={r} />);
    expect(screen.getByText('Margen en riesgo')).toBeTruthy();
    expect(screen.getByText('Obras que terminan sin factura')).toBeTruthy();
    expect(screen.getByText('Ático Gros').closest('a')?.getAttribute('href')).toBe('/obras?id=o1');
    expect(screen.getByText('Baño Irún').closest('a')?.getAttribute('href')).toBe('/obras?id=o2');
    expect(screen.getByText(/termina el 07\/10\/2026 y no tiene factura/)).toBeTruthy();
  });
});
