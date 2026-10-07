/**
 * Ronda 7 (prueba e2e en producción): reglas GENERALES del ejecutor .jev, probadas con variantes
 * del modelo (no una frase suelta): cantidades literales, nombre + oficio, obras por cliente,
 * mover citas desde la fecha de la cita, aviso de presupuesto aceptado, teléfono del proveedor y unidades.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A } from '../evals/base-simulada';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { separarNombreYRol } from '@/lib/jev/resolvedores';

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
const cambio = (mensaje: string, cambiar: Array<Record<string, unknown>>) => {
  const db = crearFakeDb(baseRonda5());
  return sesion(db).di(mensaje, o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', cambiar }));
};

describe('cantidades de partidas: el modelo copia lo que se DIJO y el servidor calcula', () => {
  it.each([
    ['«N más» con el total calculado por el modelo', 'pon 2 metros más de alicatado en el 11', { partida_texto: 'alicatado', sumar_cantidad_texto: '2', cantidad_texto: '20' }, '18 × 40 € → 20 × 40 €'],
    ['«N más» solo con delta', 'pon 2 metros más de alicatado en el 11', { partida_texto: 'alicatado', sumar_cantidad_texto: '2' }, '18 × 40 € → 20 × 40 €'],
    ['sustitución con el delta calculado por el modelo', 'pon 14 en vez de 18 metros de alicatado en el 11', { partida_texto: 'alicatado', cantidad_texto: '14', sumar_cantidad_texto: '-4' }, '18 × 40 € → 14 × 40 €'],
    ['sustitución con «lo que había» en el sitio equivocado', 'pon 14 en vez de 18 metros de alicatado en el 11', { partida_texto: 'alicatado', cantidad_texto: '14', sumar_cantidad_texto: '18' }, '18 × 40 € → 14 × 40 €'],
    ['sustitución solo con valor final', 'pon 14 metros de alicatado en el 11', { partida_texto: 'alicatado', cantidad_texto: '14' }, '18 × 40 € → 14 × 40 €'],
    ['«quítale N» con delta negativo', 'quítale 3 metros al alicatado del 11', { partida_texto: 'alicatado', sumar_cantidad_texto: '-3' }, '18 × 40 € → 15 × 40 €'],
    ['«N menos» con el valor final calculado', 'ponle 3 metros menos al alicatado del 11', { partida_texto: 'alicatado', sumar_cantidad_texto: '-3', cantidad_texto: '15' }, '18 × 40 € → 15 × 40 €'],
  ])('%s', async (_n, mensaje, c, esperado) => {
    const r = await cambio(mensaje, [c]);
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain(esperado);
  });
  it('un número que el usuario NO dijo sigue sin aceptarse (ni como delta ni como valor)', async () => {
    const r = await cambio('cambia el alicatado del 11', [{ partida_texto: 'alicatado', cantidad_texto: '25' }]);
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No veo la cantidad/);
  });
  it('presupuesto ACEPTADO: se puede cambiar pero avisa; borrador: sin aviso', async () => {
    const aceptado = await cambio('pon 2 metros más de alicatado en el 11', [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }]);
    expect(aceptado.respuesta).toMatch(/^⚠️ Este presupuesto ya está aceptado/);
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('pon 2 metros más de alicatado en el 10', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', cambiar: [{ partida_texto: 'alicatado', sumar_cantidad_texto: '2' }] }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).not.toMatch(/ya está aceptado/);
  });
});

describe('personas «nombre + oficio»', () => {
  it.each(['Aitor el pintor', 'Aitor de pintor', 'aitor la pintora', 'Aitor Gómez', 'Aitor'])('«%s» → Aitor Gómez', async (txt) => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('ponle 6 horas a Aitor el pintor en lo de Paqui', o({ accion: 'HORAS', operario_texto: txt, horas_texto: '6', obra_texto: 'Paqui' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Aitor Gómez');
  });
  it('con dos personas con el mismo nombre, el oficio desempata si el nombre guardado lo lleva', async () => {
    const b = baseRonda5();
    b.operarios.push({ id: 'op-aitor-pintor', business_id: NEGOCIO_A, nombre: 'Aitor Pintor', activo: true });
    const r = await sesion(crearFakeDb(b)).di('ponle 6 horas a Aitor el pintor', o({ accion: 'HORAS', operario_texto: 'Aitor el pintor', horas_texto: '6', obra_texto: 'Paqui' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Aitor Pintor');
  });
  it('con dos Aitor sin pista, pregunta cuál (no elige)', async () => {
    const b = baseRonda5();
    b.operarios.push({ id: 'op-aitor-2', business_id: NEGOCIO_A, nombre: 'Aitor Ruiz', activo: true });
    const r = await sesion(crearFakeDb(b)).di('ponle 6 horas a Aitor el pintor', o({ accion: 'HORAS', operario_texto: 'Aitor el pintor', horas_texto: '6', obra_texto: 'Paqui' }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.opciones?.map((x) => x.etiqueta).sort()).toEqual(['Aitor Gómez', 'Aitor Ruiz']);
  });
  it('un operario que no existe no se inventa', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('ponle 6 horas a Ramón el pintor', o({ accion: 'HORAS', operario_texto: 'Ramón el pintor', horas_texto: '6', obra_texto: 'Paqui' }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No encuentro a «Ramón el pintor»/);
  });
  it('separarNombreYRol', () => {
    expect(separarNombreYRol('Aitor el pintor')).toEqual({ nombre: 'Aitor', rol: 'pintor' });
    expect(separarNombreYRol('Zubizarreta de carpintero')).toEqual({ nombre: 'Zubizarreta', rol: 'carpintero' });
    expect(separarNombreYRol('Iker')).toBeNull();
  });
});

describe('obras: se prioriza el CLIENTE antes de preguntar', () => {
  it('«el baño de Unai» → la obra de Unai, aunque haya otras obras con «baño»', async () => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di('diario del baño de Unai', o({ accion: 'DIARIO', obra_texto: 'el baño de Unai', texto: 'Se ha picado' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Reforma baño completo');
  });
  it('si el cliente tiene varias obras con «baño», pregunta solo entre las suyas', async () => {
    const b = baseRonda5();
    b.obras.push({ id: 'obra-bano-unai-2', business_id: NEGOCIO_A, nombre: 'Reforma baño pequeño', direccion: 'Calle 2', estado: 'abierta', cliente_id: IDS.clienteUnai, created_at: '2026-06-01T10:00:00Z' });
    const r = await sesion(crearFakeDb(b)).di('diario del baño de Unai', o({ accion: 'DIARIO', obra_texto: 'el baño de Unai', texto: 'Se ha picado' }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.opciones?.map((x) => x.etiqueta.split(' · ')[0]).sort()).toEqual(['Reforma baño completo', 'Reforma baño pequeño']);
  });
  it('un cliente que no existe no cambia el comportamiento de siempre', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('diario del baño de Nadie', o({ accion: 'DIARIO', obra_texto: 'el baño de Nadie', texto: 'x' }));
    expect(r.accionPendiente).toBeUndefined();
  });
});

describe('mover citas: «al jueves» cuenta desde la fecha de la cita', () => {
  // ev-mikel: martes 2026-10-13 · ev-olabide: miércoles 2026-10-14
  it.each([
    ['al jueves', '2026-10-15'],
    ['el viernes', '2026-10-16'],
    ['al martes', '2026-10-20'], // el mismo día de la semana que la cita = la semana siguiente
    ['mañana', '2026-10-07'], // «mañana» sigue siendo mañana de verdad
    ['al jueves de la semana que viene', '2026-10-15'], // explícito: cuenta desde hoy
    ['2026-10-20', '2026-10-20'],
  ])('«%s» → %s', async (dia, esperado) => {
    const db = crearFakeDb(baseRonda5());
    const r = await sesion(db).di(`pasa lo de Mikel ${dia}`, o({ accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: dia }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain(esperado);
  });
  it('si la cita ya pasó, se cuenta desde hoy', async () => {
    const db = crearFakeDb(baseRonda5());
    db.tablas.agenda.find((e) => e.id === 'ev-mikel')!.fecha = '2026-10-01';
    const r = await sesion(db).di('pasa lo de Mikel al jueves', o({ accion: 'CITA_MOVER', evento_texto: 'Mikel', fecha_texto: 'al jueves' }));
    expect(r.respuesta).toContain('2026-10-08');
  });
});

describe('resumen de confirmación del gasto', () => {
  it('enseña el teléfono del proveedor si lo tiene', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('gasto de 121 en Saltoki para lo de Leire', o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', obra_texto: 'Leire' }));
    expect(r.respuesta).toContain('Saltoki (tel. 943 111 222)');
  });
  it('sin teléfono, no pone nada raro', async () => {
    const db = crearFakeDb(baseRonda5());
    db.tablas.proveedores[0]!.telefono = null;
    const r = await sesion(db).di('gasto de 121 en Saltoki para lo de Leire', o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '121', obra_texto: 'Leire' }));
    expect(r.respuesta).not.toContain('tel.');
  });
});

describe('la unidad (m²) no se pierde al editar partidas ni al facturar', () => {
  it('editar-partidas conserva la unidad de las partidas que ya existían, de las renombradas y de las añadidas', async () => {
    const { modificarPartidasPresupuesto } = await import('@/lib/presupuestos/editar-partidas');
    const b = baseRonda5();
    const pres = b.presupuestos.find((p) => p.id === IDS.presupuestoAinhoaPendiente)!;
    pres.preview_id = 'prev-11';
    (b as Record<string, unknown>).presupuesto_previews = [
      {
        id: 'prev-11',
        business_id: NEGOCIO_A,
        partidas: [
          { concepto: 'Quitar alicatado y plato viejo', cantidad: 1, precio: 150, capitulo: 'BAÑO', unidad: 'ud' },
          { concepto: 'Alicatar 18 m2', cantidad: 18, precio: 40, capitulo: 'BAÑO', unidad: 'm²' },
          { concepto: 'Plato de ducha con mampara', cantidad: 1, precio: 900, capitulo: 'BAÑO', unidad: 'ud' },
        ],
      },
    ];
    const db = crearFakeDb(b);
    const r = await modificarPartidasPresupuesto(db.client, NEGOCIO_A, IDS.presupuestoAinhoaPendiente, {
      cambiar: [{ partida: 'alicatar', sumar_cantidad: 2, nuevo_concepto: 'Alicatado paredes' }],
      anadir: [{ concepto: 'Pintura', cantidad: 30, precio_unitario: 8, unidad: 'm²' }],
    }, { aplicar: true });
    expect(r.ok).toBe(true);
    const prev = ((db.tablas as Record<string, Array<Record<string, unknown>>>).presupuesto_previews![0]!.partidas as Array<{ concepto: string; unidad: string | null }>);
    expect(Object.fromEntries(prev.map((p) => [p.concepto, p.unidad]))).toEqual({
      'Quitar alicatado y plato viejo': 'ud',
      'Alicatado paredes': 'm²', // renombrada: conserva su unidad
      'Plato de ducha con mampara': 'ud',
      Pintura: 'm²', // añadida: la unidad que dijo el usuario
    });
  });
});
