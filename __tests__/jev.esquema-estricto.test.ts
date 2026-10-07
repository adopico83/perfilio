import { ACCIONES_POR_CATEGORIA, NOMBRES_ACCION, jsonSchemaAccion, jsonSchemaCampos, completarOrden, type NombreAccion } from '@/lib/jev/ordenes';
import { herramientaElegirAccion, herramientaOrdenJev, traducirMensaje } from '@/lib/jev/traductor';

const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

type JS = Record<string, unknown>;
const PROHIBIDAS = ['anyOf', 'oneOf', 'allOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'default', '$ref'];

/** Reglas de Structured Outputs de OpenAI (strict: true) que podemos comprobar sin llamar a la API. */
function comprobarEstricto(js: JS, ruta: string, prof: number, cuenta: { props: number }) {
  expect(prof).toBeLessThanOrEqual(5);
  for (const k of PROHIBIDAS) expect({ ruta, k, presente: k in js }).toEqual({ ruta, k, presente: false });
  if (js.type === 'object') {
    const props = js.properties as Record<string, JS>;
    expect(js.additionalProperties).toBe(false);
    expect([...(js.required as string[])].sort()).toEqual(Object.keys(props).sort()); // TODOS obligatorios
    for (const [k, p] of Object.entries(props)) {
      cuenta.props++;
      comprobarEstricto(p, `${ruta}.${k}`, prof + 1, cuenta);
    }
  }
  const tipos = ([] as unknown[]).concat(js.type);
  if (tipos.includes('array')) comprobarEstricto(js.items as JS, `${ruta}[]`, prof + 1, cuenta);
}

describe('esquemas estrictos en dos pasos', () => {
  const categorias = Object.keys(ACCIONES_POR_CATEGORIA).filter((c) => ACCIONES_POR_CATEGORIA[c]!.length > 0);

  it.each(categorias)('paso 1 de la categoría %s cumple las reglas de strict', (cat) => {
    const esquema = jsonSchemaAccion(ACCIONES_POR_CATEGORIA[cat]!);
    comprobarEstricto(esquema, 'raiz', 0, { props: 0 });
  });

  it.each(NOMBRES_ACCION)('paso 2 de %s cumple las reglas de strict y es pequeño', (accion) => {
    const esquema = jsonSchemaCampos(accion);
    if (!esquema) return;
    const cuenta = { props: 0 };
    comprobarEstricto(esquema, accion, 0, cuenta);
    expect(cuenta.props).toBeLessThan(25);
  });

  it('los campos obligatorios NO admiten null y los opcionales sí', () => {
    const p = (jsonSchemaCampos('GASTO') as { properties: Record<string, { type: unknown }> }).properties;
    expect(p.importe_texto!.type).toBe('string');
    expect(p.proveedor_texto!.type).toEqual(['string', 'null']);
    const partidas = (jsonSchemaCampos('PRESUPUESTO_DICTADO') as { properties: { partidas: { type: unknown; items: { properties: Record<string, { type: unknown }> } } } }).properties.partidas;
    expect(partidas.type).toBe('array');
    expect(partidas.items.properties.concepto_texto!.type).toBe('string');
    expect(partidas.items.properties.precio_texto!.type).toEqual(['string', 'null']);
  });

  it('cada campo lleva una descripción que dice cómo rellenarlo (y la fecha prohíbe el formato ISO)', () => {
    const p = (jsonSchemaCampos('CITA_CREAR') as { properties: Record<string, { description?: string }> }).properties;
    expect(p.fecha_texto!.description).toMatch(/NUNCA/);
    for (const [k, v] of Object.entries(p)) expect({ k, d: Boolean(v.description) }).toEqual({ k, d: true });
  });

  it('el paso 1 no ofrece CONSULTA_OBRA (es CONSULTA_OBRAS con obra_texto) y se manda con strict: true', () => {
    const t = herramientaElegirAccion('general');
    expect(t.function.strict).toBe(true);
    const e = (t.function.parameters as { properties: { accion: { enum: string[] } } }).properties.accion.enum;
    expect(e).not.toContain('CONSULTA_OBRA');
    expect(e).toContain('CONSULTA_OBRAS');
    expect(herramientaOrdenJev('GASTO' as NombreAccion)!.function.strict).toBe(true);
  });

  it('«cómo va la obra de Amaia» (CONSULTA_OBRAS con obra_texto) se convierte en la ficha de esa obra', () => {
    expect(completarOrden({ accion: 'CONSULTA_OBRAS', obra_texto: 'Amaia', estado: null })).toMatchObject({ estado: 'completa', orden: { accion: 'CONSULTA_OBRA', obra_texto: 'Amaia' } });
    expect(completarOrden({ accion: 'CONSULTA_OBRAS', obra_texto: null })).toMatchObject({ orden: { accion: 'CONSULTA_OBRAS' } });
  });

  it('MARCAR_PAGADA sin estado = pagada; GASTO sin proveedor y CREAR_FACTURA sin concepto salen completas', () => {
    expect(completarOrden({ accion: 'MARCAR_PAGADA', factura_texto: '3' })).toMatchObject({ estado: 'completa', orden: { estado: 'pagada' } });
    expect(completarOrden({ accion: 'GASTO', importe_texto: '85', categoria: 'material' }).estado).toBe('completa');
    expect(completarOrden({ accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', importe_texto: '500' }).estado).toBe('completa');
  });
});

describe('traducirMensaje con la API', () => {
  const paso1 = (accion: string) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'elegir_accion', arguments: JSON.stringify({ accion, continua_tarea: null }) } }] } }] });
  const paso2 = (campos: Record<string, unknown>) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'orden_jev', arguments: JSON.stringify(campos) } }] } }] });
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = 'k';
  });

  it('pide strict: true en los dos pasos y une accion + campos', async () => {
    createMock.mockResolvedValueOnce(paso1('GASTO')).mockResolvedValueOnce(paso2({ importe_texto: '180', iva_modo: 'mas', proveedor_texto: 'Saltoki', obra_texto: null, cliente_texto: null, descripcion_texto: null, fecha_texto: null, categoria: null }));
    const s = await traducirMensaje({ mensaje: 'gasto de 180 más IVA en Saltoki', categoria: 'gastos', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'GASTO', importe_texto: '180', iva_modo: 'mas' });
    expect(createMock.mock.calls.map((c) => c[0].tools[0].function.strict)).toEqual([true, true]);
  });

  it('acciones sin campos (CONSULTA_DIA, CHARLA) se resuelven con UNA sola llamada', async () => {
    createMock.mockResolvedValueOnce(paso1('CONSULTA_DIA'));
    expect((await traducirMensaje({ mensaje: '¿qué tengo hoy?', categoria: 'agenda', hoyTexto: 'martes' })).orden).toEqual({ accion: 'CONSULTA_DIA' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('si OpenAI rechaza el esquema estricto (400), reintenta sin strict y lo deja en el log', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockRejectedValueOnce(Object.assign(new Error('Invalid schema'), { status: 400 })).mockResolvedValueOnce(paso1('CONSULTA_DIA'));
    const s = await traducirMensaje({ mensaje: '¿qué tengo hoy?', categoria: 'agenda', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'CONSULTA_DIA' });
    expect(createMock.mock.calls[1]![0].tools[0].function.strict).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('api_esquema_rechazado');
    warn.mockRestore();
  });

  it('otros errores de la API se registran y se propagan (la ruta responde con su error)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
    await expect(traducirMensaje({ mensaje: 'hola', categoria: 'general', hoyTexto: 'martes' })).rejects.toThrow('rate limit');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('api_error');
    warn.mockRestore();
  });

  it('si el modelo no llama a la función o elige una acción inventada, no se ejecuta nada y se registra', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: 'hola' } }] });
    expect(completarOrden((await traducirMensaje({ mensaje: 'hola', categoria: 'general', hoyTexto: 'martes' })).orden).estado).toBe('aclarar');
    createMock.mockResolvedValueOnce(paso1('BORRAR_TODO'));
    expect(completarOrden((await traducirMensaje({ mensaje: 'borra todo', categoria: 'general', hoyTexto: 'martes' })).orden).estado).toBe('aclarar');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('salida_ilegible');
    warn.mockRestore();
  });
});
