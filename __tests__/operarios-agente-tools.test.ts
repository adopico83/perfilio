import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ejecutarConsultarHorasObra,
  ejecutarConsultarHorasOperario,
  ejecutarListarOperarios,
  ejecutarRegistrarJornada,
} from '@/lib/agente/modules/operarios';
import { resolverObraDocumentoAgente } from '@/lib/obras-context';

jest.mock('@/lib/obras-context', () => ({
  resolverObraDocumentoAgente: jest.fn(),
}));

const mockResolver = resolverObraDocumentoAgente as jest.MockedFunction<typeof resolverObraDocumentoAgente>;

describe('tools operarios (lib/agente/modules/operarios)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listar_operarios devuelve items activos', async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [{ id: 'o1', nombre: 'Wilson', coste_hora: 18, activo: true }],
          error: null,
        }),
      })),
    } as unknown as SupabaseClient;

    const r = await ejecutarListarOperarios(supabase, 'biz-1');
    expect(r.error).toBeUndefined();
    expect((r as { items: unknown[] }).items).toHaveLength(1);
    expect((r as { items: { nombre: string }[] }).items[0]?.nombre).toBe('Wilson');
  });

  it('consultar_horas_obra agrega por operario', async () => {
    mockResolver.mockResolvedValue({
      ok: true,
      obra_id: 'obra-x',
      obra_nombre: 'Obra Test',
    });

    const supabase = {
      from: jest.fn(() => {
        let nEq = 0;
        const b: Record<string, jest.Mock> = {
          select: jest.fn(),
          eq: jest.fn(),
        };
        b.select.mockImplementation(() => b);
        b.eq.mockImplementation(() => {
          nEq += 1;
          if (nEq >= 2) {
            return Promise.resolve({
              data: [
                {
                  horas_reales: 4,
                  horas_convenio: 4,
                  operario_id: 'op-a',
                  operarios: { nombre: 'Ana' },
                },
                {
                  horas_reales: 6,
                  horas_convenio: 5,
                  operario_id: 'op-b',
                  operarios: { nombre: 'Luis' },
                },
              ],
              error: null,
            });
          }
          return b;
        });
        return b;
      }),
    } as unknown as SupabaseClient;

    const r = await ejecutarConsultarHorasObra(supabase, 'biz-1', { obra_nombre: 'Obra Test' }, '');
    expect((r as { obra_id: string }).obra_id).toBe('obra-x');
    const items = (r as { items: Array<{ nombre: string; horas_reales: number }> }).items;
    expect(items).toHaveLength(2);
    const ana = items.find((x) => x.nombre === 'Ana');
    expect(ana?.horas_reales).toBe(4);
  });

  it('consultar_horas_operario suma el mes', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'operarios') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            ilike: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({
              data: [{ id: 'op-1', nombre: 'Dani', coste_hora: null }],
              error: null,
            }),
          };
        }
        if (table === 'registros_jornada') {
          const c: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            gte: jest.fn(),
            lte: jest.fn(),
            order: jest.fn(),
          };
          c.select.mockImplementation(() => c);
          c.eq.mockImplementation(() => c);
          c.gte.mockImplementation(() => c);
          c.lte.mockImplementation(() => c);
          c.order.mockResolvedValue({
            data: [
              {
                fecha: '2026-04-02',
                horas_reales: 8,
                horas_convenio: 8,
                obras: { nombre: 'Obra A' },
              },
            ],
            error: null,
          });
          return c;
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const r = await ejecutarConsultarHorasOperario(supabase, 'biz-1', {
      operario_nombre: 'Dani',
      mes: '2026-04',
    });
    expect((r as { horas_reales_total: number }).horas_reales_total).toBe(8);
    expect((r as { detalle_por_dia: unknown[] }).detalle_por_dia).toHaveLength(1);
  });

  it('registrar_jornada inserta y devuelve mensaje de confirmación', async () => {
    mockResolver.mockResolvedValue({
      ok: true,
      obra_id: 'obra-1',
      obra_nombre: 'Reforma Paqui',
    });

    const insertMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'rj-1' }, error: null }),
      }),
    });
    const obraSelect = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { nombre: 'Reforma Paqui', direccion: 'Ambulodi 12' },
        error: null,
      }),
    };

    let registrosJornadaCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'operarios') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            ilike: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({
              data: [{ id: 'op-w', nombre: 'Wilson', coste_hora: null }],
              error: null,
            }),
          };
        }
        if (table === 'registros_jornada') {
          registrosJornadaCalls += 1;
          if (registrosJornadaCalls === 1) {
            const dupChain: Record<string, jest.Mock> = {
              select: jest.fn(),
              eq: jest.fn(),
              maybeSingle: jest.fn(),
            };
            dupChain.select.mockReturnValue(dupChain);
            dupChain.eq.mockReturnValue(dupChain);
            dupChain.maybeSingle.mockResolvedValue({ data: null, error: null });
            return dupChain;
          }
          return { insert: insertMock };
        }
        if (table === 'obras') {
          return obraSelect;
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const r = await ejecutarRegistrarJornada(
      supabase,
      'biz-1',
      {
        operario_nombre: 'Wilson',
        obra_nombre: 'Paqui',
        horas: 8,
        fecha: '2026-04-10',
      },
      ''
    );

    expect(insertMock).toHaveBeenCalled();
    expect((r as { mensaje: string }).mensaje).toContain('Registrado: Wilson');
    expect((r as { mensaje: string }).mensaje).toContain('8h reales');
    expect((r as { mensaje: string }).mensaje).toContain('8h convenio');
    expect((r as { mensaje: string }).mensaje).toContain('Reforma Paqui');
  });

  it('registrar_jornada actualiza si ya existe registro (mismo operario, obra y fecha)', async () => {
    mockResolver.mockResolvedValue({
      ok: true,
      obra_id: 'obra-1',
      obra_nombre: 'Reforma Paqui',
    });

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    const obraSelect = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { nombre: 'Reforma Paqui', direccion: null },
        error: null,
      }),
    };

    let registrosJornadaCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'operarios') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            ilike: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({
              data: [{ id: 'op-w', nombre: 'Artxi', coste_hora: null }],
              error: null,
            }),
          };
        }
        if (table === 'registros_jornada') {
          registrosJornadaCalls += 1;
          if (registrosJornadaCalls === 1) {
            const dupChain: Record<string, jest.Mock> = {
              select: jest.fn(),
              eq: jest.fn(),
              maybeSingle: jest.fn(),
            };
            dupChain.select.mockReturnValue(dupChain);
            dupChain.eq.mockReturnValue(dupChain);
            dupChain.maybeSingle.mockResolvedValue({ data: { id: 'rj-existente' }, error: null });
            return dupChain;
          }
          return { update: updateMock };
        }
        if (table === 'obras') {
          return obraSelect;
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const r = await ejecutarRegistrarJornada(
      supabase,
      'biz-1',
      {
        operario_nombre: 'Artxi',
        obra_nombre: 'Paqui',
        horas_reales: 9,
        horas_convenio: 8,
        fecha: '2026-04-10',
      },
      ''
    );

    expect(updateMock).toHaveBeenCalled();
    expect((r as { mensaje: string }).mensaje).toContain('Actualizado: Artxi');
    expect((r as { mensaje: string }).mensaje).toContain('9h reales');
    expect((r as { mensaje: string }).mensaje).toContain('8h convenio');
    expect((r as { actualizado?: boolean }).actualizado).toBe(true);
  });
});
