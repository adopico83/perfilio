import { respuestaModelo } from './helpers/modelo-dos-pasos';
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NEGOCIO_A, USUARIO, IDS, crearBaseSimulada } from '../evals/base-simulada';
import { crearFakeDb } from './helpers/fake-db';
import { reiniciarContadorEnMemoria } from '@/lib/ia/limite-uso';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: createMock } } })) }));

let db: ReturnType<typeof crearFakeDb>;
let ordenDelModelo: Record<string, unknown>;

beforeAll(() => {
  process.env.AGENTE_MOTOR = 'jev';
  delete process.env.AGENTE_CONFIRMACION;
  process.env.OPENAI_API_KEY = 'k';
  delete process.env.JEV_API_KEY;
});
afterAll(() => {
  process.env.AGENTE_MOTOR = 'legacy';
});

beforeEach(() => {
  reiniciarContadorEnMemoria();
  db = crearFakeDb(crearBaseSimulada());
  (createServiceClient as jest.Mock).mockReturnValue(db.client);
  (createClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) } });
  ordenDelModelo = { accion: 'CERRAR_OBRA', obra_texto: 'Reforma Paqui' };
  createMock.mockReset();
  createMock.mockImplementation(async (req: { tools?: Array<{ function: { name: string } }> }) => respuestaModelo(req, ordenDelModelo));
});

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/agente/route');
  const res = await POST(new NextRequest('http://localhost/api/agente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], ...body }) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const obra = () => db.tablas.obras!.find((o) => o.id === IDS.obraPaqui)!;

describe('ruta /api/agente con el motor .jev: la confirmación solo acepta el id de la orden', () => {
  it('una confirmación con tool y args del navegador (sin orden_id) se rechaza y no ejecuta nada', async () => {
    const r = await post({ confirmar_accion: { tool: 'actualizar_obra', args: { obra_id: IDS.obraPaqui, estado: 'cerrada' } } });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/orden_id/);
    expect(obra().estado).toBe('en_curso');
  });
  it('si el navegador manda orden_id Y args distintos, se ignoran los args: se ejecuta lo guardado', async () => {
    const p = await post({ mensaje: 'cierra la obra de Paqui' });
    const id = (p.json.accion_pendiente as { orden_id: string }).orden_id;
    const r = await post({ confirmar_accion: { orden_id: id, tool: 'actualizar_obra', args: { obra_id: IDS.obraOlabide9, estado: 'cerrada' } } });
    expect(r.status).toBe(200);
    expect(obra().estado).toBe('cerrada'); // la propuesta (Paqui)
    expect(db.tablas.obras!.find((o) => o.id === IDS.obraOlabide9)!.estado).toBe('en_curso'); // la que quiso colar
  });
  it('un orden_id inventado no hace nada', async () => {
    const r = await post({ confirmar_accion: { orden_id: 'inventado-123' } });
    expect(r.status).toBe(200);
    expect(String(r.json.respuesta)).toMatch(/No encuentro esa propuesta/);
    expect(obra().estado).toBe('en_curso');
  });
  it('cancelar_orden la anula y después ya no se puede confirmar', async () => {
    const p = await post({ mensaje: 'cierra la obra de Paqui' });
    const id = (p.json.accion_pendiente as { orden_id: string }).orden_id;
    const c = await post({ cancelar_orden: id });
    expect(String(c.json.respuesta)).toMatch(/no hago nada/i);
    const r = await post({ confirmar_accion: { orden_id: id } });
    expect(String(r.json.respuesta)).toMatch(/ya se ha usado/);
    expect(obra().estado).toBe('en_curso');
  });
  it('un «sí» ESCRITO confirma solo la orden pendiente real (y si no hay, no hace nada)', async () => {
    const nada = await post({ mensaje: 'sí', historial: [{ role: 'assistant', content: 'Hecho.' }] });
    expect(String(nada.json.respuesta)).toMatch(/No tengo nada pendiente/);
    expect(createMock).not.toHaveBeenCalled();
    await post({ mensaje: 'cierra la obra de Paqui' });
    expect(obra().estado).toBe('en_curso');
    const si = await post({ mensaje: 'sí' });
    expect(si.status).toBe(200);
    expect(obra().estado).toBe('cerrada');
  });
  it('el modelo solo ve las funciones elegir_accion y orden_jev (ninguna tool de escritura)', async () => {
    await post({ mensaje: 'cierra la obra de Paqui' });
    const req = createMock.mock.calls[0]![0] as { tools: Array<{ function: { name: string } }> };
    expect(req.tools.map((t) => t.function.name)).toEqual(['elegir_accion']);
    const todas = createMock.mock.calls.flatMap((c) => (c[0] as typeof req).tools.map((t) => t.function.name));
    expect(new Set(todas)).toEqual(new Set(['elegir_accion', 'orden_jev']));
  });
  it('si el modelo devuelve una orden inventada, se pregunta (no se ejecuta)', async () => {
    ordenDelModelo = { accion: 'BORRAR_TODO' };
    const r = await post({ mensaje: 'borra todo' });
    expect(r.json.accion_pendiente).toBeUndefined();
    expect(String(r.json.respuesta)).toMatch(/No te he entendido/);
  });
  it('el límite de uso de la IA sigue aplicando al traductor', async () => {
    let ultimo = 200;
    for (let i = 0; i < 25 && ultimo === 200; i++) ultimo = (await post({ mensaje: `hola ${i}` })).status;
    expect(ultimo).toBe(429);
  });
  it('con una foto adjunta se usa el camino antiguo, pero la propuesta también se guarda en el servidor (solo orden_id al navegador)', async () => {
    const gasto = { proveedor: 'Saltoki', importe: 100, iva: 21, importe_total: 121, fecha: '2026-10-06', categoria: 'material', descripcion: 'Cable', obra_id: IDS.obraPaqui };
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'registrar_gasto_ticket', arguments: JSON.stringify(gasto) } }] } }] })
      .mockResolvedValue({ choices: [{ message: { content: '¿Lo hago?' } }] });
    const r = await post({ mensaje: 'apunta este ticket de Saltoki', imagen: 'data:image/png;base64,iVBORw0KGgo=' });
    const accion = r.json.accion_pendiente as { orden_id?: string; args: Record<string, unknown>; tool: string } | undefined;
    expect(accion?.tool).toBe('registrar_gasto_ticket');
    expect(accion?.orden_id).toBeTruthy();
    expect(accion?.args).toEqual({});
    expect(db.tablas.gastos ?? []).toHaveLength(0);
    const c = await post({ confirmar_accion: { orden_id: accion!.orden_id } });
    expect(c.status).toBe(200);
    expect(db.tablas.gastos!.at(-1)).toMatchObject({ proveedor: 'Saltoki', importe_total: 121, obra_id: IDS.obraPaqui, descripcion: 'Cable' });
  });
});
