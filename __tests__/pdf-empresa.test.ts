import {
  empresaDesdePerfil,
  lineaInstagram,
  lineaNifRea,
  lineaOficinaEmail,
  lineasPresupuestoEmisor,
  loadEmpresaEmisor,
  type EmpresaLoaderClient,
} from '@/lib/pdf/empresa';

describe('empresaDesdePerfil', () => {
  it('recorta textos, parte el iban por líneas y convierte vacíos en null', () => {
    const empresa = empresaDesdePerfil({
      razon_social: '  Reformas Demo Errenteria S.L. ',
      nif: 'B00000000',
      rea: '   ',
      direccion_fiscal: '',
      localidad_fiscal: null,
      telefono: '600 000 000',
      email: ' demo-reformas@perfilio.app ',
      web: null,
      instagram: '',
      iban: 'ES00 0000 0000 0000 0000 0000\n\n  ',
    });

    expect(empresa.razonSocial).toBe('Reformas Demo Errenteria S.L.');
    expect(empresa.nif).toBe('B00000000');
    expect(empresa.rea).toBeNull();
    expect(empresa.direccion).toBeNull();
    expect(empresa.localidad).toBeNull();
    expect(empresa.web).toBeNull();
    expect(empresa.instagram).toBeNull();
    expect(empresa.cuentasBancarias).toEqual(['ES00 0000 0000 0000 0000 0000']);
    expect(lineasPresupuestoEmisor(empresa)).toEqual([
      'Reformas Demo Errenteria S.L.',
      'NIF: B00000000',
      'Oficina: 600 000 000  E-mail: demo-reformas@perfilio.app',
    ]);
  });

  it('arma las líneas del presupuesto solo con los campos presentes', () => {
    expect(lineaNifRea({ nif: null, rea: '15/1' })).toBe('R.E.A. 15/1');
    expect(lineaOficinaEmail({ telefono: '600', email: null })).toBe('Oficina: 600');
    expect(lineaInstagram('taller')).toBe('Instagram: @taller');
    expect(lineaInstagram('@taller')).toBe('Instagram: @taller');
    expect(lineaInstagram(null)).toBeNull();
    expect(lineasPresupuestoEmisor(empresaDesdePerfil(null))).toEqual([]);
  });
});

describe('loadEmpresaEmisor', () => {
  it('firma el logo y no inventa datos que no vienen en la fila', async () => {
    const supabase: EmpresaLoaderClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                razon_social: 'Taller Norte S.L.',
                nif: null,
                logo_url: '/logos/norte.png',
                iban: 'BANCO: ES11\nBANCO DOS: ES22',
              },
              error: null,
            }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://signed.example/${path}` },
            error: null,
          }),
        }),
      },
    };

    const res = await loadEmpresaEmisor(supabase, 'biz-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.logoUrl).toBe('https://signed.example/logos/norte.png');
    expect(res.empresa.razonSocial).toBe('Taller Norte S.L.');
    expect(res.empresa.nif).toBeNull();
    expect(res.empresa.email).toBeNull();
    expect(res.empresa.cuentasBancarias).toEqual(['BANCO: ES11', 'BANCO DOS: ES22']);
  });

  it('propaga el error de la consulta', async () => {
    const supabase: EmpresaLoaderClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'columna inexistente' },
            }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: null, error: null }),
        }),
      },
    };

    await expect(loadEmpresaEmisor(supabase, 'biz-1')).resolves.toEqual({
      ok: false,
      error: 'columna inexistente',
    });
  });
});

describe('loadEmpresaEmisor — marca', () => {
  const storage = {
    from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }),
  };
  /** Cliente que responde a `select(columnas)` según una función. */
  const clienteCon = (responder: (columnas: string) => { data: unknown; error: unknown }): EmpresaLoaderClient =>
    ({
      from: () => ({
        select: (columnas: string) => ({ eq: () => ({ maybeSingle: async () => responder(columnas) }) }),
      }),
      storage,
    }) as unknown as EmpresaLoaderClient;

  it('devuelve la marca del negocio junto al emisor', async () => {
    const supabase = clienteCon(() => ({
      data: {
        razon_social: 'Estudio X',
        marca_color_primario: '#7A7A1E',
        marca_color_secundario: 'no-es-un-color',
        marca_tipografia: 'Times-Roman',
        marca_observaciones_presupuesto: ' Validez 15 días ',
      },
      error: null,
    }));
    const res = await loadEmpresaEmisor(supabase, 'biz-1');
    expect(res.ok && res.marca).toEqual({
      colorPrimario: '#7A7A1E',
      colorSecundario: null, // inválido: se ignora
      tipografia: 'Times-Roman',
      observacionesPresupuesto: 'Validez 15 días',
    });
  });

  it('sin columnas de marca rellenas, la marca está vacía (aspecto de siempre)', async () => {
    const res = await loadEmpresaEmisor(clienteCon(() => ({ data: { razon_social: 'X' }, error: null })), 'b');
    expect(res.ok && res.marca).toEqual({
      colorPrimario: null,
      colorSecundario: null,
      tipografia: null,
      observacionesPresupuesto: null,
    });
  });

  it('si la migración de marca aún no está aplicada (42703), reintenta sin esas columnas y los PDF siguen saliendo', async () => {
    const pedidas: string[] = [];
    const supabase = clienteCon((columnas) => {
      pedidas.push(columnas);
      return columnas.includes('marca_')
        ? { data: null, error: { code: '42703', message: 'column business_profiles.marca_tipografia does not exist' } }
        : { data: { razon_social: 'Pino' }, error: null };
    });
    const res = await loadEmpresaEmisor(supabase, 'biz-1');
    expect(pedidas).toHaveLength(2);
    expect(pedidas[1]).not.toContain('marca_');
    expect(res.ok && res.empresa.razonSocial).toBe('Pino');
    expect(res.ok && res.marca.colorPrimario).toBeNull();
  });
});
