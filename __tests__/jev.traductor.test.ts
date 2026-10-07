import { ACCIONES_POR_CATEGORIA, NOMBRES_ACCION, completarOrden, jsonSchemaAccion, jsonSchemaCampos, validarOrden, ORDENES } from '@/lib/jev/ordenes';
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
    expect(PROMPT_TRADUCTOR.length).toBeLessThan(9000);
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
