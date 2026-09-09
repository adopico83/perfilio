import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

import {
  GROUNDING_REGLAS_SISTEMA,
  colapsarResolve,
  esQueryListadoObras,
  extraerNombreClienteDePeticionPresupuesto,
  pareceConsultaListadoObras,
  pareceMutacionSobrePresupuestoExistente,
  parecePeticionPresupuestoNuevo,
  resultadoResolveATool,
  scoreNombreMatch,
} from '@/lib/agente/modules/grounding';
import {
  anclarProsaAHechos,
  hechosMutacionDesdeEjecutado,
  prosaAncladaDirectaSiAplica,
} from '@/lib/agente/orquestacion';
import { handlePresupuestos } from '@/lib/agente/modules/presupuestos';
import { handleObrasClientesAgent } from '@/lib/agente/modules/obras-clientes';
import { intentPorSenalExplicita } from '@/lib/agente/router';

const PRUEBA_3 =
  'Añade partida 12.345 € Mármol alienígena al presupuesto del cliente inexistente XYZ-999';

function makeChain(data: unknown, error: { message: string } | null = null, extras: Record<string, jest.Mock> = {}) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.ilike = jest.fn(self);
  chain.order = jest.fn(self);
  chain.limit = jest.fn(self);
  chain.in = jest.fn(self);
  chain.or = jest.fn(self);
  chain.is = jest.fn(self);
  chain.update = jest.fn(self);
  chain.maybeSingle = jest.fn().mockResolvedValue({
    data: Array.isArray(data) ? (data[0] ?? null) : data,
    error,
  });
  chain.single = jest.fn().mockResolvedValue({
    data: Array.isArray(data) ? (data[0] ?? data) : data,
    error,
  });
  const insert = extras.insert ?? jest.fn(() => chain);
  chain.insert = insert;
  (chain as unknown as PromiseLike<{ data: unknown; error: typeof error }>).then = (
    onFulfilled,
    onRejected
  ) => Promise.resolve({ data, error }).then(onFulfilled, onRejected);
  return { chain, insert };
}

function makeSupabase(tables: Record<string, unknown>, inserts: Record<string, jest.Mock> = {}) {
  return {
    from: jest.fn((table: string) => {
      const data = tables[table];
      const { chain } = makeChain(data ?? [], null, inserts[table] ? { insert: inserts[table] } : {});
      if (inserts[table]) chain.insert = inserts[table];
      return chain;
    }),
  } as unknown as SupabaseClient;
}

const openaiStub = { chat: { completions: { create: jest.fn() } } } as unknown as OpenAI;

describe('grounding — lenguaje de calle y resolve 0/1/varios', () => {
  it('detecta añadir a presupuesto existente (prueba 3) y extrae el cliente', () => {
    expect(pareceMutacionSobrePresupuestoExistente(PRUEBA_3)).toBe(true);
    expect(extraerNombreClienteDePeticionPresupuesto(PRUEBA_3)).toBe('XYZ-999');
    expect(
      extraerNombreClienteDePeticionPresupuesto(
        'Añade 2 m2 de solado al presupuesto del cliente García'
      )
    ).toBe('García');
  });

  it('no trata un presupuesto NUEVO como mutación sobre existente', () => {
    expect(pareceMutacionSobrePresupuestoExistente('Haz un presupuesto para Juan')).toBe(false);
    expect(pareceMutacionSobrePresupuestoExistente('Crea un presupuesto nuevo para la reforma')).toBe(
      false
    );
    expect(pareceMutacionSobrePresupuestoExistente('Añade 12 m2 de solado')).toBe(false);
  });

  it('consulta de obras abiertas no es presupuesto nuevo ni mutación sobre existente', () => {
    const q = '¿Qué obras tengo abiertas?';
    expect(pareceConsultaListadoObras(q)).toBe(true);
    expect(pareceConsultaListadoObras('Lista las obras en curso')).toBe(true);
    expect(pareceConsultaListadoObras('Muéstrame las obras')).toBe(true);
    expect(pareceConsultaListadoObras('Crea una obra nueva en Getxo')).toBe(false);
    expect(pareceMutacionSobrePresupuestoExistente(q)).toBe(false);
    expect(parecePeticionPresupuestoNuevo(q)).toBe(false);
    expect(parecePeticionPresupuestoNuevo('Haz un presupuesto para Juan')).toBe(true);
    expect(parecePeticionPresupuestoNuevo(PRUEBA_3)).toBe(false);
    expect(esQueryListadoObras('')).toBe(true);
    expect(esQueryListadoObras('abiertas')).toBe(true);
    expect(esQueryListadoObras(q)).toBe(true);
    expect(esQueryListadoObras('Reforma Baño García')).toBe(false);
    expect(intentPorSenalExplicita(q)).toBe('documentos');
    expect(intentPorSenalExplicita('Haz un presupuesto para Juan')).toBeNull();
    expect(GROUNDING_REGLAS_SISTEMA).toMatch(/CONSULTAS \/ LISTADOS/i);
    expect(GROUNDING_REGLAS_SISTEMA).toMatch(/PROHIBIDO iniciar_borrador/i);
  });

  it('1 coincidencia exacta resuelve; varias piden aclaración; cero fail-closed', () => {
    const uno = colapsarResolve(
      [
        { id: 'c1', nombre: 'García López' },
        { id: 'c2', nombre: 'Martínez' },
      ],
      'García López'
    );
    expect(uno.status).toBe('one');
    if (uno.status === 'one') expect(uno.match.id).toBe('c1');

    const muchos = colapsarResolve(
      [
        { id: 'c1', nombre: 'García López' },
        { id: 'c2', nombre: 'García Ruiz' },
      ],
      'García'
    );
    expect(muchos.status).toBe('many');
    if (muchos.status === 'many') expect(muchos.candidatos).toHaveLength(2);
    const toolMany = resultadoResolveATool(muchos, 'García', 'cliente');
    expect(toolMany.ok).toBe(false);
    if (!toolMany.ok) {
      expect(toolMany.necesita_aclaracion).toBe(true);
      expect(toolMany.error).toMatch(/varios clientes/i);
    }

    const ninguno = colapsarResolve([{ id: 'c1', nombre: 'Martínez' }], 'XYZ-999');
    expect(ninguno.status).toBe('none');
    const toolNone = resultadoResolveATool(ninguno, 'XYZ-999', 'cliente');
    expect(toolNone.ok).toBe(false);
    if (!toolNone.ok) {
      expect(toolNone.error).toMatch(/XYZ-999/);
      expect(toolNone.error).toMatch(/no he creado/i);
    }
  });

  it('puntúa igualdad normalizada por encima de coincidencia parcial', () => {
    expect(scoreNombreMatch('XYZ-999', 'XYZ-999')).toBe(100);
    expect(scoreNombreMatch('García López', 'García')).toBeGreaterThan(0);
    expect(scoreNombreMatch('García López', 'García')).toBeLessThan(100);
  });
});

