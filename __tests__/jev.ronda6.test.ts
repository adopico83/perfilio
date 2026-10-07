/**
 * Ronda 6: el modelo REAL (GPT-4o mini) no se porta como el simulado. Rellena con "", "null", "N/A"… lo que el
 * usuario no dijo, devuelve números donde van textos, mayúsculas en los enums y campos de más. Aquí se simula
 * un modelo «mal educado» y se exige el MISMO resultado que con la orden limpia.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { ORDEN_POR_FRASE } from '../evals/ordenes-jev';
import { FRASES_RONDA6 } from '../evals/ronda6';
import { ORDENES, completarOrden, type NombreAccion, type OrdenJev } from '@/lib/jev/ordenes';
import { normalizarCrudo } from '@/lib/jev/normalizar';
import { interpretarSalida } from '@/lib/jev/traductor';

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

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

type Raw = Record<string, unknown>;
const RELLENOS: unknown[] = ['', '   ', 'null', 'N/A', 'no indicado', '-', null, 'None', 'No especificado', 'undefined'];

/** Lo que haría un modelo mal educado con una orden limpia (variante `i`). */
function ensuciar(orden: Raw, i: number): Raw {
  const accion = String(orden.accion);
  const out: Raw = { ...orden };
  const shape = (ORDENES[accion as NombreAccion] as unknown as { shape: Record<string, unknown> } | undefined)?.shape ?? {};
  const relleno = RELLENOS[i % RELLENOS.length];
  for (const k of Object.keys(shape)) {
    if (k === 'accion' || k in out) continue;
    out[k] = ['partidas', 'anadir', 'cambiar', 'quitar_texto'].includes(k) ? (i % 2 ? [] : relleno) : relleno;
  }
  for (const k of ['partidas', 'anadir']) {
    if (Array.isArray(out[k])) out[k] = (out[k] as Raw[]).map((p) => ({ concepto_texto: p.concepto_texto, cantidad_texto: p.cantidad_texto ?? relleno, unidad_texto: p.unidad_texto ?? relleno, precio_texto: p.precio_texto ?? relleno }));
  }
  // campos de otras órdenes y campos que no existen
  if (!('proveedor_texto' in out) && !('proveedor_texto' in shape)) out.proveedor_texto = 'null';
  out.campo_inventado = 'x';
  // números donde van textos
  if (i % 3 === 0) for (const k of ['importe_texto', 'horas_texto', 'presupuesto_texto', 'factura_texto']) if (typeof out[k] === 'string' && /^\d+$/.test(out[k] as string)) out[k] = Number(out[k]);
  // enums en mayúsculas y la acción con otro formato
  if (i % 2 === 1) for (const k of ['iva_modo', 'estado', 'documento', 'categoria']) if (typeof out[k] === 'string') out[k] = (out[k] as string).toUpperCase();
  if (i % 4 === 1) out.accion = accion.toLowerCase();
  if (i % 4 === 2) out.accion = accion.replace(/_/g, ' ');
  return out;
}

async function resultado(orden: Raw) {
  const db = crearFakeDb(baseRonda5());
  const r = await sesion(db).di('mensaje', orden as unknown as OrdenJev);
  return { respuesta: r.respuesta, tool: r.accionPendiente?.tool ?? null, resumen: r.accionPendiente?.resumen ?? null, opciones: r.opciones?.map((o) => o.etiqueta) ?? null, charla: r.charla ?? false };
}

const TODAS: Array<[string, Raw]> = [
  ...Object.entries(ORDEN_POR_FRASE).map(([f, c]) => [f, c.orden] as [string, Raw]),
  ...FRASES_RONDA6.map((c) => [c.frase, c.orden] as [string, Raw]),
];

describe('un modelo mal educado da el MISMO resultado que uno perfecto', () => {
  it.each(TODAS)('«%s»', async (_frase, orden) => {
    const limpio = await resultado(orden);
    for (let i = 0; i < RELLENOS.length; i++) {
      const sucio = ensuciar(orden, i);
      expect({ i, ...(await resultado(sucio)) }).toEqual({ i, ...limpio });
    }
  });
});

describe('frases de la ronda 6 (las que fallaron en producción)', () => {
  it.each(FRASES_RONDA6.map((c) => [c.frase, c] as const))('«%s»', async (_f, caso) => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di(caso.frase, ensuciar(caso.orden, 3) as unknown as OrdenJev, { categoria: caso.categoria });
    for (const t of caso.contiene ?? []) expect(r.respuesta).toContain(t);
    expect(r.respuesta).not.toMatch(/No te he entendido/);
    if (caso.tipo === 'escritura') expect(r.accionPendiente).toBeDefined();
    else expect(r.accionPendiente).toBeUndefined();
  });
});

