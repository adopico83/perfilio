/**
 * Ronda 8 (prueba e2e estricta en producción): reglas GENERALES del diálogo y del ejecutor .jev.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5, sesion } from './helpers/jev-sesion';
import { IDS, NEGOCIO_A } from '../evals/base-simulada';
import type { OrdenJev } from '@/lib/jev/ordenes';
import { horasEnTexto, parseHorasTexto, numerosDelMensaje } from '@/lib/jev/fechas';
import { numerosEnLetras, letrasACifras } from '@/lib/numeros-letras';
import { MENSAJE_NADA_PENDIENTE } from '@/lib/agente/orquestacion';

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
const escrituras = (db: ReturnType<typeof crearFakeDb>) =>
  db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;

const MSG_GASTO = 'gasto de 87,40 en Saltoki para lo de Leire';
const GASTO = o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' });

describe('1 · negación y confirmación', () => {
  it.each(['no, mejor no', 'no, ese ya lo apunté yo', 'déjalo', 'olvídalo'])('«%s» cancela la pendiente y un «vale» posterior no ejecuta nada', async (rechazo) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('gasto de 87,40 en Saltoki para lo de Leire', GASTO);
    expect(p.accionPendiente).toBeDefined();
    const antes = escrituras(db);
    const r = await s.sinTraductor(rechazo);
    expect(r.respuesta).toBe('Vale, no hago nada.');
    const vale = await s.sinTraductor('vale');
    expect(vale.respuesta).toBe(MENSAJE_NADA_PENDIENTE);
    expect(escrituras(db)).toBe(antes);
    expect(db.tablas.gastos).toHaveLength(0);
    // La orden ya no se puede confirmar ni siquiera con su id.
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.respuesta).toMatch(/ya se ha usado/);
    expect(db.tablas.gastos).toHaveLength(0);
  });
  it('un «vale» solo confirma si lo último que dijo el asistente fue la confirmación de ESA orden', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di(MSG_GASTO, GASTO);
    // Entre medias el asistente dijo otra cosa: el «vale» no ejecuta; vuelve a enseñar lo pendiente.
    s.decirAsistente('Aquí tienes la lista de obras…');
    const v = await s.sinTraductor('vale');
    expect(db.tablas.gastos).toHaveLength(0);
    expect(v.accionPendiente?.orden_id).toBe(p.accionPendiente!.orden_id);
    expect(v.respuesta).toMatch(/pendiente/);
    // Con su pregunta delante, sí.
    s.decirAsistente(p.respuesta);
    const ok = await s.sinTraductor('vale');
    expect(ok.ejecutado).toBe(true);
    expect(db.tablas.gastos).toHaveLength(1);
  });
  it('«olvídalo» o «cancela» con una tarea a medias la cierra sin borrar nada; «cancela» a secas no es CITA_BORRAR', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const t = await s.di('cita con Paqui el lunes', o({ accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes' }));
    expect(t.respuesta).toMatch(/¿A qué hora\?/);
    const antes = escrituras(db);
    const nCitas = db.tablas.agenda.length;
    expect((await s.sinTraductor('olvídalo')).respuesta).toBe('Vale, no hago nada.');
    expect((await s.sinTraductor('cancela')).respuesta).toBe('Vale.'); // nada pendiente: no llega al modelo, no borra ninguna cita
    expect(escrituras(db)).toBe(antes);
    expect(db.tablas.agenda).toHaveLength(nCitas);
    // La tarea ya no existe: «a las 5» no la continúa.
    const r = await s.di('a las 5', o({ accion: 'CITA_CREAR', hora_texto: 'las 5' }), { continua: true });
    expect(r.respuesta).not.toMatch(/Paqui/);
  });
});

describe('6 · corrección durante la confirmación', () => {
  const dictado = (encimera: string) =>
    o({
      accion: 'PRESUPUESTO_DICTADO',
      cliente_texto: 'Paqui',
      partidas: [
        { concepto_texto: 'encimera', cantidad_texto: '1', precio_texto: encimera },
        { concepto_texto: 'fregadero', cantidad_texto: '1', precio_texto: '120' },
      ],
    });
  it('«espera, la encimera ponla a 230» se fusiona con el dictado pendiente y vuelve a enseñar el resumen', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p1 = await s.di('presu para Paqui: encimera 210 y fregadero 120', dictado('210'));
    expect(p1.respuesta).toContain('210,00 €');
    const p2 = await s.di('espera, la encimera ponla a 230', dictado('230'), { continua: true });
    expect(p2.accionPendiente).toBeDefined();
    expect(p2.accionPendiente!.orden_id).not.toBe(p1.accionPendiente!.orden_id);
    expect(p2.respuesta).toContain('230,00 €');
    expect(p2.respuesta).not.toContain('210,00 €');
    // La antigua ya no está viva.
    expect((await s.confirmar(p1.accionPendiente!.orden_id)).respuesta).toMatch(/ya se ha usado/);
    expect((await s.confirmar(p2.accionPendiente!.orden_id)).ejecutado).toBe(true);
    expect(db.tablas.presupuestos.filter((p) => p.cliente_nombre === 'Paqui' && p.estado === 'borrador')).toHaveLength(1);
  });
  it('una orden DISTINTA mientras hay una pendiente la descarta y lo dice', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p1 = await s.di(MSG_GASTO, GASTO);
    const r = await s.di('qué obras tengo', o({ accion: 'CONSULTA_OBRAS' }));
    expect(r.respuesta).toMatch(/^He dejado sin hacer lo que tenía pendiente/);
    expect((await s.confirmar(p1.accionPendiente!.orden_id)).respuesta).toMatch(/ya se ha usado/);
    expect(db.tablas.gastos).toHaveLength(0);
  });
  it('«no, son 7 y media no 7» corrige las horas pendientes (7,5)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('ponle 7 horas a Iker en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '7', obra_texto: 'Paqui' }));
    const r = await s.di('no, son 7 y media no 7', o({ accion: 'HORAS', horas_texto: '7 y media' }), { continua: true });
    expect(r.respuesta).toContain('7,5 h');
    await s.sinTraductor('sí');
    expect(db.tablas.registros_jornada.at(-1)).toMatchObject({ horas_reales: 7.5 });
  });
});

describe('2 · horas y números con letras', () => {
  it.each([
    ['7 y media', 7.5], ['7 y cuarto', 7.25], ['8 menos cuarto', 7.75], ['7:30', 7.5], ['7h30', 7.5], ['media hora', 0.5],
    ['siete y media', 7.5], ['ocho menos cuarto', 7.75], ['7,5', 7.5], ['7', 7], ['una hora y media', 1.5], ['6', 6],
  ])('«%s» → %s h', (txt, esperado) => {
    expect(parseHorasTexto(txt)).toBe(esperado);
  });
  it('varios en una frase: «Aitor 7 y media y Jon 6»', () => {
    expect(horasEnTexto('Aitor 7 y media y Jon 6')).toEqual([7.5, 6]);
  });
  it.each([['dos enchufes a treinta y cinco', [2, 35]], ['tres metros', [3]], ['ciento veinte euros', [120]], ['mil doscientos', [1200]], ['una partida', []], ['veintiuno', [21]]])(
    '«%s» → números en letras %j',
    (txt, esperado) => {
      expect(numerosEnLetras(txt as string)).toEqual(esperado);
    }
  );
  it('letrasACifras', () => {
    expect(letrasACifras('añádele dos enchufes a treinta y cinco')).toBe('añádele 2 enchufes a 35');
    expect(numerosDelMensaje('dos enchufes a 35').sort()).toEqual([2, 35]);
  });
  it('«7 y media» se guarda como 7,5 h (no 7) y «siete y media» también', async () => {
    for (const txt of ['7 y media', 'siete y media', '7:30']) {
      const db = crearFakeDb(baseRonda5());
      const s = sesion(db);
      const p = await s.di(`ponle ${txt} a Iker en lo de Paqui`, o({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: txt, obra_texto: 'Paqui' }));
      expect(p.respuesta).toContain('7,5 h');
      await s.sinTraductor('sí');
      expect(db.tablas.registros_jornada.at(-1)).toMatchObject({ horas_reales: 7.5 });
    }
  });
  it('unas horas que el usuario no dijo siguen sin aceptarse', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const p = await s.di('ponle horas a Iker en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui' }));
    expect(p.accionPendiente).toBeUndefined();
    expect(p.respuesta).toMatch(/cuántas horas/i);
  });
  it('«añádele dos enchufes a 35» → 2 × 35', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const r = await s.di('añádele dos enchufes a 35', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', anadir: [{ concepto_texto: 'enchufes', cantidad_texto: 'dos', precio_texto: '35' }] }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/enchufes/i);
    expect(r.respuesta).toMatch(/2 × 35/);
  });
});

describe('3 · nada se descarta en silencio', () => {
  it('«Aitor el pintor 7 y media y Jon el carpintero 6»: dos órdenes, una a una, ninguna perdida', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p1 = await s.di(
      'Aitor el pintor 7 y media y Jon el carpintero 6 en lo de Paqui',
      o({ accion: 'HORAS', operario_texto: 'Aitor el pintor', horas_texto: '7 y media', obra_texto: 'Paqui', mas_operarios: [{ operario_texto: 'Jon el carpintero', horas_texto: '6' }] })
    );
    expect(p1.respuesta).toContain('Aitor Gómez');
    expect(p1.respuesta).toContain('7,5 h');
    expect(p1.respuesta).toMatch(/Después te pregunto por: las horas de Jon el carpintero \(6\)/);
    const c1 = await s.confirmar(p1.accionPendiente!.orden_id);
    expect(c1.ejecutado).toBe(true);
    expect(c1.respuesta).toMatch(/Siguiente:/);
    expect(c1.accionPendiente).toBeDefined(); // la de Jon ya está preparada
    expect(c1.respuesta).toContain('Jon Arrieta');
    expect(c1.respuesta).toContain('6 h');
    const c2 = await s.confirmar(c1.accionPendiente!.orden_id);
    expect(c2.ejecutado).toBe(true);
    expect(db.tablas.registros_jornada.map((r) => [r.operario_id, r.horas_reales])).toEqual([[IDS.operarioAitor, 7.5], [IDS.operarioJon, 6]]);
  });
  it('cancelar la primera no ejecuta la segunda (y se dice)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('Aitor 7 y media y Jon 6 en lo de Paqui', o({ accion: 'HORAS', operario_texto: 'Aitor', horas_texto: '7 y media', obra_texto: 'Paqui', mas_operarios: [{ operario_texto: 'Jon', horas_texto: '6' }] }));
    expect((await s.sinTraductor('no, mejor no')).respuesta).toBe('Vale, no hago nada.');
    expect(db.tablas.registros_jornada).toHaveLength(0);
  });
  it('dos órdenes de tipos distintos en una frase: se hace la primera y se pregunta la segunda', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di(
      'apunta 8 horas a Iker en lo de Paqui y anota en el diario de Paqui que se ha picado',
      o({ accion: 'HORAS', operario_texto: 'Iker', horas_texto: '8', obra_texto: 'Paqui' }),
      { otras: [o({ accion: 'DIARIO', obra_texto: 'Paqui', texto: 'Se ha picado' })] }
    );
    expect(p.respuesta).toMatch(/Después te pregunto por: .*diario/i);
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.accionPendiente).toBeDefined();
    expect(c.respuesta).toContain('Reforma Paqui');
    await s.confirmar(c.accionPendiente!.orden_id);
    expect(db.tablas.diario_obra).toHaveLength(1);
    expect(db.tablas.registros_jornada).toHaveLength(1);
  });
});

describe('4 · factura suelta', () => {
  it('copia NIF y dirección, crea la línea del concepto, el vencimiento y enseña base + IVA = total; sin obra aunque la del cliente esté cerrada', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('factura suelta a Amaia por 85 más IVA', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Amaia', importe_texto: '85', iva_modo: 'mas', descripcion_texto: 'Arreglo' }));
    expect(p.accionPendiente).toBeDefined();
    expect(p.respuesta).toContain('Base 85,00 € + IVA 21 % 17,85 € = Total 102,85 €');
    expect(p.respuesta).toContain('sin obra');
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    expect(c.ejecutado).toBe(true);
    const f = db.tablas.facturas.at(-1)!;
    expect(f).toMatchObject({ cliente_id: IDS.clienteAmaiaEtxeberria, cliente_nif: '55555555C', cliente_direccion: 'Calle Amaia 5', base_imponible: 85, iva: 17.85, total: 102.85, estado: 'pendiente' });
    expect(f.obra_id).toBeUndefined();
    expect(f.fecha_vencimiento).toBe(new Date(new Date(`${f.fecha}T00:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)); // 30 días
    expect(f.lineas).toEqual([{ descripcion: 'Arreglo', cantidad: 1, unidad: null, precio_unitario: 85, importe: 85, capitulo: null }]);
  });
  it('sin concepto: la línea es «Trabajos realizados»', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('factura a Paqui por 100 con IVA', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', importe_texto: '100', iva_modo: 'incluido' }));
    await s.confirmar(p.accionPendiente!.orden_id);
    expect((db.tablas.facturas.at(-1)!.lineas as Array<{ descripcion: string; precio_unitario: number }>)[0]).toMatchObject({ descripcion: 'Trabajos realizados', precio_unitario: 82.64 });
  });
  it('si al cliente le falta el NIF: lo pide ANTES, guarda la tarea y, al llegar, lo guarda en su ficha y retoma la factura sola', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('factura a Ainhoa por 200 más IVA', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Ainhoa', importe_texto: '200', iva_modo: 'mas' }));
    expect(q.accionPendiente).toBeUndefined();
    expect(q.respuesta).toMatch(/me falta el NIF/);
    expect(db.tablas.facturas.filter((f) => f.cliente_id === IDS.clienteAinhoaEtxeberria)).toHaveLength(0);
    // Llega el NIF (sin volver a decir de quién): se guarda en SU ficha y la factura sigue sola.
    const n = await s.sinTraductor('44444444B');
    expect(n.accionPendiente).toBeDefined();
    expect(n.respuesta).toMatch(/NIF/);
    expect(n.respuesta).toMatch(/Después te pregunto por: .*factura/);
    const c1 = await s.confirmar(n.accionPendiente!.orden_id);
    expect(c1.ejecutado).toBe(true);
    expect(db.tablas.clientes.find((c) => c.id === IDS.clienteAinhoaEtxeberria)).toMatchObject({ nif: '44444444B' });
    expect(c1.accionPendiente).toBeDefined();
    expect(c1.respuesta).toContain('Base 200,00 € + IVA 21 % 42,00 € = Total 242,00 €');
    const c2 = await s.confirmar(c1.accionPendiente!.orden_id);
    expect(c2.ejecutado).toBe(true);
    expect(db.tablas.facturas.at(-1)).toMatchObject({ cliente_id: IDS.clienteAinhoaEtxeberria, cliente_nif: '44444444B', total: 242 });
  });
  it('NIF y dirección que faltan a la vez, dados en un solo mensaje', async () => {
    const b = baseRonda5();
    b.clientes.find((c) => c.id === IDS.clienteAinhoaEtxeberria)!.direccion = null;
    const db = crearFakeDb(b);
    const s = sesion(db);
    const q = await s.di('factura a Ainhoa por 200 más IVA', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Ainhoa', importe_texto: '200', iva_modo: 'mas' }));
    expect(q.respuesta).toMatch(/NIF y la dirección/);
    const n = await s.sinTraductor('su NIF es 44444444B y vive en Calle Mayor 5, Irún');
    await s.confirmar(n.accionPendiente!.orden_id);
    expect(db.tablas.clientes.find((c) => c.id === IDS.clienteAinhoaEtxeberria)).toMatchObject({ nif: '44444444B', direccion: 'Calle Mayor 5, Irún' });
  });
});

describe('9 · IVA ambiguo', () => {
  it('factura sin decir nada del IVA: pregunta; «sin IVA» a secas: pregunta; «más IVA»: sigue', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const a = await s.di('factura a Paqui por 200', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Paqui', importe_texto: '200', iva_modo: 'incluido' })); // el modelo «supone»
    expect(a.accionPendiente).toBeUndefined();
    expect(a.respuesta).toMatch(/IVA incluido o hay que sumarle/);
    const b = await s.di('sin IVA', o({ accion: 'CREAR_FACTURA', iva_modo: null }), { continua: true });
    expect(b.respuesta).toMatch(/dos cosas/);
    const c = await s.di('más IVA', o({ accion: 'CREAR_FACTURA', iva_modo: 'mas' }), { continua: true });
    expect(c.accionPendiente).toBeDefined();
    expect(c.respuesta).toContain('Total 242,00 €');
  });
  it('gasto «87,40 sin IVA» pregunta; un ticket normal se toma con IVA incluido y enseña el desglose', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('gasto 87,40 sin IVA en Saltoki', o({ accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40' }));
    expect(q.accionPendiente).toBeUndefined();
    expect(q.respuesta).toMatch(/dos cosas/);
    const r = await s.di('con IVA incluido', o({ accion: 'GASTO', iva_modo: 'incluido' }), { continua: true });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/base .*\+ IVA .*= total 87,40 €/);
    const t = await sesion(crearFakeDb(baseRonda5())).di('85 de material', o({ accion: 'GASTO', importe_texto: '85', categoria: 'material' }));
    expect(t.respuesta).toMatch(/total 85,00 €/);
  });
  it('dictado «sin IVA» a secas pregunta', async () => {
    const q = await sesion(crearFakeDb(baseRonda5())).di('presu para Paqui sin IVA: alicatar 12 metros a 40', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Paqui', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '12', precio_texto: '40' }] }));
    expect(q.accionPendiente).toBeUndefined();
    expect(q.respuesta).toMatch(/Sin IVA/);
  });
});

describe('10-11 · «ponle 500» y partida con un solo número', () => {
  it('«ponle 500» sin decir a qué: pregunta a qué partida y si es precio o cantidad (no elige una)', async () => {
    const b = baseRonda5();
    b.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.presupuesto_generado =
      'CAPÍTULO BAÑO\n1. Fontanería | Cantidad: 1 | Precio: 300,00 € | Importe: 300,00 €\n2. Mampara de ducha | Cantidad: 1 | Precio: 350,00 € | Importe: 350,00 €\nTOTAL BAÑO: 650,00 €\nBASE IMPONIBLE: 650,00 € | IVA (21%): 136,50 € | TOTAL: 786,50 €';
    const s = sesion(crearFakeDb(b));
    const r = await s.di('ponle 500', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', cambiar: [{ partida_texto: 'fontanería', precio_texto: '500' }] }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/¿A qué partida/);
    expect(r.respuesta).toMatch(/precio o la cantidad/);
    const r2 = await s.di('ponle 500', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', cambiar: [{ precio_texto: '500' }] }));
    expect(r2.respuesta).toMatch(/¿A qué partida/);
  });
  it('«colocar campana extractora 120» es el PRECIO con cantidad 1; «quítale la fontanería» no se pierde', async () => {
    const b = baseRonda5();
    b.presupuestos.find((p) => p.id === IDS.presupuestoMikelBorrador)!.presupuesto_generado =
      'CAPÍTULO BAÑO\n1. Fontanería | Cantidad: 1 | Precio: 300,00 € | Importe: 300,00 €\n2. Mampara de ducha | Cantidad: 1 | Precio: 350,00 € | Importe: 350,00 €\nTOTAL BAÑO: 650,00 €\nBASE IMPONIBLE: 650,00 € | IVA (21%): 136,50 € | TOTAL: 786,50 €';
    const s = sesion(crearFakeDb(b));
    const r = await s.di('añádele colocar campana extractora 120 y quítale la fontanería', o({
      accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', quitar_texto: ['fontanería'], anadir: [{ concepto_texto: 'colocar campana extractora', cantidad_texto: '120' }],
    }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toMatch(/campana extractora/i);
    expect(r.respuesta).toMatch(/1 × 120/);
    expect(r.respuesta).toMatch(/fontaner/i);
  });
  it('una partida a quitar que el usuario no nombró se pregunta', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('quítale algo', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', quitar_texto: ['mampara'] }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/Qué partida/);
  });
});

describe('5 · clientes por palabras', () => {
  it.each([['Mikel Urkiola', 'Mikel PRUEBA Urkiola'], ['urkiola mikel', 'Mikel PRUEBA Urkiola'], ['Mikel Úrkiola', 'Mikel PRUEBA Urkiola']])('«%s» → %s', async (txt, esperado) => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('presu para Paqui: alicatar 12 metros a 40', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: txt, partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '12', precio_texto: '40' }] }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain(esperado);
  });
  it('«Mikel Urkiola» con un cliente «Mikel Urkiola Etxeberria» y otro «Mikel Etxeberria»: gana la coincidencia única por palabras', async () => {
    const b = baseRonda5();
    b.clientes = b.clientes.filter((c) => c.id !== IDS.clienteMikelUrkiola);
    b.clientes.push({ id: 'cli-mue', business_id: NEGOCIO_A, nombre: 'Mikel Urkiola Etxeberria', nif: null, direccion: null, telefono: null });
    const r = await sesion(crearFakeDb(b)).di('presu para Paqui: alicatar 12 metros a 40', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Mikel Urkiola', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '12', precio_texto: '40' }] }));
    expect(r.respuesta).toContain('Mikel Urkiola Etxeberria');
  });
  it('un nombre que no existe sigue sin inventarse', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('presu para Paqui: alicatar 12 metros a 40', o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: 'Zacarías Nadie', partidas: [{ concepto_texto: 'alicatar', cantidad_texto: '12', precio_texto: '40' }] }));
    expect(r.accionPendiente).toBeUndefined();
    expect(r.respuesta).toMatch(/No tengo a «Zacarías Nadie»/);
  });
});

describe('7 · tareas', () => {
  const dictadoDe = (cliente: string) => o({ accion: 'PRESUPUESTO_DICTADO', cliente_texto: cliente, partidas: [{ concepto_texto: 'alicatar el baño', cantidad_texto: '12', precio_texto: '40' }] });
  it('tras «¿Lo doy de alta o es otro nombre?», un nombre que existe rellena el hueco y se sigue con el presupuesto dictado', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('presu para Pakita: alicatar el baño 12 metros a 40', dictadoDe('Pakita'));
    expect(q.respuesta).toMatch(/No tengo a «Pakita»/);
    const r = await s.sinTraductor('Paqui'); // sin modelo: se rellena el hueco
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Paqui');
    expect(r.respuesta).toContain('480,00 €');
  });
  it('tras la misma pregunta, «sí» da de alta al cliente y después retoma el presupuesto', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di('presu para Pakita: alicatar el baño 12 metros a 40', dictadoDe('Pakita'));
    const alta = await s.sinTraductor('sí');
    expect(alta.accionPendiente).toBeDefined();
    expect(alta.respuesta).toContain('Pakita');
    const c = await s.confirmar(alta.accionPendiente!.orden_id);
    expect(c.ejecutado).toBe(true);
    expect(db.tablas.clientes.some((x) => x.nombre === 'Pakita')).toBe(true);
    expect(c.accionPendiente).toBeDefined();
    expect(c.respuesta).toContain('480,00 €');
  });
  it('una orden NUEVA y larga no hereda el cliente de la tarea anterior', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const a = await s.di('cita con Ane el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Ane', fecha_texto: 'el lunes', hora_texto: '10' }));
    expect(a.opciones?.length).toBe(2); // ¿cuál Ane?
    const b = await s.di('ponme una cita nueva en Olabide el martes a las 9 de la mañana con el jefe de obra', o({ accion: 'CITA_CREAR', titulo_texto: 'Cita en Olabide', fecha_texto: 'el martes', hora_texto: '9' }), { continua: true });
    expect(b.respuesta).not.toMatch(/Ane/);
    expect(b.accionPendiente).toBeDefined();
  });
});

describe('8 · obras del cliente y tool con opciones', () => {
  const dosObras = () => {
    const b = baseRonda5();
    b.obras.push({ id: 'obra-unai-cocina', business_id: NEGOCIO_A, nombre: 'Reforma cocina Unai', direccion: 'Calle Unai 9', estado: 'abierta', cliente_id: IDS.clienteUnai, created_at: '2026-06-01T10:00:00Z' });
    return b;
  };
  it('solo ofrece obras del cliente (nunca las de otros) y «la 2» funciona', async () => {
    const s = sesion(crearFakeDb(dosObras()));
    const q = await s.di('factura a Unai por 100 más IVA de la reforma', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Unai', importe_texto: '100', iva_modo: 'mas', obra_texto: 'reforma' }));
    expect(q.accionPendiente).toBeUndefined();
    expect(q.opciones?.map((x) => x.etiqueta.split(' · ')[0]).sort()).toEqual(['Reforma baño completo', 'Reforma cocina Unai']);
    const op = q.opciones!.find((x) => x.etiqueta.startsWith('Reforma cocina'))!;
    const r = await s.sinTraductor(String(op.n));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Reforma cocina Unai');
  });
  it('se puede facturar a un cliente con la obra CERRADA nombrándola, y «ninguna» deja la factura sin obra', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const c = await s.di('factura a Amaia por 100 más IVA de la terraza', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Amaia', importe_texto: '100', iva_modo: 'mas', obra_texto: 'terraza' }));
    expect(c.accionPendiente).toBeDefined();
    expect(c.respuesta).toContain('Reforma terraza Amaia');
    const s2 = sesion(crearFakeDb(dosObras()));
    await s2.di('factura a Unai por 100 más IVA de la reforma', o({ accion: 'CREAR_FACTURA', cliente_texto: 'Unai', importe_texto: '100', iva_modo: 'mas', obra_texto: 'reforma' }));
    const n = await s2.sinTraductor('ninguna');
    expect(n.accionPendiente).toBeDefined();
    expect(n.respuesta).toContain('sin obra');
  });
});

describe('13 · referencias y contexto', () => {
  it('«pásala al viernes» después de crear una cita = esa cita', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('cita con Paqui el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el lunes', hora_texto: '10' }));
    const c = await s.confirmar(p.accionPendiente!.orden_id);
    const id = String(c.resultado?.evento_id ?? '');
    expect(id).toBeTruthy();
    const r = await s.di('pásala al viernes', o({ accion: 'CITA_MOVER', evento_texto: 'ella', fecha_texto: 'al viernes' }), { ultimoEventoId: id });
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Cita con Paqui');
  });
  it('«la visita con Ane Lasa pásala al jueves de la semana que viene» → la de Ane directamente, 15 de octubre', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const r = await s.di('la visita con Ane Lasa pásala al jueves de la semana que viene', o({ accion: 'CITA_MOVER', evento_texto: 'Ane Lasa', fecha_texto: 'el jueves de la semana que viene' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('2026-10-15');
    expect(r.respuesta).toContain('Visita con Ane Lasa');
  });
  it('resolverEvento no descarta palabras cortas: «Ane» encuentra la visita de Ane Lasa', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('pasa lo de Ane al lunes', o({ accion: 'CITA_MOVER', evento_texto: 'Ane', fecha_texto: 'al lunes' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('Ane Lasa');
  });
  it('«hazme la factura del presu 8 de Mikel»: el número explícito gana sobre el nombre', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('hazme la factura del presu 8 de Mikel', o({ accion: 'FACTURAR', presupuesto_texto: 'presu 8 de Mikel' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).toContain('nº 8');
    expect(r.respuesta).toContain('García Norte');
  });
  it('un presupuesto que no existe: texto claro', async () => {
    const r = await sesion(crearFakeDb(baseRonda5())).di('factura el 999', o({ accion: 'FACTURAR', presupuesto_texto: '999' }));
    expect(r.respuesta).toMatch(/El presupuesto nº 999 no existe/);
  });
});

describe('14 · citas con proveedor', () => {
  it('«visita con el de Maderas Oria»: no es un cliente; no se ofrece alta y el proveedor queda en las notas', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const r = await s.di('visita con el de Maderas Oria el lunes a las 8', o({ accion: 'CITA_CREAR', cliente_texto: 'el de Maderas Oria', fecha_texto: 'el lunes', hora_texto: 'a las 8' }));
    expect(r.accionPendiente).toBeDefined();
    expect(r.respuesta).not.toMatch(/dar de alta|alta/);
    expect(r.respuesta).toContain('Maderas Oria (tel. 943 222 333)');
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.agenda.at(-1)).toMatchObject({ fecha: '2026-10-12', hora: '08:00' });
    expect(db.tablas.agenda.at(-1)!.cliente_id).toBeUndefined();
  });
  it('un cliente con ese nombre sigue siendo un cliente, y con varios «Ane» se pregunta cuál y se vincula', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const q = await s.di('visita con Ane el lunes a las 10', o({ accion: 'CITA_CREAR', cliente_texto: 'Ane', fecha_texto: 'el lunes', hora_texto: '10' }));
    expect(q.opciones?.map((x) => x.etiqueta).sort()).toEqual(['Ane Lasa', 'Ane Mendia']);
    const r = await s.sinTraductor('2');
    expect(r.respuesta).toMatch(/Cliente vinculado: Ane/);
    await s.confirmar(r.accionPendiente!.orden_id);
    expect(db.tablas.agenda.at(-1)).toMatchObject({ cliente_id: expect.stringMatching(/ane/) });
  });
});

describe('15 · unidades', () => {
  it.each([
    ['rodapié', 'metros', 'ml'], ['encimera', 'metros', 'ml'], ['tubería de cobre', 'metros', 'ml'], ['alicatado', 'metros', 'm2'], ['pintura', 'metros cuadrados', 'm2'], ['suelo', 'm2', 'm2'],
  ])('«%s» en «%s» → %s', async (concepto, unidad, esperado) => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    await s.di(`añádele ${concepto} 3 ${unidad} a 12`, o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '10', anadir: [{ concepto_texto: concepto, cantidad_texto: '3', unidad_texto: unidad, precio_texto: '12' }] }));
    const fila = db.tablas.jev_ordenes_pendientes.at(-1)!;
    expect((fila.args_resueltos as { args: { anadir: Array<{ unidad?: string }> } }).args.anadir[0]!.unidad).toBe(esperado);
  });
  it('la unidad del dictado llega a las líneas de la factura (m2 y ml)', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('presu para Paqui: alicatado 12 metros cuadrados a 40 y rodapié 10 metros a 5', o({
      accion: 'PRESUPUESTO_DICTADO',
      cliente_texto: 'Paqui',
      partidas: [
        { concepto_texto: 'alicatado', cantidad_texto: '12', unidad_texto: 'metros cuadrados', precio_texto: '40' },
        { concepto_texto: 'rodapié', cantidad_texto: '10', unidad_texto: 'metros', precio_texto: '5' },
      ],
    }));
    await s.confirmar(p.accionPendiente!.orden_id);
    const pres = db.tablas.presupuestos.find((x) => x.cliente_nombre === 'Paqui' && x.estado === 'borrador')!;
    pres.estado = 'aceptado';
    const f = await s.di('factura ese presu', o({ accion: 'FACTURAR', presupuesto_texto: 'ese' }), { ultimoPresupuestoId: String(pres.id) });
    await s.confirmar(f.accionPendiente!.orden_id);
    const lineas = db.tablas.facturas.at(-1)!.lineas as Array<{ descripcion: string; unidad: string | null }>;
    expect(lineas.map((l) => l.unidad)).toEqual(['m2', 'ml']);
  });
});

describe('12 · presupuesto aceptado o facturado', () => {
  it('aceptado: avisa y propone el extra; facturado: no se toca y se propone el extra', async () => {
    const s = sesion(crearFakeDb(baseRonda5()));
    const a = await s.di('añádele dos enchufes a 35', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', anadir: [{ concepto_texto: 'enchufes', cantidad_texto: 'dos', precio_texto: '35' }] }));
    expect(a.respuesta).toMatch(/ya está aceptado/);
    expect(a.respuesta).toMatch(/EXTRA/);
    const b = baseRonda5();
    b.presupuestos.find((p) => p.id === IDS.presupuestoAinhoaPendiente)!.estado = 'facturado';
    const f = await sesion(crearFakeDb(b)).di('añádele dos enchufes a 35', o({ accion: 'PRESUPUESTO_PARTIDAS', presupuesto_texto: '11', anadir: [{ concepto_texto: 'enchufes', cantidad_texto: 'dos', precio_texto: '35' }] }));
    expect(f.accionPendiente).toBeUndefined();
    expect(f.respuesta).toMatch(/ya está facturado: no puedo cambiarle/);
  });
  it('el extra se registra vinculado al presupuesto original, sin tocarlo', async () => {
    const db = crearFakeDb(baseRonda5());
    const s = sesion(db);
    const p = await s.di('extra en el 11: campana extractora, 120', o({ accion: 'EXTRA_PRESUPUESTO', presupuesto_texto: '11', descripcion_texto: 'campana extractora', importe_texto: '120' }));
    expect(p.accionPendiente).toBeDefined();
    expect(p.respuesta).toMatch(/EXTRA de 120,00 €/);
    const antes = db.tablas.presupuestos.find((x) => x.id === IDS.presupuestoAinhoaPendiente)!.importe_total;
    await s.confirmar(p.accionPendiente!.orden_id);
    expect(db.tablas.presupuestos.find((x) => x.es_extra === true)).toMatchObject({ parent_id: IDS.presupuestoAinhoaPendiente, importe_total: 120 });
    expect(db.tablas.presupuestos.find((x) => x.id === IDS.presupuestoAinhoaPendiente)!.importe_total).toBe(antes);
  });
});
