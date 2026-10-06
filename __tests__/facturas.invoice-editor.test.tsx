/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  InvoiceEditor,
  ivaPorcentajeInicial,
  type FacturaEditorSource,
} from '@/components/facturas/invoice-editor';
import { empresaVacia } from '@/lib/pdf/empresa';

const factura: FacturaEditorSource = {
  id: 'fac-1',
  business_id: 'biz-1',
  numero_factura: '7',
  cliente_nombre: 'Ana',
  cliente_direccion: 'Calle Mayor 1, Errenteria',
  cliente_nif: 'B12345678',
  descripcion_trabajos: null,
  lineas: [
    { descripcion: 'Alicatado', cantidad: 10, precio_unitario: 30, unidad: 'm2', capitulo: 'Baño', importe: 300 },
  ],
  base_imponible: 300,
  iva: 30,
  total: 330,
  fecha: '2026-10-01',
  created_at: '2026-10-01T10:00:00Z',
};

describe('InvoiceEditor', () => {
  it('toma el IVA real de la factura (10%), no un 21% fijo', () => {
    expect(ivaPorcentajeInicial(factura)).toBe(10);
    expect(ivaPorcentajeInicial({ base_imponible: null, iva: null })).toBe(21);
    render(<InvoiceEditor factura={factura} empresa={empresaVacia()} onClose={jest.fn()} onSave={jest.fn()} />);
    expect(screen.getByLabelText('Porcentaje de IVA')).toHaveValue('10');
    // 300 + 10% = 330 (aparece en totales)
    expect(screen.getAllByText('330,00').length).toBeGreaterThan(0);
  });

  it('al guardar manda las líneas y el IVA (sin importes calculados en el cliente)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InvoiceEditor factura={factura} empresa={empresaVacia()} onClose={jest.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Porcentaje de IVA'), { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({
      cliente_nombre: 'Ana',
      iva_porcentaje: 21,
      lineas: [
        { descripcion: 'Alicatado', cantidad: 10, precio_unitario: 30, unidad: 'm2', capitulo: 'Baño' },
      ],
    });
  });

  it('muestra el error que devuelve el servidor', () => {
    render(
      <InvoiceEditor
        factura={factura}
        empresa={empresaVacia()}
        onClose={jest.fn()}
        onSave={jest.fn()}
        error="Solo se pueden editar facturas pendientes; esta está «pagada»."
      />
    );
    expect(screen.getByText(/Solo se pueden editar facturas pendientes/)).toBeInTheDocument();
  });
});
