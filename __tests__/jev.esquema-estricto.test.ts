import { ACCIONES_POR_CATEGORIA, NOMBRES_ACCION, jsonSchemaEstricto, completarOrden } from '@/lib/jev/ordenes';
import { herramientaOrdenJev, traducirMensaje } from '@/lib/jev/traductor';

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

describe('esquema estricto de orden_jev', () => {
  const categorias = Object.keys(ACCIONES_POR_CATEGORIA).filter((c) => ACCIONES_POR_CATEGORIA[c]!.length > 0);

  it.each(categorias)('categoría %s cumple las reglas de strict', (cat) => {
    const esquema = jsonSchemaEstricto(ACCIONES_POR_CATEGORIA[cat]!);
    expect(esquema.type).toBe('object');
    const cuenta = { props: 0 };
    comprobarEstricto(esquema, 'raiz', 0, cuenta);
    expect(cuenta.props).toBeLessThan(200); // límite de OpenAI: 5000; vamos sobrados
  });

  it('todo campo puede valer null (si no lo dijo) y solo `accion` es un enum cerrado sin null', () => {
    const esquema = jsonSchemaEstricto(ACCIONES_POR_CATEGORIA.general!) as { properties: Record<string, { type: unknown; enum?: unknown[] }> };
    for (const [k, p] of Object.entries(esquema.properties)) {
      if (k === 'accion') {
        expect(p.type).toBe('string');
        expect(p.enum).toEqual(expect.arrayContaining(NOMBRES_ACCION));
      } else {
        expect(JSON.stringify(p.type)).toContain('null');
        if (p.enum) expect(p.enum).toContain(null);
      }
    }
  });

  it('la función se manda con strict: true y el enum de acciones es el de la categoría', () => {
    const t = herramientaOrdenJev('gastos') as unknown as { function: { strict: boolean; parameters: { properties: { accion: { enum: string[] } } } } };
    expect(t.function.strict).toBe(true);
    expect([...t.function.parameters.properties.accion.enum].sort()).toEqual(['ACLARAR', 'CHARLA', 'CONSULTA_GASTOS', 'GASTO', 'PROVEEDOR_CREAR']);
  });

  it('cualquier orden que el esquema permita (todo null salvo la acción) la maneja completarOrden sin lanzar', () => {
    const esquema = jsonSchemaEstricto(ACCIONES_POR_CATEGORIA.general!) as { properties: Record<string, unknown> };
    for (const accion of NOMBRES_ACCION) {
      const orden: Record<string, unknown> = Object.fromEntries(Object.keys(esquema.properties).map((k) => [k, null]));
      orden.accion = accion;
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => completarOrden(orden)).not.toThrow();
      warn.mockRestore();
    }
  });
});

describe('traducirMensaje con la API', () => {
  const respuesta = { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'orden_jev', arguments: JSON.stringify({ continua_tarea: null, accion: 'CONSULTA_DIA' }) } }] } }] };
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = 'k';
  });

  it('pide strict: true la primera vez', async () => {
    createMock.mockResolvedValueOnce(respuesta);
    const s = await traducirMensaje({ mensaje: '¿qué tengo hoy?', categoria: 'agenda', hoyTexto: 'martes' });
    expect(s.orden).toMatchObject({ accion: 'CONSULTA_DIA' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0].tools[0].function.strict).toBe(true);
  });

  it('si OpenAI rechaza el esquema estricto (400), reintenta sin strict y lo deja en el log', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockRejectedValueOnce(Object.assign(new Error('Invalid schema'), { status: 400 })).mockResolvedValueOnce(respuesta);
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

  it('si el modelo no llama a la función, no se ejecuta nada y se registra', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: 'hola' } }] });
    const s = await traducirMensaje({ mensaje: 'hola', categoria: 'general', hoyTexto: 'martes' });
    expect(completarOrden(s.orden).estado).toBe('aclarar');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('salida_ilegible');
    warn.mockRestore();
  });
});
