/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DictarEntradaModal from '@/components/diario/dictar-entrada-modal';

let alTexto: ((t: string) => void) | undefined;
const grabadora = { grabando: false, transcribiendo: false, error: '', empezar: jest.fn(), parar: jest.fn(), texto: '' };
jest.mock('@/hooks/use-grabadora-audio', () => ({
  useGrabadoraAudio: (o: { onTexto?: (t: string) => void }) => {
    alTexto = o.onTexto;
    return grabadora;
  },
}));

const obras = [
  { id: 'o1', nombre: 'Reforma cocina', direccion: 'Calle A 1' },
  { id: 'o2', nombre: 'Baño Barakaldo', direccion: null },
];

function montar(extra: Partial<React.ComponentProps<typeof DictarEntradaModal>> = {}) {
  const onGuardar = jest.fn().mockResolvedValue(null);
  const onClose = jest.fn();
  render(<DictarEntradaModal obras={obras} businessId="biz" onGuardar={onGuardar} onClose={onClose} {...extra} />);
  return { onGuardar, onClose };
}
const guardar = () => screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
const dictar = (t: string) => act(() => alTexto?.(t));

describe('DictarEntradaModal', () => {
  beforeEach(() => {
    Object.assign(grabadora, { grabando: false, transcribiendo: false, error: '' });
    jest.clearAllMocks();
  });

  it('Guardar está deshabilitado hasta tener obra y texto', () => {
    montar();
    expect(guardar().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Obra/), { target: { value: 'o1' } });
    expect(guardar().disabled).toBe(true); // falta el texto
    fireEvent.change(screen.getByLabelText(/Texto de la entrada/), { target: { value: 'Picado' } });
    expect(guardar().disabled).toBe(false);
  });

  it('con texto pero sin obra tampoco se puede guardar', () => {
    montar();
    fireEvent.change(screen.getByLabelText(/Texto de la entrada/), { target: { value: 'Picado' } });
    expect(guardar().disabled).toBe(true);
  });

  it('viene con la obra preseleccionada', () => {
    montar({ obraIdInicial: 'o2' });
    expect((screen.getByLabelText(/Obra/) as HTMLSelectElement).value).toBe('o2');
  });

  it('cada dictado se añade al texto (editable) en vez de sustituirlo', () => {
    montar({ obraIdInicial: 'o1' });
    dictar('Primera parte');
    dictar('Segunda parte');
    expect((screen.getByLabelText(/Texto de la entrada/) as HTMLTextAreaElement).value).toBe(
      'Primera parte\n\nSegunda parte'
    );
  });

  it('guarda con la obra elegida y el texto', async () => {
    const { onGuardar } = montar({ obraIdInicial: 'o1' });
    dictar('Se ha picado la pared');
    fireEvent.click(guardar());
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ obraId: 'o1', texto: 'Se ha picado la pared', fotos: [] }));
  });

  it('muestra el error de guardado y no cierra', async () => {
    const onGuardar = jest.fn().mockResolvedValue('La obra no pertenece a este negocio');
    const { onClose } = montar({ obraIdInicial: 'o1', onGuardar });
    dictar('x');
    fireEvent.click(guardar());
    expect(await screen.findByText('La obra no pertenece a este negocio')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('si dictas otra obra avisa y NO cambia nada sin confirmación', () => {
    montar({ obraIdInicial: 'o1' });
    dictar('Hoy en el baño barakaldo se ha alicatado');
    expect(screen.getByRole('alert').textContent).toContain('Has dicho «Baño Barakaldo», ¿la guardo en Baño Barakaldo?');
    expect((screen.getByLabelText(/Obra/) as HTMLSelectElement).value).toBe('o1');
  });

  it('«Sí» cambia la obra y el aviso desaparece; «No» solo lo oculta', () => {
    montar({ obraIdInicial: 'o1' });
    dictar('baño barakaldo');
    fireEvent.click(screen.getByRole('button', { name: /Sí, guardar en Baño Barakaldo/ }));
    expect((screen.getByLabelText(/Obra/) as HTMLSelectElement).value).toBe('o2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('«No, dejarla donde está» mantiene la obra', () => {
    montar({ obraIdInicial: 'o1' });
    dictar('baño barakaldo');
    fireEvent.click(screen.getByRole('button', { name: /No, dejarla/ }));
    expect((screen.getByLabelText(/Obra/) as HTMLSelectElement).value).toBe('o1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('en demo no ofrece subir fotos', () => {
    montar({ demo: true });
    expect(screen.queryByText(/Añadir fotos/)).toBeNull();
  });

  it('el botón del micro llama a empezar', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar a dictar' }));
    expect(grabadora.empezar).toHaveBeenCalled();
  });
});
