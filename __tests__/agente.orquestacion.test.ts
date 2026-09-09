import {
  AGENTE_PROSA_TEMPERATURE,
  AGENTE_TOOLS_TEMPERATURE,
  anclarProsaAHechos,
  buildToolLoopMessages,
  esToolMutacion,
  hechosMutacionDesdeEjecutado,
  idsParaPlanEjecutado,
  pareceAccionQueRequiereTool,
  plannedToolsFromAssistantToolCalls,
  prosaAncladaDirectaSiAplica,
  resumirToolResultParaLog,
} from '@/lib/agente/orquestacion';
import type OpenAI from 'openai';

describe('orquestación anti-alucinación', () => {
  it('mantiene temperature 0 en tools y ~0.7 en prosa', () => {
    expect(AGENTE_TOOLS_TEMPERATURE).toBe(0);
    expect(AGENTE_PROSA_TEMPERATURE).toBeLessThanOrEqual(0.7);
    expect(AGENTE_PROSA_TEMPERATURE).toBeGreaterThanOrEqual(0.6);
  });

  describe('pareceAccionQueRequiereTool', () => {
    it('no trata saludos cortos como acción', () => {
      expect(pareceAccionQueRequiereTool('Hola')).toBe(false);
      expect(pareceAccionQueRequiereTool('Buenas tardes')).toBe(false);
      expect(pareceAccionQueRequiereTool('gracias')).toBe(false);
      expect(pareceAccionQueRequiereTool('ok')).toBe(false);
      expect(pareceAccionQueRequiereTool('')).toBe(false);
    });

    it('detecta verbos de acción y confirmaciones explícitas', () => {
      expect(pareceAccionQueRequiereTool('Registra 8 horas de Juan')).toBe(true);
      expect(pareceAccionQueRequiereTool('Lista los presupuestos pendientes')).toBe(true);
      expect(pareceAccionQueRequiereTool('adelante')).toBe(true);
      expect(pareceAccionQueRequiereTool('Añade una partida de solado')).toBe(true);
    });

    it('no dispara por un saludo largo sin dominio ni verbo', () => {
      expect(pareceAccionQueRequiereTool('Hola, necesito información.')).toBe(false);
    });
  });

  it('extrae tool_calls nativos sin reescribir nombres', () => {
    const calls = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: {
          name: 'registrar_jornada',
          arguments: JSON.stringify({ operario: 'Juan', horas: 8 }),
        },
      },
    ] as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];

    const plan = plannedToolsFromAssistantToolCalls(calls);
    expect(plan).toEqual([{ tool: 'registrar_jornada', args: { operario: 'Juan', horas: 8 } }]);
    expect(idsParaPlanEjecutado(plan, calls)).toEqual(['call_1']);
  });

  it('arma el loop assistant → tool sin campos extra', () => {
    const msgs = buildToolLoopMessages([{ role: 'user', content: 'horas' }], [
      {
        id: 'call_1',
        tool: 'listar_operarios',
        args: {},
        result: { items: [{ nombre: 'Juan' }] },
      },
    ]);
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'listar_operarios' } }],
    });
    expect(msgs[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
    });
    expect(JSON.parse(String((msgs[2] as { content: string }).content))).toEqual({
      items: [{ nombre: 'Juan' }],
    });
  });

  it('resume resultados de tool sin secretos ni cuerpos', () => {
    const resumen = resumirToolResultParaLog({
      ok: true,
      mensaje: 'Hecho',
      access_token: 'secreto',
      cuerpo: 'no loguear',
      items: [1, 2, 3],
    }) as Record<string, unknown>;
    expect(resumen.ok).toBe(true);
    expect(resumen.mensaje).toBe('Hecho');
    expect(resumen.items).toBe(3);
    expect(resumen.access_token).toBeUndefined();
    expect(resumen.cuerpo).toBeUndefined();
  });

  it('ancla la prosa: mutación fallida no se narra como éxito', () => {
    expect(esToolMutacion('agregar_partida_borrador')).toBe(true);
    expect(esToolMutacion('listar_presupuestos')).toBe(false);
    const hechos = hechosMutacionDesdeEjecutado([
      { tool: 'agregar_partida_borrador', result: { ok: false, error: 'No existe.' } },
    ]);
    expect(prosaAncladaDirectaSiAplica(hechos)).toBe('No existe.');
    expect(anclarProsaAHechos('Añadido: mármol.', hechos)).toBe('No existe.');
  });
});
