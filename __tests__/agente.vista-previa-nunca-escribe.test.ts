import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { TOOLS_REQUIEREN_CONFIRMACION, TOOLS_CON_VISTA_PREVIA } from '@/lib/agente/confirmacion';
import { handleAgenda } from '@/lib/agente/modules/agenda';
import { IDS, NEGOCIO_A, USUARIO, crearBaseSimulada } from '../evals/base-simulada';
import { reiniciarContadorEnMemoria } from '@/lib/ia/limite-uso';
import { crearFakeDb } from './helpers/fake-db';

jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/supabase/server', () => ({ createServiceClient: jest.fn(), createClient: jest.fn() }));
const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));

const CONFIRMACIONES = ['vale', 'sí', 'ok', 'adelante', 'hazlo', 'confirmo', 'elimina'];

describe('una vista previa NUNCA escribe, diga lo que diga el último mensaje', () => {
  const evento = { id: 'ev-1', business_id: NEGOCIO_A, titulo: 'Visita', fecha: '2026-10-08', hora: '10:00' };
  const escrituras = (d: ReturnType<typeof crearFakeDb>) => d.inserts.length + d.updates.length;

  it.each(CONFIRMACIONES)('agenda con mensaje «%s»: crear, mover y borrar en vista previa no tocan la base', async (msg) => {
    const d = crearFakeDb({ ...crearBaseSimulada(), agenda: [{ ...evento }] });
    const llamar = (tool: string, args: Record<string, unknown>) =>
      handleAgenda(tool, { solo_vista_previa: true, ...args }, NEGOCIO_A, USUARIO, d.client, {} as never, { mensajeTrim: msg });

    const crear = await llamar('crear_recordatorio', { titulo: 'Cita con Paqui', fecha: '2026-10-09', hora: '11:00' });
    expect(crear.pendiente_confirmacion).toBe(true);
    await llamar('eliminar_recordatorio', { id: 'ev-1' });
    await llamar('eliminar_evento_agenda', { evento_id: 'ev-1' });
    await llamar('eliminar_evento_agenda', { titulo_fragmento: 'Visita', fecha: '2026-10-08' });
    await llamar('modificar_evento_agenda', { evento_id: 'ev-1', fecha: '2026-10-10' });
    expect(escrituras(d)).toBe(0);
    expect(d.tablas.agenda).toHaveLength(1);
  });

  describe('por la ruta, con el modelo pidiendo la tool', () => {
    beforeEach(() => {
      reiniciarContadorEnMemoria();
      delete process.env.JEV_API_KEY;
      delete process.env.AGENTE_CONFIRMACION;
      process.env.OPENAI_API_KEY = 'k';
      (createClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USUARIO, email: 'p@x.es' } } }) } });
    });

    const post = async (mensaje: string) => {
      const { POST } = await import('@/app/api/agente/route');
      const res = await POST(
        new NextRequest('http://localhost/api/agente', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: NEGOCIO_A, historial: [], mensaje }),
        })
      );
      return res.json() as Promise<Record<string, unknown>>;
    };

    it('NINGUNA tool de escritura escribe con el mensaje «vale», ni pidiendo la vista previa ni sin pedirla', async () => {
      const ARGS_TIPICOS: Record<string, Record<string, unknown>> = {
        crear_recordatorio: { titulo: 'Cita', fecha: '2026-10-09', hora: '11:00' },
        eliminar_recordatorio: { id: 'ev-1' },
        eliminar_evento_agenda: { evento_id: 'ev-1' },
        modificar_evento_agenda: { evento_id: 'ev-1', fecha: '2026-10-10' },
        crear_cliente: { nombre: 'Lola Nueva' },
        crear_obra: { nombre: 'Obra Nueva' },
        cambiar_estado_factura: { id: IDS.factura3, estado: 'pagada' },
        convertir_presupuesto_a_factura: { presupuesto_id: IDS.presupuesto7 },
        registrar_jornada: { operario_nombre: 'Iker', obra_nombre: 'Paqui', horas: 8 },
        crear_entrada_diario: { obra_nombre: 'Paqui', texto: 'Picado del baño' },
        registrar_gasto_ticket: { importe: 85, proveedor: 'Bricomart' },
      };
      for (const tool of TOOLS_REQUIEREN_CONFIRMACION) {
        for (const vista of [true, false]) {
          if (vista && !TOOLS_CON_VISTA_PREVIA.has(tool)) continue;
          const d = crearFakeDb({ ...crearBaseSimulada(), agenda: [{ ...evento }] });
          (createServiceClient as jest.Mock).mockReturnValue(d.client);
          createMock.mockReset();
          const args = { ...(ARGS_TIPICOS[tool] ?? {}), ...(vista ? { solo_vista_previa: true } : {}) };
          createMock
            .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } }] })
            .mockResolvedValue({ choices: [{ message: { content: 'Vale.' } }] });
          reiniciarContadorEnMemoria();
          await post('vale');
          expect({ tool, vista, escrituras: escrituras(d) }).toEqual({ tool, vista, escrituras: 0 });
        }
      }
    });
  });
});
