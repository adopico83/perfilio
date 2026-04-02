import {
  buildMemoriaNegocioPromptBlock,
  deleteMemoriaNegocioByClave,
  upsertMemoriaNegocio,
} from '@/lib/memoria-negocio';

describe('buildMemoriaNegocioPromptBlock', () => {
  it('no añade bloque cuando la tabla está vacía', () => {
    expect(buildMemoriaNegocioPromptBlock([])).toBe('');
  });

  it('inyecta "## Lo que sé de este negocio" con líneas [categoria - clave]: valor', () => {
    const block = buildMemoriaNegocioPromptBlock([
      {
        categoria: 'preferencia_material',
        clave: 'cemento_exterior',
        valor_texto: 'Siempre usa cemento tipo II para exteriores',
      },
      {
        categoria: 'precio_habitual',
        clave: 'azulejo_gris',
        valor_texto: '32€/m2',
      },
      {
        categoria: 'proveedor_habitual',
        clave: 'materiales',
        valor_texto: 'Leroy Merlin Irún',
      },
    ]);
    expect(block.startsWith('\n\n## Lo que sé de este negocio\n')).toBe(true);
    expect(block).toContain(
      '[preferencia_material - cemento_exterior]: Siempre usa cemento tipo II para exteriores'
    );
    expect(block).toContain('[precio_habitual - azulejo_gris]: 32€/m2');
    expect(block).toContain('[proveedor_habitual - materiales]: Leroy Merlin Irún');
  });
});

describe('upsertMemoriaNegocio', () => {
  it('hace upsert por (business_id, clave)', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: jest.fn(() => ({ upsert })),
    } as unknown as Parameters<typeof upsertMemoriaNegocio>[0];

    const r = await upsertMemoriaNegocio(
      supabase,
      'biz-uuid',
      'correccion_tecnica',
      'mortero',
      'Usar mortero cola C2'
    );

    expect(r.ok).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('memoria_negocio');
    expect(upsert).toHaveBeenCalledWith(
      {
        business_id: 'biz-uuid',
        categoria: 'correccion_tecnica',
        clave: 'mortero',
        valor_texto: 'Usar mortero cola C2',
      },
      { onConflict: 'business_id,clave' }
    );
  });

  it('propaga error de Supabase', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: { message: 'fallo' } });
    const supabase = { from: jest.fn(() => ({ upsert })) } as unknown as Parameters<
      typeof upsertMemoriaNegocio
    >[0];

    const r = await upsertMemoriaNegocio(supabase, 'b', 'dato_negocio', 'k', 'v');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('fallo');
  });
});

describe('deleteMemoriaNegocioByClave', () => {
  it('elimina la fila correcta por business_id y clave', async () => {
    const select = jest.fn().mockResolvedValue({ data: [{ id: 'row-1' }], error: null });
    const eqClave = jest.fn(() => ({ select }));
    const eqBusiness = jest.fn(() => ({ eq: eqClave }));
    const del = jest.fn(() => ({ eq: eqBusiness }));

    const supabase = {
      from: jest.fn(() => ({ delete: del })),
    } as unknown as Parameters<typeof deleteMemoriaNegocioByClave>[0];

    const r = await deleteMemoriaNegocioByClave(supabase, 'biz-2', 'clave_x');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.deleted).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('memoria_negocio');
    expect(del).toHaveBeenCalled();
    expect(eqBusiness).toHaveBeenCalledWith('business_id', 'biz-2');
    expect(eqClave).toHaveBeenCalledWith('clave', 'clave_x');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('indica deleted false si no había filas', async () => {
    const select = jest.fn().mockResolvedValue({ data: [], error: null });
    const eqClave = jest.fn(() => ({ select }));
    const eqBusiness = jest.fn(() => ({ eq: eqClave }));
    const supabase = {
      from: jest.fn(() => ({
        delete: () => ({ eq: eqBusiness }),
      })),
    } as unknown as Parameters<typeof deleteMemoriaNegocioByClave>[0];

    const r = await deleteMemoriaNegocioByClave(supabase, 'b', 'nope');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.deleted).toBe(false);
  });
});
