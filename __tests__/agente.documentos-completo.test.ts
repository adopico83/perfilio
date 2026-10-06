import { prepararAccionPendiente } from '@/lib/agente/confirmacion';
import { handleDocumentosAgent } from '@/lib/agente/modules/documentos';
import { importeSaleDe, numerosDelTexto } from '@/lib/agente/modules/documentos-validacion';
import { crearFakeDb, type Fila } from './helpers/fake-db';

const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';
const F = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, '0')}`;

const factura = (extra: Fila = {}): Fila => ({
  id: F('f3'), business_id: BIZ, numero_factura: 3, cliente_nombre: 'García', total: 1210, estado: 'pendiente',
  base_imponible: 1000, iva: 210, lineas: [{ descripcion: 'Obra', cantidad: 1, precio_unitario: 1000, unidad: null, capitulo: null, importe: 1000 }],
  descripcion_trabajos: 'Obra', ...extra,
});
const albaran = (extra: Fila = {}): Fila => ({
  id: F('a12'), business_id: BIZ, numero_albaran: 12, cliente_nombre: 'García', cliente_id: 'cli-g', total: 1210, estado: 'entregado',
  descripcion_trabajos: 'Arreglo', lineas: null, ...extra,
});

function deps(tablas: Record<string, Fila[]>, mensajeUsuario = '', historialUsuario: string[] = []) {
  const d = crearFakeDb({ facturas: [], albaranes: [], clientes: [], obras: [], presupuestos: [], ...tablas });
  return { d, deps: { supabase: d.client, businessId: BIZ, runTool: async () => ({}), mensajeUsuario, historialUsuario } };
}
const prep = (tool: string, args: Record<string, unknown>, tablas: Record<string, Fila[]>, msg = '') => {
  const x = deps(tablas, msg);
  return prepararAccionPendiente(tool, args, x.deps).then((r) => ({ r, d: x.d }));
};

describe('localizar por número o cliente y resumen con datos reales', () => {
  it('«Factúrame el albarán 12» → confirmación con nº, cliente y total', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { numero: 12 }, { albaranes: [albaran()] });
    expect(r.tipo).toBe('pendiente');
    if (r.tipo !== 'pendiente') return;
    expect(r.accion.resumen).toContain('albarán nº 12 de García');
    expect(r.accion.resumen).toContain('1.210');
    expect(r.accion.args).toMatchObject({ albaran_id: F('a12'), iva: 21 });
    expect(r.accion.args).not.toHaveProperty('numero');
  });

  it('por cliente con dos albaranes → pregunta con opciones', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { cliente: 'García' }, {
      albaranes: [albaran(), albaran({ id: F('a13'), numero_albaran: 13 })],
    });
    expect(r).toMatchObject({ tipo: 'resultado', result: { necesita_aclaracion: true } });
    if (r.tipo === 'resultado') expect((r.result.candidatos as unknown[]).length).toBe(2);
  });

  it('por cliente ignora los ya facturados', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { cliente: 'García' }, {
      albaranes: [albaran(), albaran({ id: F('a13'), numero_albaran: 13, estado: 'facturado' })],
    });
    expect(r.tipo).toBe('pendiente');
  });

  it('un albarán ya facturado → error claro, sin confirmar', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { numero: 12 }, { albaranes: [albaran({ estado: 'facturado' })] });
    expect(r).toMatchObject({ tipo: 'resultado', result: { ok: false } });
    expect(JSON.stringify(r)).toContain('ya está facturado');
  });

  it('el número de OTRO negocio no se resuelve', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { numero: 12 }, { albaranes: [albaran({ business_id: OTRO })] });
    expect(r).toMatchObject({ tipo: 'resultado', result: { ok: false } });
    expect(JSON.stringify(r)).toContain('No encuentro');
  });

  it('sin número ni cliente → pregunta cuál', async () => {
    const { r } = await prep('convertir_albaran_a_factura', {}, { albaranes: [albaran()] });
    expect(JSON.stringify(r)).toContain('Dime el número o el cliente');
  });

  it('IVA fuera de 0/4/10/21 → error', async () => {
    const { r } = await prep('convertir_albaran_a_factura', { numero: 12, iva: 18 }, { albaranes: [albaran()] });
    expect(JSON.stringify(r)).toContain('El IVA debe ser uno de');
  });

  it('«Marca la factura 3 como pagada» (y «pagado») → confirmación y guarda pagada', async () => {
    for (const estado of ['pagada', 'pagado']) {
      const { r } = await prep('cambiar_estado_factura', { numero: 3, estado }, { facturas: [factura()] });
      expect(r.tipo).toBe('pendiente');
      if (r.tipo !== 'pendiente') return;
      expect(r.accion.args).toMatchObject({ id: F('f3'), estado: 'pagada' });
      expect(r.accion.resumen).toContain('factura nº 3 de García (1.210 €)');
      expect(r.accion.resumen).toContain('«pagada»');
    }
  });

  it('estado de factura que no existe («aceptado») → error con los estados válidos', async () => {
    const { r } = await prep('cambiar_estado_factura', { numero: 3, estado: 'aceptado' }, { facturas: [factura()] });
    expect(JSON.stringify(r)).toContain('pendiente, pagada, vencida');
  });

  it('«Cambia el albarán 12 a pendiente» si está facturado → error claro', async () => {
    const { r } = await prep('cambiar_estado_albaran', { numero: 12, estado: 'pendiente' }, { albaranes: [albaran({ estado: 'facturado' })] });
    expect(JSON.stringify(r)).toContain('ya está facturado: no cambia de estado');
  });

  it('un albarán no se pone «facturado» a mano', async () => {
    const { r } = await prep('cambiar_estado_albaran', { numero: 12, estado: 'facturado' }, { albaranes: [albaran()] });
    expect(JSON.stringify(r)).toContain('factúrame el albarán');
  });

  it('editar un albarán facturado o una factura pagada → error', async () => {
    const a = await prep('editar_albaran', { numero: 12, importe_total: 5 }, { albaranes: [albaran({ estado: 'facturado' })] });
    expect(JSON.stringify(a.r)).toContain('no se puede editar');
    const f = await prep('editar_factura', { numero: 3, cliente_nombre: 'Ana' }, { facturas: [factura({ estado: 'pagada' })] });
    expect(JSON.stringify(f.r)).toContain('Solo se pueden editar facturas pendientes');
  });

  it('editar factura: el resumen cuenta los cambios', async () => {
    const { r } = await prep('editar_factura', { numero: 3, iva_porcentaje: 10, lineas: [{ descripcion: 'x', cantidad: 1, precio_unitario: 5 }] }, { facturas: [factura()] });
    if (r.tipo !== 'pendiente') throw new Error('esperaba pendiente');
    expect(r.accion.resumen).toContain('1 línea, IVA 10 %');
  });
});

describe('las tools aplican las mismas reglas que la API (y no escriben si no deben)', () => {
  const ejecutar = (tool: string, args: Record<string, unknown>, tablas: Record<string, Fila[]>) => {
    const d = crearFakeDb({ facturas: [], albaranes: [], presupuestos: [], ...tablas });
    return handleDocumentosAgent(tool, args, BIZ, 'u1', d.client, {} as never, { mensajeTrim: '', mensaje: '' }).then((r) => ({ r: r as Record<string, unknown>, d }));
  };

  it('cambiar_estado_factura guarda «pagada» (nunca «pagado»)', async () => {
    const { r, d } = await ejecutar('cambiar_estado_factura', { id: F('f3'), estado: 'pagado' }, { facturas: [factura()] });
    expect(r.ok).toBe(true);
    expect(d.tablas.facturas[0].estado).toBe('pagada');
  });

  it('cambiar_estado_factura rechaza estados que no existen en facturas', async () => {
    const { r, d } = await ejecutar('cambiar_estado_factura', { id: F('f3'), estado: 'aceptado' }, { facturas: [factura()] });
    expect(r.error).toContain('pendiente, pagada, vencida');
    expect(d.updates).toHaveLength(0);
  });

  it('editar_factura usa actualizarFactura: recalcula con el IVA nuevo y guarda las líneas', async () => {
    const { r, d } = await ejecutar('editar_factura', { numero: 3, iva_porcentaje: 10, lineas: [{ descripcion: 'Alicatado', cantidad: 10, precio_unitario: 100 }] }, { facturas: [factura()] });
    expect(r.ok).toBe(true);
    expect(d.tablas.facturas[0]).toMatchObject({ base_imponible: 1000, iva: 100, total: 1100 });
    expect((d.tablas.facturas[0].lineas as Fila[])[0]).toMatchObject({ descripcion: 'Alicatado', importe: 1000 });
  });

  it('editar_factura valida como el editor (cantidad 0 → error, no escribe)', async () => {
    const { r, d } = await ejecutar('editar_factura', { numero: 3, lineas: [{ descripcion: 'x', cantidad: 0, precio_unitario: 1 }] }, { facturas: [factura()] });
    expect(String(r.error)).toContain('cantidad');
    expect(d.updates).toHaveLength(0);
  });

  it('editar_factura con líneas guardadas no cambia solo el total (el PDF no cuadraría)', async () => {
    const { r, d } = await ejecutar('editar_factura', { numero: 3, importe_total: 999 }, { facturas: [factura()] });
    expect(String(r.error)).toContain('líneas de detalle');
    expect(d.updates).toHaveLength(0);
  });

  it('editar_factura antigua sin líneas: una sola línea y el IVA que ya tenía', async () => {
    const { r, d } = await ejecutar('editar_factura', { numero: 3, importe_total: 1100 }, { facturas: [factura({ lineas: [], base_imponible: 1000, iva: 100 })] });
    expect(r.ok).toBe(true);
    expect(d.tablas.facturas[0]).toMatchObject({ base_imponible: 1000, iva: 100, total: 1100 });
  });

  it('cambiar_estado_albaran y editar_albaran no tocan un albarán facturado', async () => {
    const a = await ejecutar('cambiar_estado_albaran', { numero: 12, estado: 'pendiente' }, { albaranes: [albaran({ estado: 'facturado' })] });
    expect(a.d.updates).toHaveLength(0);
    expect(String(a.r.error)).toContain('facturado');
    const b = await ejecutar('editar_albaran', { numero: 12, importe_total: 5 }, { albaranes: [albaran({ estado: 'Facturado' })] });
    expect(b.d.updates).toHaveLength(0);
  });

  it('cambiar_estado_albaran: «facturado» a mano no vale', async () => {
    const { r, d } = await ejecutar('cambiar_estado_albaran', { numero: 12, estado: 'facturado' }, { albaranes: [albaran()] });
    expect(String(r.error)).toContain('factura');
    expect(d.updates).toHaveLength(0);
  });

  it('un número de otro negocio no se resuelve ni se toca', async () => {
    const { r, d } = await ejecutar('editar_albaran', { numero: 12, importe_total: 5 }, { albaranes: [albaran({ business_id: OTRO })] });
    expect(String(r.error)).toContain('No encuentro');
    expect(d.updates).toHaveLength(0);
  });
});

describe('no inventar importes ni clientes', () => {
  const cliente = (id: string, nombre: string): Fila => ({ id, business_id: BIZ, nombre });

  it('numerosDelTexto e importeSaleDe entienden formatos españoles y el IVA', () => {
    expect(numerosDelTexto('800 euros, 1.210,50 y 12,5')).toEqual([800, 1210.5, 12.5]);
    expect(importeSaleDe(800, ['hazme una factura de 800'])).toBe(true);
    expect(importeSaleDe(968, ['800 más IVA'])).toBe(true);
    expect(importeSaleDe(1000, ['hazme una factura de 800'])).toBe(false);
  });

  it('«Haz una factura para Paqui» (sin importe) → pregunta el importe', async () => {
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'Reforma', cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Haz una factura para Paqui');
    expect(JSON.stringify(r)).toContain('¿Qué importe le pongo a la factura?');
  });

  it('un importe que no dijo el usuario → pregunta, no escribe', async () => {
    const { r, d } = await prep('crear_factura', { descripcion_trabajos: 'Reforma', total: 1500, cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Hazle la factura a Paqui');
    expect(JSON.stringify(r)).toContain('No me has dicho ese importe');
    expect(d.inserts).toHaveLength(0);
  });

  it('con el importe en el mensaje y el cliente existente → confirmación con el cliente resuelto', async () => {
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'Reforma', total: 800, cliente_nombre: 'paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Hazle una factura de 800 a Paqui');
    expect(r.tipo).toBe('pendiente');
    if (r.tipo === 'pendiente') expect(r.accion.args).toMatchObject({ cliente_id: 'c1', cliente_nombre: 'Paqui', total: 800 });
  });

  it('el importe dicho un turno antes también vale', async () => {
    const x = deps({ clientes: [cliente('c1', 'Paqui')] }, 'sí, a Paqui', ['Hazme una factura de 800']);
    const r = await prepararAccionPendiente('crear_factura', { descripcion_trabajos: 'x', total: 800, cliente_nombre: 'Paqui' }, x.deps);
    expect(r.tipo).toBe('pendiente');
  });

  it('«Mete la factura de Txema» si Txema no existe → pregunta antes de crearlo', async () => {
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'x', total: 300, cliente_nombre: 'Txema' }, { clientes: [cliente('c1', 'Paqui')] }, 'Mete la factura de Txema de 300');
    expect(JSON.stringify(r)).toContain('No tengo a «Txema» entre tus clientes');
  });

  it('«Hazle la factura a García» con dos Garcías → pregunta cuál', async () => {
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'x', total: 300, cliente_nombre: 'García' }, { clientes: [cliente('c1', 'Ana García'), cliente('c2', 'Luis García')] }, 'Hazle la factura a García de 300');
    expect(r).toMatchObject({ tipo: 'resultado', result: { necesita_aclaracion: true } });
  });

  it('factura sin cliente ni obra → pregunta para quién', async () => {
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'x', total: 300 }, {}, 'Haz una factura de 300');
    expect(JSON.stringify(r)).toContain('¿Para qué cliente u obra');
  });

  it('«factura de 800 para la obra del baño» con dos obras con baño → pregunta cuál', async () => {
    const obras = [
      { id: F('o1'), business_id: BIZ, nombre: 'Reforma baño García', estado: 'abierta', direccion: 'Calle 1' },
      { id: F('o2'), business_id: BIZ, nombre: 'Reforma baño Luis', estado: 'en_curso', direccion: 'Calle 2' },
    ];
    const { r } = await prep('crear_factura', { descripcion_trabajos: 'obra del baño', total: 800 }, { obras }, 'Hazme una factura de 800 para la obra del baño');
    expect(r).toMatchObject({ tipo: 'resultado' });
    expect(JSON.stringify(r)).toMatch(/varias obras|necesita_aclaracion/);
  });

  it('crear_albaran: importe inventado → pregunta; sin importe → vale (es opcional)', async () => {
    const mal = await prep('crear_albaran', { descripcion_trabajos: 'x', total: 99, cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Haz un albarán para Paqui');
    expect(JSON.stringify(mal.r)).toContain('No me has dicho ese importe');
    const bien = await prep('crear_albaran', { descripcion_trabajos: 'x', cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Haz un albarán para Paqui');
    expect(bien.r.tipo).toBe('pendiente');
  });

  it('crear_presupuesto: el importe puede salir del texto del presupuesto, no de la nada', async () => {
    const ok = await prep('crear_presupuesto', { texto_presupuesto: 'Alicatado: 500 €', importe_total: 500, cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Crea un presupuesto');
    expect(ok.r.tipo).toBe('pendiente');
    const mal = await prep('crear_presupuesto', { texto_presupuesto: 'Alicatado', importe_total: 7777, cliente_nombre: 'Paqui' }, { clientes: [cliente('c1', 'Paqui')] }, 'Crea un presupuesto');
    expect(JSON.stringify(mal.r)).toContain('No me has dicho ese importe');
  });
});
