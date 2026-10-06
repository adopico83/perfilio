import { executeMcpTool } from '@/lib/mcp/execute-tool';
import { createPerfilioMcpServer } from '@/lib/mcp/server';
import type { McpContext } from '@/lib/mcp/context';
import { crearFakeDb, type Fila } from './helpers/fake-db';

const BIZ = 'biz-1';
const OBRA_A = '11111111-1111-4111-8111-111111111111';
const OBRA_B = '22222222-2222-4222-8222-222222222222';
const OBRA_AJENA = '33333333-3333-4333-8333-333333333333';

function montar(obras: Fila[]) {
  const d = crearFakeDb({ obras, diario_obra: [] });
  const ctx: McpContext = { supabase: d.client, businessId: BIZ, userId: 'u' };
  return { d, ctx };
}
const OBRAS: Fila[] = [
  { id: OBRA_A, business_id: BIZ, nombre: 'Reforma cocina Pino', direccion: 'Calle A 1' },
  { id: OBRA_B, business_id: BIZ, nombre: 'Reforma baño Pino', direccion: 'Calle B 2' },
  { id: OBRA_AJENA, business_id: 'otro', nombre: 'Reforma ajena', direccion: null },
];

describe('crear_entrada_diario con obra_id', () => {
  it('guarda en la obra exacta sin tener que buscar por nombre', async () => {
    const { d, ctx } = montar(OBRAS);
    const r = await executeMcpTool('crear_entrada_diario', { obra_id: OBRA_B, descripcion: 'Alicatado' }, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(d.inserts[0].fila).toMatchObject({
      business_id: BIZ,
      obra_id: OBRA_B,
      obra_nombre: 'Reforma baño Pino',
      obra_direccion: 'Calle B 2',
      texto: 'Alicatado',
    });
  });

  it('obra_id manda sobre obra_nombre', async () => {
    const { d, ctx } = montar(OBRAS);
    await executeMcpTool(
      'crear_entrada_diario',
      { obra_id: OBRA_A, obra_nombre: 'Reforma baño', descripcion: 'x' },
      ctx
    );
    expect(d.inserts[0].fila.obra_id).toBe(OBRA_A);
  });

  it('rechaza una obra de otro negocio y no inserta', async () => {
    const { d, ctx } = montar(OBRAS);
    const r = await executeMcpTool('crear_entrada_diario', { obra_id: OBRA_AJENA, descripcion: 'x' }, ctx);
    expect(r).toMatchObject({ error: expect.stringContaining('no existe o no pertenece') });
    expect(d.inserts).toHaveLength(0);
  });

  it('rechaza un obra_id que no es uuid', async () => {
    const { ctx } = montar(OBRAS);
    expect(await executeMcpTool('crear_entrada_diario', { obra_id: 'abc', descripcion: 'x' }, ctx)).toMatchObject({
      error: expect.stringContaining('uuid'),
    });
  });

  it('exige obra_id u obra_nombre', async () => {
    const { ctx } = montar(OBRAS);
    expect(await executeMcpTool('crear_entrada_diario', { descripcion: 'x' }, ctx)).toEqual({
      error: 'Indica obra_id u obra_nombre',
    });
  });
});

describe('crear_entrada_diario con obra_nombre (compatibilidad)', () => {
  it('un nombre que encaja con una sola obra funciona como siempre', async () => {
    const { d, ctx } = montar(OBRAS);
    const r = await executeMcpTool('crear_entrada_diario', { obra_nombre: 'cocina', descripcion: 'x' }, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(d.inserts[0].fila.obra_id).toBe(OBRA_A);
  });

  it('si encaja con varias, devuelve candidatos con id y no inserta', async () => {
    const { d, ctx } = montar(OBRAS);
    const r = (await executeMcpTool('crear_entrada_diario', { obra_nombre: 'Reforma', descripcion: 'x' }, ctx)) as {
      error: string;
      candidatos: Array<{ id: string; nombre: string; direccion: string | null }>;
    };
    expect(r.error).toMatch(/varias obras/);
    expect(r.candidatos.map((c) => c.id).sort()).toEqual([OBRA_A, OBRA_B].sort());
    expect(r.candidatos[0]).toHaveProperty('direccion');
    expect(d.inserts).toHaveLength(0);
  });

  it('sin coincidencias, error sin candidatos', async () => {
    const { ctx } = montar(OBRAS);
    const r = await executeMcpTool('crear_entrada_diario', { obra_nombre: 'zzz', descripcion: 'x' }, ctx);
    expect(r).toMatchObject({ error: expect.stringContaining('No se encontró') });
    expect(r).not.toHaveProperty('candidatos');
  });
});

describe('registro de crear_entrada_diario', () => {
  it('obra_id y obra_nombre opcionales; descripcion y fecha como antes; descripción orienta a ver_obras_activas', () => {
    const { ctx } = montar([]);
    const server = createPerfilioMcpServer(ctx) as unknown as {
      _registeredTools: Record<string, { description?: string; inputSchema?: { shape: Record<string, { isOptional?: () => boolean }> } }>;
    };
    const t = server._registeredTools.crear_entrada_diario;
    expect(Object.keys(t.inputSchema!.shape).sort()).toEqual(['descripcion', 'fecha', 'obra_id', 'obra_nombre']);
    expect(t.inputSchema!.shape.obra_nombre.isOptional?.()).toBe(true);
    expect(t.inputSchema!.shape.obra_id.isOptional?.()).toBe(true);
    expect(t.inputSchema!.shape.descripcion.isOptional?.()).toBe(false);
    expect(t.description).toMatch(/ver_obras_activas y pasa obra_id/);
  });
});
