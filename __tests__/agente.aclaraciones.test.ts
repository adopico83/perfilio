import {
  esRespuestaAfirmativa,
  esRespuestaNegativa,
  hechosMutacionDesdeEjecutado,
  marcaOpcionesParaHistorial,
  opcionesDeResultados,
  prosaAncladaDirectaSiAplica,
  quitarMarcaOpciones,
  resolverEleccionOpcion,
  textoAclaracion,
} from '@/lib/agente/orquestacion';

const aclaracion = {
  ok: false,
  error: 'Hay varias obras que pueden coincidir.',
  necesita_aclaracion: true,
  candidatos: [
    { id: 'id-1', etiqueta: 'Obra Olabide 9 · Olabide 9, Ondarribia' },
    { id: 'id-2', etiqueta: 'Obra Olabide 12 · Olabide 12, Ondarribia' },
  ],
};

describe('textoAclaracion', () => {
  it('añade la lista numerada de opciones (nombre + dirección) si el mensaje no la trae', () => {
    expect(textoAclaracion(aclaracion)).toBe(
      'Hay varias obras que pueden coincidir.\n1. Obra Olabide 9 · Olabide 9, Ondarribia\n2. Obra Olabide 12 · Olabide 12, Ondarribia'
    );
  });
  it('no duplica la lista si el mensaje ya la lleva', () => {
    const conLista = { ...aclaracion, error: 'Varias:\n1. Obra Olabide 9 · Olabide 9, Ondarribia\n2. Obra Olabide 12 · Olabide 12, Ondarribia' };
    expect(textoAclaracion(conLista)).toBe(conLista.error);
  });
  it('sin candidatos devuelve el error', () => {
    expect(textoAclaracion({ ok: false, error: 'No existe' })).toBe('No existe');
  });
});

describe('la respuesta directa a una aclaración sale con opciones', () => {
  it('prosaAncladaDirectaSiAplica muestra las opciones numeradas', () => {
    const hechos = hechosMutacionDesdeEjecutado([{ tool: 'crear_entrada_diario', result: aclaracion }]);
    const prosa = prosaAncladaDirectaSiAplica(hechos);
    expect(prosa).toContain('1. Obra Olabide 9');
    expect(prosa).toContain('2. Obra Olabide 12');
  });
});

describe('opciones con ids para el turno siguiente', () => {
  const opciones = opcionesDeResultados([aclaracion]);
  const asistente = `Hay varias obras.\n1. Obra Olabide 9 · Olabide 9, Ondarribia\n2. Obra Olabide 12 · Olabide 12, Ondarribia${marcaOpcionesParaHistorial(opciones)}`;

  it('numera las opciones de todas las aclaraciones del turno', () => {
    expect(opciones).toEqual([
      { n: 1, id: 'id-1', etiqueta: 'Obra Olabide 9 · Olabide 9, Ondarribia' },
      { n: 2, id: 'id-2', etiqueta: 'Obra Olabide 12 · Olabide 12, Ondarribia' },
    ]);
    expect(marcaOpcionesParaHistorial([])).toBe('');
  });
  it('la marca es invisible para el usuario: quitarMarcaOpciones la elimina', () => {
    expect(quitarMarcaOpciones(asistente)).not.toContain('<!--');
    expect(quitarMarcaOpciones(asistente)).toContain('2. Obra Olabide 12');
  });
  it.each([
    ['la 2', 'id-2'],
    ['2', 'id-2'],
    ['opción 1', 'id-1'],
    ['la primera', 'id-1'],
    ['la segunda.', 'id-2'],
    ['la de Olabide 12', 'id-2'],
  ])('«%s» se resuelve al id exacto', (frase, id) => {
    const r = resolverEleccionOpcion(frase, asistente);
    expect(r).toContain(`id exacto: ${id}`);
  });
  it.each(['la 3', 'la de Olabide', 'hola', 'apunta que ha llegado el material', 'la 2 y la 1'])('«%s» no se interpreta como elección', (frase) => {
    expect(resolverEleccionOpcion(frase, asistente)).toBeNull();
  });
  it('sin opciones en el último mensaje, nada que resolver', () => {
    expect(resolverEleccionOpcion('la 2', 'Hola, ¿qué tal?')).toBeNull();
    expect(resolverEleccionOpcion('la 2', undefined)).toBeNull();
  });
});

describe('sí / no cortos', () => {
  it.each(['sí', 'Si', 'adelante', 'hazlo', 'dale!', 'confirmo'])('«%s» es afirmativa', (t) => expect(esRespuestaAfirmativa(t)).toBe(true));
  it.each(['no', 'cancela', 'Déjalo', 'olvídalo', 'mejor no'])('«%s» es negativa', (t) => expect(esRespuestaNegativa(t)).toBe(true));
  it('una frase larga no cuenta', () => {
    expect(esRespuestaAfirmativa('sí, pero cámbialo a 10 horas')).toBe(false);
    expect(esRespuestaNegativa('no sé qué obra era')).toBe(false);
  });
});