describe('prosa anclada', () => {
  it('si la mutación falló, no deja narrar éxito', () => {
    const hechos = hechosMutacionDesdeEjecutado([
      {
        tool: 'agregar_partida_borrador',
        result: { ok: false, error: 'No encuentro ningún cliente llamado «XYZ-999».' },
      },
    ]);
    expect(prosaAncladaDirectaSiAplica(hechos)).toMatch(/XYZ-999/);
    expect(
      anclarProsaAHechos('Añadido: Mármol alienígena (12345€). ¿Siguiente?', hechos)
    ).not.toMatch(/añadido/i);
  });

  it('con ok:true conserva la prosa del modelo', () => {
    const hechos = hechosMutacionDesdeEjecutado([
      { tool: 'agregar_partida_borrador', result: { ok: true, importe: 100 } },
    ]);
    expect(prosaAncladaDirectaSiAplica(hechos)).toBeNull();
    expect(anclarProsaAHechos('Añadido: solado (100€). ¿Siguiente?', hechos)).toMatch(/Añadido/);
  });
});

describe('handlePresupuestos — fail-closed escritura', () => {
  it('prueba 3: cliente/presupuesto inexistente no crea ni añade partida', async () => {
    const insertBorrador = jest.fn(() => makeChain({ id: 'draft-x' }).chain);
    const insertItems = jest.fn(() => makeChain({ id: 'item-x' }).chain);
    const supabase = makeSupabase(
      { clientes: [], presupuestos: [], presupuesto_borrador: [] },
      {
        presupuesto_borrador: insertBorrador,
        presupuesto_borrador_items: insertItems,
      }
    );

    const agregar = await handlePresupuestos(
      'agregar_partida_borrador',
      {
        cliente_nombre: 'XYZ-999',
        descripcion: 'Mármol alienígena',
        cantidad: 1,
        unidad: 'ud',
        precio_unitario: 12345,
        raw_dictado: PRUEBA_3,
      },
      'biz-1',
      'user-1',
      supabase,
      openaiStub,
      { mensajeTrim: PRUEBA_3 }
    );
    expect(agregar.ok).toBe(false);
    expect(String(agregar.error)).toMatch(/XYZ-999/);
    expect(insertItems).not.toHaveBeenCalled();

    const iniciar = await handlePresupuestos(
      'iniciar_borrador_presupuesto',
      { cliente_nombre: 'XYZ-999' },
      'biz-1',
      'user-1',
      supabase,
      openaiStub,
      { mensajeTrim: PRUEBA_3 }
    );
    expect(iniciar.ok).toBe(false);
    expect(String(iniciar.error)).toMatch(/XYZ-999|no creo un presupuesto nuevo/i);
    expect(insertBorrador).not.toHaveBeenCalled();
  });

  it('presupuesto NUEVO sigue pudiendo iniciar borrador sin ficha de cliente', async () => {
    const insertBorrador = jest.fn(() => {
      const { chain } = makeChain({ id: 'draft-1' });
      return chain;
    });
    const supabase = makeSupabase(
      { clientes: [], presupuestos: [], presupuesto_borrador: [] },
      { presupuesto_borrador: insertBorrador }
    );

    const r = await handlePresupuestos(
      'iniciar_borrador_presupuesto',
      { cliente_nombre: 'Juan' },
      'biz-1',
      'user-1',
      supabase,
      openaiStub,
      { mensajeTrim: 'Haz un presupuesto para Juan' }
    );
    expect(r.ok).toBe(true);
    expect(insertBorrador).toHaveBeenCalled();
  });

  it('prueba 1: «obras abiertas» no inicia borrador (ni con cliente del contexto)', async () => {
    const insertBorrador = jest.fn(() => makeChain({ id: 'draft-ocasar' }).chain);
    const supabase = makeSupabase(
      { clientes: [{ id: 'c-ocasar', nombre: 'Javier Ocasar' }], presupuestos: [], presupuesto_borrador: [] },
      { presupuesto_borrador: insertBorrador }
    );

    const r = await handlePresupuestos(
      'iniciar_borrador_presupuesto',
      { cliente_nombre: 'Javier Ocasar' },
      'biz-1',
      'user-1',
      supabase,
      openaiStub,
      { mensajeTrim: '¿Qué obras tengo abiertas?' }
    );
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/no he creado|obras abiertas|listado|buscar_obra/i);
    expect(insertBorrador).not.toHaveBeenCalled();
  });
});

