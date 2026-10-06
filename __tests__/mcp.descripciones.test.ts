import { createPerfilioMcpServer } from '@/lib/mcp/server';
import type { McpContext } from '@/lib/mcp/context';

type Registered = {
  description?: string;
  inputSchema?: { shape?: Record<string, unknown> };
};

function herramientas(): Record<string, Registered> {
  const server = createPerfilioMcpServer({
    businessId: 'biz-1',
    userId: 'user-1',
    supabase: {} as McpContext['supabase'],
  });
  const bag = server as unknown as { _registeredTools?: Record<string, Registered> };
  return bag._registeredTools ?? {};
}

// Tools que escriben datos: la descripción debe pedir confirmación al usuario.
const ESCRIBEN = [
  'crear_cita',
  'crear_factura_desde_presupuesto',
  'crear_presupuesto',
  'confirmar_presupuesto',
  'registrar_horas',
  'crear_entrada_diario',
  'adjuntar_foto_diario',
];

describe('MCP: descripciones pensadas para asistentes externos', () => {
  const tools = herramientas();

  it('registra las 17 tools y todas tienen descripción de longitud razonable', () => {
    const nombres = Object.keys(tools);
    expect(nombres).toHaveLength(17);
    for (const nombre of nombres) {
      const d = tools[nombre].description ?? '';
      expect(d.length).toBeGreaterThan(40);
      expect(d.length).toBeLessThan(1500);
    }
  });

  it('ninguna tool recibe business_id (se usa el de la conexión)', () => {
    for (const t of Object.values(tools)) {
      expect(Object.keys(t.inputSchema?.shape ?? {})).not.toContain('business_id');
    }
  });

  it.each(ESCRIBEN)('%s menciona confirmación o aprobación del usuario', (nombre) => {
    expect(tools[nombre].description ?? '').toMatch(/confirm|aprob|pregunt/i);
  });

  it('ver_obras_activas y ver_facturas_pendientes dicen qué campos devuelven', () => {
    expect(tools.ver_obras_activas.description).toMatch(/id[\s\S]*nombre[\s\S]*direccion[\s\S]*estado/);
    expect(tools.ver_facturas_pendientes.description).toMatch(/numero_factura[\s\S]*cliente_nombre[\s\S]*total/);
  });

  it('crear_presupuesto desaconseja el atajo y registrar_horas avisa de la ambigüedad', () => {
    expect(tools.crear_presupuesto.description).toMatch(/NO la uses/);
    expect(tools.registrar_horas.description).toMatch(/varios operarios/);
  });
});
