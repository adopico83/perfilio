import { ACCIONES_POR_CATEGORIA, NOMBRES_ACCION, completarOrden, jsonSchemaAccion, jsonSchemaCampos, validarOrden, ORDENES } from '@/lib/jev/ordenes';
import { clausulaEn } from '@/lib/jev/sin-usar';
import { cubrirPorTrozos, reconstruye, unirSinDatos } from '@/lib/jev/traductor';
import { normalizarAccionPublica } from '@/lib/jev/ordenes';
import { construirMensajesTraductor, herramientaElegirAccion, herramientaOrdenJev, interpretarSalida, PROMPT_TRADUCTOR, traducirMensaje } from '@/lib/jev/traductor';

const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

describe('esquema de órdenes .jev', () => {
  it('cada acción tiene su esquema y valida un ejemplo mínimo', () => {
    expect(NOMBRES_ACCION.length).toBeGreaterThanOrEqual(25);
    expect(validarOrden({ accion: 'CITA_CREAR', fecha_texto: 'el lunes' }).ok).toBe(true);
    expect(validarOrden({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas' }).ok).toBe(true);
    expect(validarOrden({ accion: 'CHARLA' }).ok).toBe(true);
  });
  it('rechaza lo que no encaja (acción inventada, sin objeto) y sigue sin ejecutar nada raro', () => {
    expect(validarOrden({ accion: 'HACER_MAGIA' }).ok).toBe(false);
    expect(validarOrden(null).ok).toBe(false);
    expect(validarOrden({ accion: 'CITA_CREAR', fecha_texto: '' }).ok).toBe(false); // sin fecha: se pregunta
  });
  it('un valor mal puesto en un campo OPCIONAL se descarta; no tira la orden entera', () => {
    const r = completarOrden({ accion: 'GASTO', proveedor_texto: 'X', importe_texto: 180, iva_modo: 'quizas' });
    expect(r).toMatchObject({ estado: 'completa', orden: { accion: 'GASTO', proveedor_texto: 'X', importe_texto: '180' } });
    expect((r as { orden: Record<string, unknown> }).orden.iva_modo).toBeUndefined();
  });
  it('NINGÚN esquema admite ids, fechas ISO como campo ni totales calculados', () => {
    const prohibidos = /(^|_)(id|ids|uuid|total|base|importe_total|fecha_iso)$|_id$/;
    for (const nombre of NOMBRES_ACCION) {
      const claves = Object.keys((ORDENES[nombre] as unknown as { shape: Record<string, unknown> }).shape);
      for (const k of claves) expect(k).not.toMatch(prohibidos);
    }
  });
  it('los slots de importe, fecha y hora son TEXTO literal (nunca número ni fecha)', () => {
    for (const nombre of NOMBRES_ACCION) {
      const shape = (ORDENES[nombre] as unknown as { shape: Record<string, { def?: { type?: string } }> }).shape;
      for (const [k, v] of Object.entries(shape)) {
        if (/_texto$/.test(k)) expect(JSON.stringify(v.def?.type ?? 'string')).not.toMatch(/number|date/);
      }
    }
  });
  it('paso 1: enum cerrado con las acciones de la categoría (más ACLARAR y CHARLA); paso 2: esquema strict de UNA acción', () => {
    const t1 = herramientaElegirAccion('diario');
    expect(t1.function.name).toBe('elegir_accion');
    expect(t1.function.strict).toBe(true);
    const p1 = t1.function.parameters as { type: string; properties: { accion: { enum: string[] } } };
    expect(p1.type).toBe('object');
    expect([...p1.properties.accion.enum].sort()).toEqual(['ACLARAR', 'CHARLA', 'DIARIO']);
    expect(JSON.stringify(jsonSchemaAccion(ACCIONES_POR_CATEGORIA.agenda!))).toContain('CITA_MOVER');
    const t2 = herramientaOrdenJev('DIARIO')!;
    expect(t2.function.name).toBe('orden_jev');
    expect(t2.function.strict).toBe(true);
    expect(Object.keys((t2.function.parameters as { properties: object }).properties).sort()).toEqual(['fecha_texto', 'obra_texto', 'texto']);
    expect(jsonSchemaCampos('CHARLA')).toBeNull();
  });
});

describe('traductor', () => {
  it('el prompt es corto y sin listas de ids ni de clientes', () => {
    expect(PROMPT_TRADUCTOR.length).toBeLessThan(14000);
    expect(PROMPT_TRADUCTOR).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    const m = construirMensajesTraductor({ mensaje: 'hola', categoria: 'general', hoyTexto: 'martes 6 de octubre' });
    expect(m).toHaveLength(2);
    expect(JSON.stringify(m)).not.toMatch(/CLIENTES REGISTRADOS|OBRAS ABIERTAS/);
  });
  it('si el modelo devuelve basura, la orden es ACLARAR (nunca se ejecuta nada)', () => {
    for (const arg of ['no es json', JSON.stringify({ orden: { accion: 'BORRAR_TODO' } }), JSON.stringify({ accion: 'BORRAR_TODO' }), undefined]) {
      expect(completarOrden(interpretarSalida(arg).orden).estado).toBe('aclarar');
    }
  });
  it('traduce en DOS pasos con GPT-4o mini (temperatura 0, función forzada) y entiende continua_tarea', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'elegir_accion', arguments: JSON.stringify({ accion: 'CITA_CREAR', continua_tarea: true }) } }] } }] })
      .mockResolvedValueOnce({
        choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'orden_jev', arguments: JSON.stringify({ fecha_texto: 'el lunes', cliente_texto: 'Iker PRUEBA', hora_texto: null }) } }] } }],
      });
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: 'no, con Iker PRUEBA', categoria: 'agenda', hoyTexto: 'martes', tarea: { accion: 'CITA_CREAR', fecha_texto: 'el lunes' } });
    expect(s.continuaTarea).toBe(true);
    expect(s.orden).toMatchObject({ accion: 'CITA_CREAR', cliente_texto: 'Iker PRUEBA' });
    expect(createMock).toHaveBeenCalledTimes(2);
    const [r1, r2] = [createMock.mock.calls[0]![0], createMock.mock.calls[1]![0]];
    for (const req of [r1, r2]) {
      expect(req.model).toBe('gpt-4o-mini');
      expect(req.temperature).toBe(0);
      expect(JSON.stringify(req.messages)).toContain('TAREA EN CURSO');
    }
    expect(r1.tool_choice).toEqual({ type: 'function', function: { name: 'elegir_accion' } });
    expect(r2.tool_choice).toEqual({ type: 'function', function: { name: 'orden_jev' } });
  });
});

