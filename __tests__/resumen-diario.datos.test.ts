import { cargarResumenDia } from '@/lib/resumen-diario/datos';
import { urgenciaResumen } from '@/lib/resumen-diario/guardar';
import { calcularResumenDia } from '@/lib/resumen-diario/calcular';
import { crearFakeDb } from './helpers/fake-db';

const NOW = new Date('2026-10-05T05:30:00Z');
const A = 'biz-a';
const B = 'biz-b';

// Un negocio B con datos que NO deben aparecer en el resumen de A.
const tablas = {
  agenda: [],
  diario_obra: [],
  obras: [
    { id: 'oA', business_id: A, nombre: 'Obra A', estado: 'en_curso', created_at: '2026-10-04T00:00:00Z', fecha_inicio: null, fecha_fin: '2026-10-08' },
    { id: 'oB', business_id: B, nombre: 'Obra B', estado: 'en_curso', created_at: '2026-10-04T00:00:00Z', fecha_inicio: null, fecha_fin: '2026-10-08' },
  ],
  registros_jornada: [
    { business_id: A, obra_id: 'oA', horas_reales: 26 },
    { business_id: B, obra_id: 'oB', horas_reales: 500 },
  ],
  presupuestos: [
    { business_id: A, obra_id: 'oA', importe_total: 1000, estado: 'aceptado', cliente_nombre: 'x' },
    { business_id: B, obra_id: 'oB', importe_total: 10, estado: 'aceptado', cliente_nombre: 'y' },
  ],
  facturas: [{ business_id: B, obra_id: 'oB', estado: 'pagada' }],
};

describe('cargarResumenDia: margen y obras sin factura', () => {
  it('calcula con los datos del negocio y ninguna consulta se hace sin business_id', async () => {
    const f = crearFakeDb(tablas);
    const r = await cargarResumenDia(f.client, A, NOW);
    expect(r.margenEnRiesgo.map((i) => i.id)).toEqual(['oA']);
    expect(r.obrasSinFactura.map((i) => i.id)).toEqual(['oA']);
    for (const q of f.consultas) {
      expect(q.filtros).toContainEqual(['business_id', A]);
    }
    const tablasConsultadas = f.consultas.map((q) => q.tabla);
    expect(tablasConsultadas).toEqual(expect.arrayContaining(['registros_jornada', 'presupuestos', 'facturas', 'obras']));
  });

  it('pide fecha_fin en las obras', async () => {
    const f = crearFakeDb(tablas);
    await cargarResumenDia(f.client, A, NOW);
    expect(f.consultas.find((q) => q.tabla === 'obras')?.select).toContain('fecha_fin');
  });

  it('sin obras activas no consulta jornadas ni facturas de obra', async () => {
    const f = crearFakeDb({ ...tablas, obras: [] });
    await cargarResumenDia(f.client, A, NOW);
    expect(f.consultas.some((q) => q.tabla === 'registros_jornada')).toBe(false);
  });
});

describe('urgenciaResumen', () => {
  const vacio = calcularResumenDia({ citas: [], obras: [], diario: [], presupuestos: [], facturas: [] }, NOW);
  const item = { tipo: 'margen_riesgo' as const, id: 'o', titulo: 'o', detalle: '', href: '/' };
  it('margen en riesgo = alta; obras sin factura = media; nada = baja', () => {
    expect(urgenciaResumen({ ...vacio, margenEnRiesgo: [item] })).toBe('alta');
    expect(urgenciaResumen({ ...vacio, obrasSinFactura: [{ ...item, tipo: 'obra_sin_factura' }] })).toBe('media');
    expect(urgenciaResumen(vacio)).toBe('baja');
  });
});
