import { ACCIONES_POR_CATEGORIA, NOMBRES_ACCION, jsonSchemaOrden, validarOrden, ORDENES } from '@/lib/jev/ordenes';
import { construirMensajesTraductor, herramientaOrdenJev, interpretarSalida, PROMPT_TRADUCTOR, traducirMensaje } from '@/lib/jev/traductor';

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
  it('rechaza lo que no encaja: acción inventada, tipos mal, campos vacíos', () => {
    expect(validarOrden({ accion: 'HACER_MAGIA' }).ok).toBe(false);
    expect(validarOrden({ accion: 'GASTO', proveedor_texto: 'X', importe_texto: 180 }).ok).toBe(false); // el importe es TEXTO literal
    expect(validarOrden({ accion: 'CITA_CREAR', fecha_texto: '' }).ok).toBe(false);
    expect(validarOrden({ accion: 'GASTO', proveedor_texto: 'X', importe_texto: '1', iva_modo: 'quizas' }).ok).toBe(false);
    expect(validarOrden(null).ok).toBe(false);
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
  it('la función orden_jev tiene raíz «object» y solo las acciones de la categoría (más ACLARAR y CHARLA)', () => {
    const t = herramientaOrdenJev('diario');
    expect(t.type === 'function' && t.function.name).toBe('orden_jev');
    const params = (t as unknown as { function: { parameters: { type: string; properties: { orden: { anyOf: Array<{ properties: { accion: { const?: string } } }> } } } } }).function.parameters;
    expect(params.type).toBe('object');
    const acciones = params.properties.orden.anyOf.map((a) => a.properties.accion.const).sort();
    expect(acciones).toEqual(['ACLARAR', 'CHARLA', 'DIARIO']);
    expect(JSON.stringify(jsonSchemaOrden(ACCIONES_POR_CATEGORIA.agenda!))).toContain('CITA_MOVER');
  });
});

describe('traductor', () => {
  it('el prompt es corto y sin listas de ids ni de clientes', () => {
    expect(PROMPT_TRADUCTOR.length).toBeLessThan(2500);
    expect(PROMPT_TRADUCTOR).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    const m = construirMensajesTraductor({ mensaje: 'hola', categoria: 'general', hoyTexto: 'martes 6 de octubre' });
    expect(m).toHaveLength(2);
    expect(JSON.stringify(m)).not.toMatch(/CLIENTES REGISTRADOS|OBRAS ABIERTAS/);
  });
  it('si el modelo devuelve basura, la orden es ACLARAR (nunca se ejecuta nada)', () => {
    expect(interpretarSalida('no es json').orden.accion).toBe('ACLARAR');
    expect(interpretarSalida(JSON.stringify({ orden: { accion: 'BORRAR_TODO' } })).orden.accion).toBe('ACLARAR');
    expect(interpretarSalida(undefined).orden.accion).toBe('ACLARAR');
  });
  it('traduce con GPT-4o mini forzando la función orden_jev (temperatura 0) y entiende continua_tarea', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'orden_jev', arguments: JSON.stringify({ continua_tarea: true, orden: { accion: 'CITA_CREAR', fecha_texto: 'el lunes', cliente_texto: 'Iker PRUEBA' } }) } }] } }],
    });
    process.env.OPENAI_API_KEY = 'k';
    const s = await traducirMensaje({ mensaje: 'no, con Iker PRUEBA', categoria: 'agenda', hoyTexto: 'martes', tarea: { accion: 'CITA_CREAR', fecha_texto: 'el lunes' } });
    expect(s.continuaTarea).toBe(true);
    expect(s.orden).toMatchObject({ accion: 'CITA_CREAR', cliente_texto: 'Iker PRUEBA' });
    const req = createMock.mock.calls[0]![0];
    expect(req.model).toBe('gpt-4o-mini');
    expect(req.temperature).toBe(0);
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'orden_jev' } });
    expect(JSON.stringify(req.messages)).toContain('TAREA EN CURSO');
  });
});
