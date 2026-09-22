/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { DemoPresupuestoTotalCardView } from '@/components/dashboard/demo-presupuesto-total-card';
import { DemoCalendarioCardView } from '@/components/dashboard/demo-calendario-card';

const SEED = 'BASE IMPONIBLE: 9.755,00 € | IVA (21%): 2.048,55 € | TOTAL: 11.803,55 €';

describe('cards demo de presupuesto y calendario', () => {
  it('abre el desglose del importe presupuestado', () => {
    render(
      <DemoPresupuestoTotalCardView
        loading={false}
        lineas={[
          {
            id: 'pre-1',
            cliente_nombre: 'Ainhoa Etxeberria',
            fecha: '2026-09-07',
            importe_total: 11803.55,
            presupuesto_generado: SEED,
          },
        ]}
      />
    );

    expect(screen.getByText(/9\.?755,00/)).toBeInTheDocument();
    expect(screen.getByText(/11\.?803,55/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Importe total presupuestado/i }));
    expect(screen.getByRole('dialog', { name: 'Importe total presupuestado' })).toBeInTheDocument();
    expect(screen.getByText('Ainhoa Etxeberria')).toBeInTheDocument();
  });

  it('muestra la próxima reunión en la card de agenda', () => {
    const mes = new Date(2026, 8, 1);
    render(
      <DemoCalendarioCardView
        loading={false}
        proximos={[{ id: 'ev-1', titulo: 'Visita de obra — Ainhoa Etxeberria', fecha: '2026-09-23', hora: '10:00' }]}
        mes={mes}
        eventosMes={[{ id: 'ev-1', titulo: 'Visita de obra — Ainhoa Etxeberria', fecha: '2026-09-23', hora: '10:00' }]}
        abierto={false}
        onAbrir={() => {}}
        onCerrar={() => {}}
        onMes={() => {}}
      />
    );

    expect(screen.getByText('Visita de obra — Ainhoa Etxeberria')).toBeInTheDocument();
    expect(screen.getByText('Ver calendario')).toBeInTheDocument();
  });

  it('lista el día con reunión cuando el calendario está abierto', () => {
    render(
      <DemoCalendarioCardView
        loading={false}
        proximos={[]}
        mes={new Date(2026, 8, 1)}
        eventosMes={[{ id: 'ev-1', titulo: 'Revisión del presupuesto', fecha: '2026-09-28', hora: '09:30' }]}
        abierto
        onAbrir={() => {}}
        onCerrar={() => {}}
        onMes={() => {}}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Calendario de reuniones' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revisión del presupuesto/i })).toBeInTheDocument();
  });
});
