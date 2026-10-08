/** Cola de órdenes (idea 3): claves, repeticiones, estados y avisos como campo propio. */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { claveOrden, planInicial, siguienteDeLaCola, sinRepetidas } from '@/lib/jev/cola';
import { guardianFinal } from '@/lib/jev/motor';

jest.mock('openai', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/pdf/presupuesto-render', () => ({
  PRESUPUESTO_PDF_COLUMNS: 'id, business_id, numero_presupuesto, cliente_nombre, estado',
  nombreArchivoPresupuestoPdf: () => 'presupuesto.pdf',
  renderPresupuestoPdf: async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06' }),
}));
jest.mock('@/lib/pdf/factura-render', () => ({
  FACTURA_PDF_COLUMNS: 'id, business_id, numero_factura, cliente_nombre',
  nombreArchivoFacturaPdf: (_f: string, n: number) => `factura-${n}.pdf`,
  renderFacturaPdf: jest.fn(async () => ({ ok: true, buffer: Buffer.from('%PDF'), fecha: '2026-10-06', numero_factura: 3 })),
}));

const o = (x: Record<string, unknown>) => x as unknown as OrdenJev;
const G1 = { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' };
const G2 = { accion: 'GASTO', proveedor_texto: 'saltoki', importe_texto: '87.40', iva_modo: 'mas', obra_texto: 'lo de Leire', descripcion_texto: 'material' };
const H = { accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' };

describe('claveOrden: «la misma orden» escrita de otra forma', () => {
  it('mismo gasto con otro formato de importe, mayúsculas, artículos, IVA y descripción → misma clave', () => {
    expect(claveOrden(G1)).toBe(claveOrden(G2));
  });
  it('otro importe, otro proveedor o otro tipo → otra clave', () => {
    expect(claveOrden(G1)).not.toBe(claveOrden({ ...G1, importe_texto: '20' }));
    expect(claveOrden(G1)).not.toBe(claveOrden({ ...G1, proveedor_texto: 'Maderas Oria' }));
    expect(claveOrden(H)).not.toBe(claveOrden({ ...H, horas_texto: '6 horas y media' }));
    expect(claveOrden(H)).toBe(claveOrden({ ...H, horas_texto: '6 horas' }));
  });
  it('sinRepetidas conserva la primera y cuenta las repetidas', () => {
    const r = sinRepetidas([G1, H, G2]);
    expect(r.ordenes).toEqual([G1, H]);
    expect(r.repetidas).toEqual([G2]);
  });
});

describe('siguienteDeLaCola: lo hecho o ya enseñado no se repite', () => {
  it('salta las repetidas y devuelve la primera que toca', () => {
    const plan = { ...planInicial(G1, [H]), [claveOrden(G1)]: 'hecha' as const };
    const r = siguienteDeLaCola([G2, H], plan);
    expect(r.saltadas).toEqual([G2]);
    expect(r.sig).toEqual(H);
    expect(r.resto).toEqual([]);
  });
  it('planInicial: la primera «enseñada», el resto «en_cola»', () => {
    const p = planInicial(G1, [H]);
    expect(p[claveOrden(G1)]).toBe('enseñada');
    expect(p[claveOrden(H)]).toBe('en_cola');
  });
});

describe('en el motor', () => {
  it('el modelo copia el gasto con otro formato: se guarda UNA vez y las horas quedan en la cola', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('apunta 87,40 de Saltoki para lo de Leire y de paso ponle 6 horas a Jon en lo de Paqui', o(G1), { otras: [o(G2), o(H)], intencion: 'VARIAS', categoria: 'gastos' });
    const c1 = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c1.accionPendiente).toBeDefined();
    expect(c1.respuesta).toMatch(/Jon/);
    await s.confirmar(c1.accionPendiente!.orden_id);
    expect(db.tablas.gastos.length).toBe(1);
    expect(db.tablas.registros_jornada.length).toBe(1);
  });

  it('una repetida que llega por la cola se salta CON AVISO (campo avisos) y no se guarda', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('apunta 87,40 de Saltoki para lo de Leire y ponle 6 horas a Jon en lo de Paqui', o(G1), { categoria: 'gastos' });
    // La cola trae una copia del gasto y las horas (como si el modelo las hubiese mandado así).
    const fila = (db.tablas as Record<string, Array<Record<string, unknown> & { id?: string; orden?: unknown; args_resueltos?: unknown }>>).jev_ordenes_pendientes.find((f) => f.id === p.accionPendiente!.orden_id)!;
    fila.args_resueltos = { ...(fila.args_resueltos as object), siguientes: [G2, H] };
    const c1 = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c1.avisos).toEqual([expect.stringMatching(/Me salto .* no lo repito/)]);
    expect(c1.respuesta).toMatch(/⚠️ Me salto/);
    expect(c1.accionPendiente).toBeDefined(); // las horas
    await s.confirmar(c1.accionPendiente!.orden_id);
    expect(db.tablas.gastos.length).toBe(1);
    expect(db.tablas.registros_jornada.length).toBe(1);
  });

  it('una orden que no está «enseñada» no se puede confirmar', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('apunta 87,40 de Saltoki para lo de Leire', o(G1), { categoria: 'gastos' });
    const fila = (db.tablas as Record<string, Array<Record<string, unknown> & { id?: string; orden?: unknown; args_resueltos?: unknown }>>).jev_ordenes_pendientes.find((f) => f.id === p.accionPendiente!.orden_id)!;
    fila.args_resueltos = { ...(fila.args_resueltos as object), plan: { [claveOrden(fila.orden)]: 'en_cola' } };
    const r = await s.confirmar(p.accionPendiente!.orden_id);
    expect(r.respuesta).toMatch(/todavía no te la he enseñado/);
    expect(db.tablas.gastos.length).toBe(0);
  });
});

describe('avisos[] es el campo, el texto solo lo muestra', () => {
  it('guardianFinal deja los avisos en avisos[] y escritos en la respuesta, antes de la marca de la orden', () => {
    const r = guardianFinal('apunta 87,40 de Saltoki y ponle 6 horas a Jon', { respuesta: 'Voy a registrar un gasto.\n¿Lo hago?<!--orden:x-->' }, [{ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }], true);
    expect(r.avisos).toEqual([expect.stringMatching(/También me has dicho .*6 horas a Jon.* ¿Lo apunto después\?/)]);
    expect(r.respuesta).toMatch(/⚠️ También me has dicho/);
    expect(r.respuesta.endsWith('<!--orden:x-->')).toBe(true);
  });
  it('sin nada que avisar, no hay avisos', () => {
    const r = guardianFinal('apunta 87,40 de Saltoki', { respuesta: 'Voy a registrar un gasto.' }, [{ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }], false);
    expect(r.avisos).toBeUndefined();
  });
});
