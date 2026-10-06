import { intentPorPalabrasClave, INTENT_TOOL_NAMES_AGENDA } from '@/lib/agente/router';
import { handleAgenda, AGENDA_AGENT_TOOLS, AGENDA_HANDLED_TOOLS } from '@/lib/agente/modules/agenda';
import { requiereConfirmacion } from '@/lib/agente/confirmacion';

const mockCargar = jest.fn();
jest.mock('@/lib/resumen-diario/datos', () => ({ cargarResumenDia: (...a: unknown[]) => mockCargar(...a) }));

describe('resumen_del_dia en el agente', () => {
  it('está registrada, es del módulo de agenda y de la intención «agenda»; es solo lectura', () => {
    expect(AGENDA_AGENT_TOOLS.some((t) => t.type === 'function' && t.function.name === 'resumen_del_dia')).toBe(true);
    expect(AGENDA_HANDLED_TOOLS.has('resumen_del_dia')).toBe(true);
    expect(INTENT_TOOL_NAMES_AGENDA.has('resumen_del_dia')).toBe(true);
    expect(requiereConfirmacion('resumen_del_dia', {})).toBe(false);
  });

  it('devuelve lo mismo que el MCP: el resumen, todo_en_orden y el texto', async () => {
    mockCargar.mockResolvedValue({ fecha: '2026-10-06', citasHoy: [], citasManana: [], obrasParadas: [], margenEnRiesgo: [], obrasSinFactura: [], presupuestosSinRespuesta: [], facturasPendientes: [], facturasVencidas: [], totalAvisos: 0, todoEnOrden: true });
    const r = await handleAgenda('resumen_del_dia', {}, 'biz-1', 'u1', {} as never, {} as never);
    expect(r).toMatchObject({ todo_en_orden: true, texto: 'Resumen del día: todo en orden.' });
    expect(mockCargar).toHaveBeenCalledWith(expect.anything(), 'biz-1');
  });

  it('si falla devuelve un error claro, sin lanzar', async () => {
    mockCargar.mockRejectedValue(new Error('boom'));
    expect(await handleAgenda('resumen_del_dia', {}, 'biz-1', 'u1', {} as never, {} as never)).toEqual({ error: 'boom' });
  });
});

describe('respaldo local del router por palabras clave', () => {
  it.each([
    ['¿Qué tengo hoy?', 'agenda'],
    ['cómo va el día', 'agenda'],
    ['Factúrame el albarán 12', 'documentos'],
    ['Marca la factura 3 como pagada', 'documentos'],
    ['Hazme una factura de 800 para la obra del baño', 'documentos'],
    ['Factúrame el presupuesto 5', 'documentos'],
    ['Ponle 6 horas a Iker', 'operarios'],
    ['Anota en el diario que hemos puesto el yeso', 'diario'],
    ['Crea un presupuesto para García', 'presupuesto'],
    ['Apunta este ticket de 40 euros', 'gastos'],
    ['Mándale un email a Ana', 'emails'],
  ])('«%s» → %s', (frase, esperado) => expect(intentPorPalabrasClave(frase)).toBe(esperado));

  it.each(['hola', 'qué tiempo hace', 'apunta 6 horas en el diario de la obra y hazme la factura'])(
    '«%s» no es claro → null (sigue en general)',
    (frase) => expect(intentPorPalabrasClave(frase)).toBeNull()
  );
});
