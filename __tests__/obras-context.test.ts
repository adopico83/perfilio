import { detectarObraDesdeTexto } from '@/lib/obras-context';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Mock mínimo: solo la cadena from→select→eq→in que usa detectarObraDesdeTexto (sin segunda pasada ilike). */
function makeSupabaseObrasMock(
  obrasRows: Array<{
    id: string;
    business_id: string;
    cliente_id: string | null;
    nombre: string;
    direccion: string | null;
    estado: string;
    clientes?: { nombre?: string | null } | null;
  }>
) {
  return {
    from: jest.fn((table: string) => {
      if (table !== 'obras') {
        return {};
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: obrasRows, error: null }),
      };
    }),
  } as unknown as SupabaseClient;
}

describe('detectarObraDesdeTexto', () => {
  it('encuentra obra por nombre del cliente asociado', async () => {
    const supabase = makeSupabaseObrasMock([
      {
        id: 'o1',
        business_id: 'b1',
        cliente_id: 'c1',
        nombre: 'Reforma Baño',
        direccion: null,
        estado: 'abierta',
        clientes: { nombre: 'García López' },
      },
    ]);

    const r = await detectarObraDesdeTexto(
      'El cliente García López necesita un extra',
      'b1',
      supabase
    );
    expect(r.obra).not.toBeNull();
    expect(r.obra?.id).toBe('o1');
    expect(r.multiples).toHaveLength(0);
  });

  it('devuelve multiples cuando hay ambigüedad', async () => {
    const supabase = makeSupabaseObrasMock([
      {
        id: 'o1',
        business_id: 'b1',
        cliente_id: 'c1',
        nombre: 'Reforma Baño García',
        direccion: null,
        estado: 'abierta',
        clientes: { nombre: 'García' },
      },
      {
        id: 'o2',
        business_id: 'b1',
        cliente_id: 'c2',
        nombre: 'Fachada García Calle Mayor',
        direccion: null,
        estado: 'en_curso',
        clientes: { nombre: 'García' },
      },
    ]);

    const r = await detectarObraDesdeTexto('obra en García', 'b1', supabase);
    expect(r.obra).toBeNull();
    expect(r.multiples).toHaveLength(2);
    expect(r.multiples.map((o) => o.nombre).sort()).toEqual(
      ['Fachada García Calle Mayor', 'Reforma Baño García'].sort()
    );
  });
});
