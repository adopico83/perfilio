/**
 * Comprueba el COMPARADOR del eval real (evals/comparar-orden.ts) sin llamar al modelo: un «modelo» que devuelve
 * exactamente el JSON plano del esquema estricto (todo lo que no dijo, null) debe puntuar bien en todas las frases,
 * y los datos inventados o las acciones equivocadas deben puntuar mal.
 */
import { ORDEN_POR_FRASE } from '../evals/ordenes-jev';
import { FRASES_RONDA6 } from '../evals/ronda6';
import { compararOrden, coincide, datosInventados } from '../evals/comparar-orden';
import { ACCIONES_POR_CATEGORIA, completarOrden } from '@/lib/jev/ordenes';
import { interpretarSalida } from '@/lib/jev/traductor';
import { herramientaOrdenJev } from '@/lib/jev/traductor';

const todas: Array<[string, Record<string, unknown>]> = [
  ...Object.entries(ORDEN_POR_FRASE).map(([f, c]) => [f, c.orden] as [string, Record<string, unknown>]),
  ...FRASES_RONDA6.map((c) => [c.frase, c.orden] as [string, Record<string, unknown>]),
];

/** Lo que devolvería un modelo perfecto con strict: todos los campos del esquema, null donde no dijo nada. */
function comoEstricto(orden: Record<string, unknown>): string {
  const props = Object.keys((herramientaOrdenJev('general') as unknown as { function: { parameters: { properties: Record<string, unknown> } } }).function.parameters.properties);
  const out: Record<string, unknown> = Object.fromEntries(props.map((k) => [k, null]));
  return JSON.stringify({ ...out, ...orden });
}

/** Frases cuya orden de `ordenes-jev.ts` SIMULA un fallo del modelo (IVA al revés, importe inventado): el comparador debe cazarlas. */
const FALLOS_SIMULADOS = new Set([
  'Hazle una factura de 500 a Paqui',
  '85 de material para lo de Mikel',
  'apunta 250 más IVA en Saltoki, plato de ducha y grifería para lo de Leire',
  '250 con IVA en Saltoki, plato de ducha y grifería para lo de Leire',
]);

describe('comparador del eval real', () => {
  it.each(todas)('«%s»: un modelo perfecto con el esquema estricto puntúa OK (y el que simula un fallo, KO)', (frase, orden) => {
    const v = compararOrden(frase, orden, completarOrden(interpretarSalida(comoEstricto(orden)).orden));
    if (FALLOS_SIMULADOS.has(frase)) return expect(v.ok).toBe(false);
    expect(v.motivos).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('detecta la acción equivocada, el dato inventado y la pregunta de más', () => {
    const f = 'Apunta un gasto de 180 más IVA en Saltoki para la obra de Leire';
    const bien = { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas', obra_texto: 'Leire' };
    expect(compararOrden(f, bien, completarOrden({ ...bien, accion: 'CITA_CREAR', fecha_texto: 'hoy' })).ok).toBe(false);
    expect(compararOrden(f, bien, completarOrden({ ...bien, importe_texto: '200' })).inventados).toHaveLength(1);
    expect(compararOrden(f, bien, completarOrden({ ...bien, iva_modo: null })).ok).toBe(false); // «más IVA» perdido
    expect(compararOrden(f, bien, completarOrden({ ...bien, importe_texto: null })).ok).toBe(false); // lo dijo y no lo extrajo
    expect(compararOrden(f, bien, completarOrden({ accion: 'HACER_MAGIA' })).ok).toBe(false);
  });

  it('coincide ignora mayúsculas, tildes y artículos', () => {
    expect(coincide('El Jueves', 'jueves')).toBe(true);
    expect(coincide('Mikel Etxeberria', 'etxeberria')).toBe(true);
    expect(coincide('Paqui', 'Leire')).toBe(false);
  });
  it('datosInventados: cifras y nombres que no están en el mensaje', () => {
    expect(datosInventados('gasto de 180 en Saltoki', { importe_texto: '180', proveedor_texto: 'Saltoki' })).toEqual([]);
    expect(datosInventados('gasto de 180 en Saltoki', { importe_texto: '181', proveedor_texto: 'Bricomart' })).toHaveLength(2);
  });
  it('la categoría del traductor siempre tiene herramienta', () => {
    for (const c of Object.keys(ACCIONES_POR_CATEGORIA)) expect(herramientaOrdenJev(c).type).toBe('function');
  });
});
