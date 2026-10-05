import { createPerfilioMcpServer } from '@/lib/mcp/server';
import type { McpContext } from '@/lib/mcp/context';

type Registered = {
  description?: string;
  inputSchema?: { shape?: Record<string, unknown> };
};

function registeredTools(server: ReturnType<typeof createPerfilioMcpServer>): Record<string, Registered> {
  const bag = server as unknown as { _registeredTools?: Record<string, Registered> };
  return bag._registeredTools ?? {};
}

describe('MCP agenda', () => {
  it('registra crear_cita y ver_citas sin business_id en la entrada', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tools = registeredTools(server);
    const crear = tools.crear_cita;
    const ver = tools.ver_citas;
    expect(crear).toBeDefined();
    expect(ver).toBeDefined();
    expect(crear.description ?? '').toMatch(/Europe\/Madrid/);
    expect(crear.description ?? '').toMatch(/google_calendar_hint/);
    expect(crear.description ?? '').toMatch(/no llama a Google/i);
    expect(ver.description ?? '').toMatch(/próximas citas/i);

    const crearShape = crear.inputSchema?.shape ?? {};
    expect(Object.keys(crearShape).sort()).toEqual([
      'asunto',
      'fecha',
      'hora_fin',
      'hora_inicio',
      'lugar',
      'notas',
    ]);
    expect(crearShape).not.toHaveProperty('business_id');

    const parsed = crear.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({}).success).toBe(false);
    expect(
      parsed.safeParse?.({
        asunto: 'Cita con Mendi',
        fecha: 'mañana',
        hora_inicio: '10:00',
        lugar: 'Obra',
      }).success
    ).toBe(true);

    const verShape = ver.inputSchema?.shape ?? {};
    expect(Object.keys(verShape).sort()).toEqual(['desde', 'hasta', 'limite']);
    expect(verShape).not.toHaveProperty('business_id');
  });
});

describe('MCP adjuntar_foto_diario', () => {
  it('registra storage_paths como camino principal y foto_urls como alternativa, sin base64', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).adjuntar_foto_diario;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/storage_paths/i);
    expect(tool.description ?? '').toMatch(/no admite base64/i);
    expect(tool.description ?? '').toMatch(/https/i);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['entrada_diario_id', 'foto_urls', 'storage_paths']);
    expect(shape).not.toHaveProperty('foto_base64');
    expect(shape).not.toHaveProperty('mime_type');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({ entrada_diario_id: 'x', foto_urls: [] }).success).toBe(false);
    expect(parsed.safeParse?.({ entrada_diario_id: 'x', storage_paths: [] }).success).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: 'x',
        storage_paths: Array.from({ length: 9 }, () => 'biz/a.jpg'),
      }).success
    ).toBe(false);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
        storage_paths: ['biz-1/a.jpg', 'biz-1/b.jpg'],
      }).success
    ).toBe(true);
    expect(
      parsed.safeParse?.({
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
        foto_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      }).success
    ).toBe(true);
  });
});

describe('MCP crear_upload_firmado_diario', () => {
  it('pide mime_type y no acepta el archivo en el tool', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).crear_upload_firmado_diario;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/diario-obra/i);
    expect(tool.description ?? '').toMatch(/PUT/i);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['entrada_diario_id', 'mime_type', 'nombre_archivo']);
    expect(shape).not.toHaveProperty('foto_base64');
    expect(shape).not.toHaveProperty('business_id');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({}).success).toBe(false);
    expect(parsed.safeParse?.({ mime_type: 'image/jpeg' }).success).toBe(true);
    expect(
      parsed.safeParse?.({
        mime_type: 'image/png',
        nombre_archivo: 'fachada.png',
        entrada_diario_id: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true);
  });
});