describe('revisión de datos sin usar', () => {
  const tc = (name: string, args: unknown) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  it('si el primer intento deja fuera cifras que dijo el usuario, repite una vez avisando y se queda con el que las recoge', async () => {
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'FACTURAR', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { presupuesto_texto: '' }))
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'CREAR_FACTURA', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { cliente_texto: 'Txema', importe_texto: '300', iva_modo: null }));
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: 'Mete la factura de Txema de 300 euros', categoria: 'general', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'CREAR_FACTURA', cliente_texto: 'Txema', importe_texto: '300' });
    expect(JSON.stringify(createMock.mock.calls[2]![0].messages)).toContain('REVISIÓN');
  });
  it('si no falta ningún dato, no repite', async () => {
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'HORAS', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { operario_texto: 'Iker', horas_texto: '7', obra_texto: null }));
    const s = await traducirMensaje({ mensaje: 'ponle 7 horas a Iker', categoria: 'operarios', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'HORAS' });
    expect(createMock).toHaveBeenCalledTimes(2);
  });
  it('si la orden principal sale vacía, el segundo intento descarta ese tipo', async () => {
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'PRESUPUESTO_DICTADO', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { cliente_texto: '', partidas: [] }))
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'PRESUPUESTO_PARTIDAS', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { presupuesto_texto: 'Paqui', anadir: [{ concepto_texto: 'pintura', cantidad_texto: '30', unidad_texto: 'metros', precio_texto: '8' }] }));
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: 'Pon una partida de pintura de 30 metros a 8 euros en el presupuesto de Paqui', categoria: 'general', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: 'Paqui' });
    const enumSegundo = createMock.mock.calls[2]![0].tools[0].function.parameters.properties.accion.enum as string[];
    expect(enumSegundo).not.toContain('PRESUPUESTO_NUEVO_CON_PARTIDAS_DICTADAS');
  });
  it('una cifra que sigue sin recogerse tras revisar: su cláusula se traduce sola y se añade como otra orden', async () => {
    createMock.mockReset();
    const gasto = { proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' };
    createMock
      // 1.er intento: el segundo tipo sale mal (otro gasto igual) y las horas se pierden
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'GASTO', continua_tarea: false, otras_acciones: ['GASTO'] }))
      .mockResolvedValueOnce(tc('orden_jev', gasto))
      .mockResolvedValueOnce(tc('orden_jev', gasto))
      // 2.º intento: igual
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'GASTO', continua_tarea: false, otras_acciones: ['GASTO'] }))
      .mockResolvedValueOnce(tc('orden_jev', gasto))
      .mockResolvedValueOnce(tc('orden_jev', gasto))
      // la cláusula huérfana, sola
      .mockResolvedValueOnce(tc('elegir_accion', { accion: 'HORAS', continua_tarea: false }))
      .mockResolvedValueOnce(tc('orden_jev', { operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' }));
    const s = await traducirMensaje({ mensaje: 'apunta 87,40 de Saltoki para lo de Leire y de paso ponle 6 horas a Jon en lo de Paqui', categoria: 'general', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'GASTO' });
    expect(s.otras).toEqual([expect.objectContaining({ accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6' })]);
  });
  it('los tipos más confundibles tienen nombre autoexplicativo para el modelo y se deshace al leer', () => {
    const enumP = (jsonSchemaAccion(ACCIONES_POR_CATEGORIA.general!) as { properties: { accion: { enum: string[] } } }).properties.accion.enum;
    expect(enumP).toContain('FACTURA_LIBRE_CON_CLIENTE_E_IMPORTE');
    expect(enumP).not.toContain('FACTURAR');
    expect(normalizarAccionPublica('EDITAR_PRESUPUESTO_EXISTENTE_PARTIDAS')).toBe('PRESUPUESTO_PARTIDAS');
    expect(normalizarAccionPublica('GASTO')).toBe('GASTO');
  });
  it('clausulaEn corta en comas y en «y» entre peticiones, no en «7 y media»', () => {
    expect(clausulaEn('Aitor 7 y media y Jon el carpintero 6, y de paso ponle 3 a Iker', 'Aitor 7 y media y Jon el carpintero 6, y de paso ponle 3 a Iker'.indexOf('3 a'))).toBe('de paso ponle 3 a Iker');
    expect(clausulaEn('Aitor 7 y media y Jon 6', 8)).toBe('Aitor 7 y media');
  });
});


describe('troceo con cobertura (idea 1)', () => {
  const tc = (name: string, args: unknown) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const MSG = 'apunta 87,40 de Saltoki para lo de Leire y de paso Jon 6 en lo de Paqui';
  const gasto = { proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire', cliente_texto: null };

  /** «Modelo» malo: ante el mensaje entero devuelve DOS gastos (el segundo, una copia); solo acierta cuando recibe el trozo suelto. */
  function modeloMalo(troceo: string[] | 'roto') {
    createMock.mockReset();
    createMock.mockImplementation(async (req: { tool_choice: { function: { name: string } }; messages: Array<{ role: string; content: string }> }) => {
      const nombre = req.tool_choice.function.name;
      const usuario = req.messages.find((m) => m.role === 'user')!.content;
      const sistema = req.messages[0]!.content;
      const trozoSuelto = usuario.length < MSG.length - 10;
      if (nombre === 'trocear') return tc('trocear', { trozos: troceo === 'roto' ? ['otra cosa distinta'] : troceo });
      if (nombre === 'elegir_accion') return trozoSuelto ? tc('elegir_accion', { accion: 'HORAS', continua_tarea: false, otras_acciones: null }) : tc('elegir_accion', { accion: 'GASTO', continua_tarea: false, otras_acciones: ['GASTO'] });
      if (/la orden es HORAS/.test(sistema)) return tc('orden_jev', { operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' });
      return tc('orden_jev', gasto);
    });
  }

  it('reconstruye(): los trozos tienen que ser el mensaje, sin sobrar ni faltar nada', () => {
    expect(reconstruye(MSG, ['apunta 87,40 de Saltoki para lo de Leire', 'y de paso Jon 6 en lo de Paqui'])).toBe(true);
    expect(reconstruye(MSG, ['apunta 87,40 de Saltoki para lo de Leire', 'Jon 6 en lo de Paqui'])).toBe(false);
    expect(reconstruye(MSG, ['apunta 87,40 de Saltoki para lo de Leire y de paso Jon 7 en lo de Paqui'])).toBe(false);
  });
  it('unirSinDatos(): un trozo sin datos se pega al anterior; «7 y media» no se separa', () => {
    expect(unirSinDatos(['apunta 87,40 de Saltoki', 'y de paso', 'Jon 6 en lo de Paqui'])).toEqual(['apunta 87,40 de Saltoki y de paso', 'Jon 6 en lo de Paqui']);
    expect(unirSinDatos(['Aitor 7 y media'])).toEqual(['Aitor 7 y media']);
  });
  it('el segundo trozo se quedó sin orden (el modelo copió el gasto): se traduce SOLO y se añade; el gasto copiado no se guarda dos veces', async () => {
    modeloMalo(['apunta 87,40 de Saltoki para lo de Leire', 'y de paso Jon 6 en lo de Paqui']);
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: MSG, categoria: 'general', hoyTexto: 'martes' });
    const todas = [s.orden, ...(s.otras ?? [])] as Array<Record<string, unknown>>;
    expect(todas.filter((o) => o.accion === 'GASTO').length).toBe(1);
    expect(todas.filter((o) => o.accion === 'HORAS')).toEqual([expect.objectContaining({ operario_texto: 'Jon', horas_texto: '6' })]);
  });
  it('si el corte no reconstruye el mensaje se descarta y se sigue sin él (no se pierde nada por un mal corte)', async () => {
    modeloMalo('roto');
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: MSG, categoria: 'general', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'GASTO' });
  });
  it('con una sola cifra no se trocea (ni una llamada de más)', async () => {
    modeloMalo(['x']);
    process.env.OPENAI_API_KEY = 'k';
    await traducirMensaje({ mensaje: 'apunta 87,40 de Saltoki para lo de Leire', categoria: 'general', hoyTexto: 'martes' });
    expect(createMock.mock.calls.some((c) => (c[0] as { tool_choice: { function: { name: string } } }).tool_choice.function.name === 'trocear')).toBe(false);
  });
  it('una orden incompleta que no cubre ningún trozo se sustituye por la del trozo traducido solo (no quedan dos)', async () => {
    modeloMalo(['apunta 87,40 de Saltoki para lo de Leire', 'y de paso Jon 6 en lo de Paqui']);
    process.env.OPENAI_API_KEY = 'k';
    const incompleta = { accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6' }; // se dejó la obra: cubre ningún trozo entero
    const s = await cubrirPorTrozos({ mensaje: MSG, categoria: 'general', hoyTexto: 'martes' }, { orden: { accion: 'GASTO', ...gasto } as never, otras: [incompleta as never], continuaTarea: false });
    const horas = [s.orden, ...(s.otras ?? [])].filter((o) => (o as { accion: string }).accion === 'HORAS');
    expect(horas).toEqual([expect.objectContaining({ operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' })]);
    expect(s.rescate).toBe(true);
  });
});
