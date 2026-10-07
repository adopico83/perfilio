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
  const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
  const base = { supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, runTool };
  return {
    cambiarReloj: (iso: string) => {
      reloj = new Date(iso);
    },
    async di(mensaje: string, orden: OrdenJev, opciones: { continua?: boolean; categoria?: string; ultimoPresupuestoId?: string | null; ultimaFacturaId?: string | null } = {}) {
      return procesarMensajeJev({
        ...base,
        mensaje,
        categoria: opciones.categoria ?? 'general',
        hoyTexto: 'martes 6 de octubre de 2026',
        ahora: reloj,
        ultimoPresupuestoId: opciones.ultimoPresupuestoId ?? null,
        ultimaFacturaId: opciones.ultimaFacturaId ?? null,
        traducir: async () => ({ orden, continuaTarea: opciones.continua === true }),
      });
    },
    async sinTraductor(mensaje: string) {
      return procesarMensajeJev({
        ...base,
        mensaje,
        categoria: 'general',
        hoyTexto: 'martes',
        ahora: reloj,
        traducir: async () => {
          throw new Error('el traductor no debía llamarse');
        },
      });
    },
    confirmar: (ordenId: string) => confirmarOrdenJev({ ...base, ordenId }),
  };
}

