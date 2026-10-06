import { anadirDictado, detectarObraMencionada, normalizarTexto, type ObraDictado } from '@/lib/diario-dictado';

const obras: ObraDictado[] = [
  { id: '1', nombre: 'Reforma cocina', direccion: null },
  { id: '2', nombre: 'Baño Barakaldo', direccion: null },
  { id: '3', nombre: 'Baño Barakaldo planta alta', direccion: null },
  { id: '4', nombre: 'Ana', direccion: null }, // demasiado corto para fiarse
];

describe('normalizarTexto', () => {
  it('quita tildes, mayúsculas y espacios de más', () => {
    expect(normalizarTexto('  BAÑO   Bárakaldo ')).toBe('bano barakaldo');
  });
});

describe('anadirDictado', () => {
  it('une dictados con una línea en blanco y no añade huecos', () => {
    expect(anadirDictado('', 'hola')).toBe('hola');
    expect(anadirDictado('hola', '  ')).toBe('hola');
    expect(anadirDictado('hola', 'adiós')).toBe('hola\n\nadiós');
  });
});

describe('detectarObraMencionada', () => {
  it('avisa si el texto nombra otra obra distinta de la elegida (sin tildes ni mayúsculas)', () => {
    expect(detectarObraMencionada('Hoy en el BANO barakaldo se ha alicatado', obras, '1')?.id).toBe('2');
  });
  it('no avisa si nombra la elegida', () => {
    expect(detectarObraMencionada('Reforma cocina: se ha picado', obras, '1')).toBeNull();
  });
  it('no avisa si nombra la elegida y otra a la vez (no hay duda)', () => {
    expect(detectarObraMencionada('Reforma cocina y baño barakaldo', obras, '1')).toBeNull();
  });
  it('entre varias coincidencias gana el nombre más específico', () => {
    expect(detectarObraMencionada('baño barakaldo planta alta, tabiques', obras, '1')?.id).toBe('3');
  });
  it('sin texto o sin coincidencias, null', () => {
    expect(detectarObraMencionada('', obras, '1')).toBeNull();
    expect(detectarObraMencionada('se ha pintado el salón', obras, '1')).toBeNull();
  });
  it('ignora nombres de menos de 4 letras', () => {
    expect(detectarObraMencionada('ana trajo el material', obras, '1')).toBeNull();
  });
  it('sin obra elegida también avisa de la mencionada', () => {
    expect(detectarObraMencionada('reforma cocina lista', obras, null)?.id).toBe('1');
  });
});