describe('handleObrasClientesAgent — resolve 0/1/varios', () => {
  it('1 match de obra_nombre usa ese id', async () => {
    const supabase = makeSupabase({
      obras: [{ id: 'o-1', nombre: 'Reforma Baño García' }],
    });
    const r = await handleObrasClientesAgent(
      'actualizar_obra',
      { obra_nombre: 'Reforma Baño García', estado: 'en_curso' },
      'biz-1',
      'user-1',
      supabase
    );
    expect(r.ok).toBe(true);
    expect(String((r as { mensaje?: string }).mensaje)).toMatch(/actualizada/i);
  });

  it('varios matches preguntan y no actualizan a ciegas', async () => {
    const supabase = makeSupabase({
      obras: [
        { id: 'o-1', nombre: 'Reforma García Norte' },
        { id: 'o-2', nombre: 'Reforma García Sur' },
      ],
    });
    const r = await handleObrasClientesAgent(
      'actualizar_obra',
      { obra_nombre: 'García', estado: 'en_curso' },
      'biz-1',
      'user-1',
      supabase
    );
    expect(r.ok).toBe(false);
    expect((r as { necesita_aclaracion?: boolean }).necesita_aclaracion).toBe(true);
    expect(String((r as { error?: string }).error)).toMatch(/varias obras|varios/i);
  });

  it('crear_obra no da de alta un cliente de paso', async () => {
    const insertClientes = jest.fn(() => makeChain({ id: 'c-new' }).chain);
    const insertObras = jest.fn(() => makeChain(null).chain);
    const supabase = makeSupabase(
      { obras: [], clientes: [] },
      { clientes: insertClientes, obras: insertObras }
    );
    const r = await handleObrasClientesAgent(
      'crear_obra',
      { nombre: 'Obra Marte', cliente_nombre: 'XYZ-999' },
      'biz-1',
      'user-1',
      supabase
    );
    expect(r.ok).toBe(false);
    expect(String((r as { error?: string }).error)).toMatch(/XYZ-999/);
    expect(insertClientes).not.toHaveBeenCalled();
    expect(insertObras).not.toHaveBeenCalled();
  });

  it('buscar_obra lista abiertas/en curso sin tratar la pregunta como nombre', async () => {
    const supabase = makeSupabase({
      obras: [
        {
          id: 'o-1',
          nombre: 'Reforma Ocasar',
          cliente_id: 'c-1',
          direccion: 'Irun',
          estado: 'abierta',
          fecha_inicio: null,
        },
      ],
      clientes: [{ id: 'c-1', nombre: 'Javier Ocasar' }],
    });
    const r = await handleObrasClientesAgent(
      'buscar_obra',
      { query: '¿Qué obras tengo abiertas?' },
      'biz-1',
      'user-1',
      supabase
    );
    expect((r as { error?: string }).error).toBeUndefined();
    expect((r as { listado_abiertas?: boolean }).listado_abiertas).toBe(true);
    const items = (r as { items: Array<{ nombre: string; cliente_nombre: string | null }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.nombre).toBe('Reforma Ocasar');
  });
});