describe('normalización', () => {
  it('"", espacios, null, N/A, no indicado, - … significan «no lo dijo»', () => {
    const n = normalizarCrudo({ accion: 'crear cliente', nombre_texto: ' Jon ', telefono_texto: 'N/A', email_texto: '', direccion_texto: 'No indicado', nif_texto: '-', x: null });
    expect(n).toEqual({ accion: 'CREAR_CLIENTE', nombre_texto: 'Jon' });
  });
  it('es idempotente y no lanza con basura', () => {
    const una = normalizarCrudo({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: 180, iva_modo: 'Más IVA' });
    expect(una).toEqual({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '180', iva_modo: 'mas' });
    expect(normalizarCrudo(una)).toEqual(una);
    for (const basura of [null, undefined, 3, 'x', [], [1]]) expect(normalizarCrudo(basura)).toEqual({});
  });
  it('sinónimos de enums por acción y listas limpias', () => {
    expect(normalizarCrudo({ accion: 'CONSULTA_PRESUPUESTOS', estado: 'Pendiente' }).estado).toBe('pendientes');
    expect(normalizarCrudo({ accion: 'CONSULTA_FACTURAS', estado: 'cobradas' }).estado).toBe('pagada');
    expect(normalizarCrudo({ accion: 'PRESUPUESTO_PARTIDAS', quitar_texto: 'pintura', anadir: [{ concepto_texto: 'null' }, { concepto_texto: 'Suelo', precio_texto: 'N/A' }] })).toEqual({
      accion: 'PRESUPUESTO_PARTIDAS',
      quitar_texto: ['pintura'],
      anadir: [{ concepto_texto: 'Suelo' }],
    });
  });
  it('interpretarSalida acepta el JSON plano del esquema estricto y el envuelto antiguo', () => {
    const plano = interpretarSalida(JSON.stringify({ continua_tarea: true, accion: 'CHARLA', cliente_texto: null }));
    expect(plano.continuaTarea).toBe(true);
    expect(plano.orden).toMatchObject({ accion: 'CHARLA' });
    expect(interpretarSalida(JSON.stringify({ orden: { accion: 'CHARLA' } })).orden).toEqual({ accion: 'CHARLA' });
  });
});

describe('validación parcial: se conserva lo bueno y se pregunta solo lo que falta', () => {
  it('presupuesto sin partidas: pregunta por los trabajos y, al dictarlos, sigue con Paqui', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r1 = await s.di('hazme un presupuesto para Paqui', { accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [] } as unknown as OrdenJev);
    expect(r1.accionPendiente).toBeUndefined();
    expect(r1.respuesta).toMatch(/trabajos/);
    expect(r1.respuesta).not.toMatch(/cliente/i); // el cliente ya lo dijo: no se vuelve a preguntar
    // El modelo, al contestar, solo devuelve las partidas (y ni siquiera marca continua_tarea).
    const r2 = await s.di('alicatar el baño, 12 metros a 40 euros', {
      accion: 'PRESUPUESTO_DICTADO',
      cliente_texto: 'N/A',
      partidas: [{ concepto_texto: 'alicatar el baño', cantidad_texto: '12', unidad_texto: 'metros', precio_texto: '40' }],
    } as unknown as OrdenJev);
    expect(r2.accionPendiente).toBeDefined();
    expect(r2.respuesta).toContain('Paqui');
    expect(r2.respuesta).toContain('580,80 €');
  });
  it('gasto sin importe: pregunta solo el importe y conserva proveedor y obra', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r1 = await s.di('apunta un gasto en Saltoki para lo de Leire', { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: 'null', obra_texto: 'Leire' } as unknown as OrdenJev);
    expect(r1.respuesta).toMatch(/gasto/i);
    expect(r1.respuesta).not.toMatch(/proveedor/i);
    const r2 = await s.di('180 más IVA', { accion: 'GASTO', importe_texto: '180', iva_modo: 'mas', proveedor_texto: '', obra_texto: '' } as unknown as OrdenJev, { continua: true });
    expect(r2.accionPendiente).toBeDefined();
    expect(r2.respuesta).toContain('217,80 €');
  });
  it('abrir obra sin nombre: pregunta el nombre y no pierde el cliente', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r1 = await s.di('abre una obra para Mikel Etxeberria', { accion: 'CREAR_OBRA', nombre_texto: '', cliente_texto: 'Mikel Etxeberria' } as unknown as OrdenJev);
    expect(r1.respuesta).toBe('¿Cómo se llama la obra?');
    const r2 = await s.di('Reforma baño', { accion: 'CREAR_OBRA', nombre_texto: 'Reforma baño' } as unknown as OrdenJev);
    expect(r2.accionPendiente).toBeDefined();
    expect(r2.respuesta).toContain('Mikel Etxeberria');
  });
  it('un campo obligatorio con basura se pregunta; uno opcional con basura se ignora', () => {
    const r = completarOrden({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: 'N/A', obra_texto: 'Paqui', fecha_texto: 'quizá' });
    expect(r).toMatchObject({ estado: 'faltan', faltantes: ['horas_texto'] });
    expect(r.estado === 'faltan' && r.cruda).toMatchObject({ operario_texto: 'Iker', obra_texto: 'Paqui' });
  });
  it('ACLARAR solo si no hay intención reconocible (acción inventada o petición del modelo)', () => {
    expect(completarOrden({ accion: 'HACER_MAGIA' }).estado).toBe('aclarar');
    expect(completarOrden({ accion: 'ACLARAR', pregunta: '¿Qué quieres anotar?' })).toMatchObject({ estado: 'aclarar', pregunta: '¿Qué quieres anotar?' });
    expect(completarOrden({}).estado).toBe('aclarar');
  });
});

