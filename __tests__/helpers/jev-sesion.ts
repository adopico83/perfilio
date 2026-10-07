import { crearFakeDb } from './fake-db';
import { NEGOCIO_A, USUARIO, crearBaseSimulada } from '../../evals/base-simulada';
import { confirmarOrdenJev, procesarMensajeJev } from '@/lib/jev/motor';
import { crearRunToolJev } from '@/lib/jev/despacho';
import type { OrdenJev } from '@/lib/jev/ordenes';

export const MARTES = '2026-10-06T10:00:00Z';

export function baseRonda5() {
  const b = crearBaseSimulada();
  b.clientes.push(
    { id: 'cli-mikel-prueba', business_id: NEGOCIO_A, nombre: 'Mikel PRUEBA Etxeberria', nif: '11111111H', direccion: 'Calle Prueba 1', telefono: null },
    { id: 'cli-iker-agirre', business_id: NEGOCIO_A, nombre: 'Iker Agirre', nif: '22222222J', direccion: 'Calle Agirre 2', telefono: null },
    { id: 'cli-iker-prueba', business_id: NEGOCIO_A, nombre: 'Iker PRUEBA Goikoetxea', nif: null, direccion: null, telefono: null }
  );
  return b;
}

export function sesion(db: ReturnType<typeof crearFakeDb>, ahora = MARTES) {
  let reloj = new Date(ahora);
  /** Lo último que dijo el asistente (como hace el navegador con el historial): un «sí» escrito solo confirma si era la pregunta de ESA orden. */
  let ultimoAsistente: string | undefined;
  const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
  const base = { supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, runTool };
  return {
    /** Simula que lo último que dijo el asistente fue otra cosa (para probar que un «vale» no confirma una orden ajena). */
    decirAsistente: (texto: string) => {
      ultimoAsistente = texto;
    },
    cambiarReloj: (iso: string) => {
      reloj = new Date(iso);
    },
    async di(mensaje: string, orden: OrdenJev, opciones: { continua?: boolean; categoria?: string; ultimoPresupuestoId?: string | null; ultimaFacturaId?: string | null; ultimoEventoId?: string | null; otras?: OrdenJev[] } = {}) {
      const r = await procesarMensajeJev({
        ...base,
        ultimoAsistente,
        mensaje,
        categoria: opciones.categoria ?? 'general',
        hoyTexto: 'martes 6 de octubre de 2026',
        ahora: reloj,
        ultimoPresupuestoId: opciones.ultimoPresupuestoId ?? null,
        ultimaFacturaId: opciones.ultimaFacturaId ?? null,
        ultimoEventoId: opciones.ultimoEventoId ?? null,
        traducir: async () => ({ orden, continuaTarea: opciones.continua === true, ...(opciones.otras ? { otras: opciones.otras } : {}) }),
      });
      ultimoAsistente = r.respuesta;
      return r;
    },
    async sinTraductor(mensaje: string) {
      const r = await procesarMensajeJev({
        ...base,
        ultimoAsistente,
        mensaje,
        categoria: 'general',
        hoyTexto: 'martes',
        ahora: reloj,
        traducir: async () => {
          throw new Error('el traductor no debía llamarse');
        },
      });
      ultimoAsistente = r.respuesta;
      return r;
    },
    confirmar: (ordenId: string) => confirmarOrdenJev({ ...base, ordenId }),
  };
}