describe('MCP ver_presupuestos / ver_presupuesto', () => {
  it('registra ambas tools de solo lectura sin business_id en la entrada', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tools = registeredTools(server);
    const lista = tools.ver_presupuestos;
    const detalle = tools.ver_presupuesto;
    expect(lista).toBeDefined();
    expect(detalle).toBeDefined();
    for (const t of [lista, detalle]) {
      expect(t.description ?? '').toMatch(/solo lectura/i);
      expect(t.description ?? '').toMatch(/nunca (los )?recalcul/i);
      expect(t.inputSchema?.shape ?? {}).not.toHaveProperty('business_id');
    }

    expect(Object.keys(lista.inputSchema?.shape ?? {}).sort()).toEqual([
      'cliente',
      'desde',
      'estado',
      'hasta',
      'limite',
    ]);
    expect(Object.keys(detalle.inputSchema?.shape ?? {}).sort()).toEqual(['id', 'numero']);

    const parsed = detalle.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({ id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(parsed.safeParse?.({ numero: 4 }).success).toBe(true);
    const parsedLista = lista.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsedLista.safeParse?.({}).success).toBe(true);
  });
});

describe('MCP obtener_enlace_pdf_presupuesto', () => {
  it('registra la tool sin business_id y con dias_validez opcional', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).obtener_enlace_pdf_presupuesto;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/firmado/i);
    expect(tool.description ?? '').toMatch(/confirmados/i);
    expect(tool.description ?? '').toMatch(/30/);

    const shape = tool.inputSchema?.shape ?? {};
    expect(Object.keys(shape).sort()).toEqual(['dias_validez', 'id', 'numero']);
    expect(shape).not.toHaveProperty('business_id');

    const parsed = tool.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsed.safeParse?.({ id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(parsed.safeParse?.({ numero: 4, dias_validez: 3 }).success).toBe(true);
  });
});

describe('MCP previsualizar_presupuesto / confirmar_presupuesto', () => {
  it('registra las dos tools sin business_id, con descripciones de previsualizar antes de confirmar', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tools = registeredTools(server);
    const previsualizar = tools.previsualizar_presupuesto;
    const confirmar = tools.confirmar_presupuesto;
    expect(previsualizar).toBeDefined();
    expect(confirmar).toBeDefined();

    expect(previsualizar.description ?? '').toMatch(/previsualiza/i);
    expect(previsualizar.description ?? '').toMatch(/aprobaci[oó]n/i);
    expect(confirmar.description ?? '').toMatch(/aprobado/i);
    expect(confirmar.description ?? '').toMatch(/idempotente|dos veces/i);

    const previsualizarShape = previsualizar.inputSchema?.shape ?? {};
    expect(previsualizarShape).not.toHaveProperty('business_id');
    const confirmarShape = confirmar.inputSchema?.shape ?? {};
    expect(confirmarShape).not.toHaveProperty('business_id');

    const parsedConfirmar = confirmar.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsedConfirmar.safeParse?.({}).success).toBe(false);
    expect(parsedConfirmar.safeParse?.({ preview_id: 'x' }).success).toBe(true);

    const parsedPrevisualizar = previsualizar.inputSchema as unknown as {
      safeParse?: (value: unknown) => { success: boolean };
    };
    expect(parsedPrevisualizar.safeParse?.({}).success).toBe(false);
    expect(
      parsedPrevisualizar.safeParse?.({
        cliente_nombre: 'Pino',
        capitulos: [{ partidas: [{ descripcion: 'Alicatado', cantidad: 20, precio_unitario: 35 }] }],
      }).success
    ).toBe(true);
  });
});
describe('MCP resumen_del_dia', () => {
  it('se registra sin parámetros de entrada (el negocio sale de la conexión)', () => {
    const server = createPerfilioMcpServer({
      businessId: 'biz-1',
      userId: 'user-1',
      supabase: {} as McpContext['supabase'],
    });
    const tool = registeredTools(server).resumen_del_dia;
    expect(tool).toBeDefined();
    expect(tool.description ?? '').toMatch(/citas de hoy y de mañana/i);
    expect(Object.keys(tool.inputSchema?.shape ?? {})).toEqual([]);
  });
});