describe('las consultas de solo lectura salen siempre, aunque vengan vacías o sucias', () => {
  const consultas: Array<[string, Raw]> = [
    ['presupuestos', { accion: 'CONSULTA_PRESUPUESTOS', estado: 'N/A' }],
    ['presupuestos sin nada', { accion: 'CONSULTA_PRESUPUESTOS' }],
    ['facturas', { accion: 'CONSULTA_FACTURAS', estado: '' }],
    ['obras', { accion: 'CONSULTA_OBRAS', estado: 'null' }],
    ['una obra sin decir cuál', { accion: 'CONSULTA_OBRA', obra_texto: 'no indicado' }],
    ['agenda', { accion: 'CONSULTA_AGENDA', rango_texto: 'null' }],
    ['gastos', { accion: 'CONSULTA_GASTOS', proveedor_texto: '-', obra_texto: '', cliente_texto: 'N/A', periodo_texto: null }],
    ['el día', { accion: 'CONSULTA_DIA', cliente_texto: 'null' }],
  ];
  it.each(consultas)('%s', async (_n, orden) => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('consulta', orden as unknown as OrdenJev);
    expect(r.respuesta).not.toMatch(/No te he entendido|Me falta/);
    expect(r.accionPendiente).toBeUndefined();
    expect(db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes')).toHaveLength(0);
  });
});

describe('observabilidad: cada rechazo se registra (sin datos sensibles)', () => {
  it('orden incompleta → console.warn con la acción, el campo que falta y la orden sin datos sensibles', () => {
    completarOrden({ accion: 'GASTO', proveedor_texto: 'Saltoki', email_texto: 'jon.arrieta@example.com', telefono_texto: '600 123 123', nif_texto: '12345678Z', importe_texto: 'N/A' });
    const linea = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('[jev] orden_incompleta');
    expect(linea).toContain('GASTO');
    expect(linea).toContain('importe_texto');
    expect(linea).not.toMatch(/jon\.arrieta|600 123 123|12345678Z/);
  });
  it('campo descartado, acción desconocida y ACLARAR también salen en el log', () => {
    completarOrden({ accion: 'GASTO', proveedor_texto: 'X', importe_texto: '1', categoria: 'rarísima' });
    completarOrden({ accion: 'HACER_MAGIA' });
    completarOrden({ accion: 'ACLARAR', pregunta: '¿?' });
    completarOrden({ accion: 'CITA_CREAR', fecha_texto: 'el lunes', hora_texto: { x: 1 } });
    completarOrden({ accion: 'GASTO', proveedor_texto: 'X', importe_texto: '1', iva_modo: 'quizas' });
    const eventos = warn.mock.calls.map((c) => String(c[0]));
    expect(eventos.some((l) => l.includes('accion_desconocida') && l.includes('HACER_MAGIA'))).toBe(true);
    expect(eventos.some((l) => l.includes('aclarar'))).toBe(true);
    expect(eventos.some((l) => l.includes('campo_descartado') && l.includes('hora_texto'))).toBe(true);
  });
  it('una orden limpia no genera ruido en el log', () => {
    completarOrden({ accion: 'CITA_CREAR', fecha_texto: 'el lunes', hora_texto: '10', cliente_texto: null });
    expect(warn).not.toHaveBeenCalled();
  });
});
