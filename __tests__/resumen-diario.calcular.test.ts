import {
  calcularFacturas,
  calcularMargenEnRiesgo,
  calcularObrasSinFactura,
  calcularObrasParadas,
  calcularPresupuestosSinRespuesta,
  calcularResumenDia,
  diasEntre,
  sumarDias,
  textoResumen,
  ymdMadrid,
} from '@/lib/resumen-diario/calcular';

// 5 oct 2026, 7:30 en Madrid (CEST, UTC+2)
const NOW = new Date('2026-10-05T05:30:00Z');
const HOY = '2026-10-05';

describe('fechas en Madrid', () => {
  it('usa el día de Madrid, no el UTC (23:30 UTC ya es mañana en Madrid)', () => {
    expect(ymdMadrid(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
    expect(ymdMadrid(NOW)).toBe(HOY);
  });
  it('suma días y cruza fin de mes y cambio de hora', () => {
    expect(sumarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDias('2026-10-05', -5)).toBe('2026-09-30');
    expect(diasEntre('2026-10-24', '2026-10-27')).toBe(3);
  });
});

describe('citas de hoy y de mañana', () => {
  const citas = [
    { id: 'c3', titulo: 'Visita tarde', hora: '17:00', fecha: HOY },
    { id: 'c1', titulo: 'Medición', hora: '09:00', fecha: HOY },
    { id: 'c4', titulo: 'Sin hora', hora: null, fecha: HOY },
    { id: 'c2', titulo: 'Reunión', hora: '10:00', fecha: '2026-10-06' },
    { id: 'c5', titulo: 'Pasado mañana', hora: '10:00', fecha: '2026-10-07' },
  ];
  const r = calcularResumenDia(
    { citas, obras: [], diario: [], presupuestos: [], facturas: [] },
    NOW
  );
  it('separa hoy y mañana, ordena por hora y descarta otros días', () => {
    expect(r.citasHoy.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
    expect(r.citasManana.map((c) => c.id)).toEqual(['c2']);
  });
  it('enlaza a la agenda', () => {
    expect(r.citasHoy[0].href).toBe('/agenda');
    expect(r.citasHoy[2].detalle).toBe('Sin hora');
  });
});

describe('obras paradas', () => {
  const antigua = '2026-08-01T10:00:00Z';
  const obra = (id: string, extra = {}) => ({ id, nombre: id, estado: 'en_curso', created_at: antigua, ...extra });

  it('marca la obra activa sin entradas en los últimos 5 días', () => {
    const r = calcularObrasParadas([obra('o1')], [{ obra_id: 'o1', fecha: '2026-09-28' }], HOY);
    expect(r).toHaveLength(1);
    expect(r[0].href).toBe('/obras?id=o1');
  });
  it('no la marca si tuvo entrada hace exactamente 5 días (límite) ni si es de hoy', () => {
    expect(calcularObrasParadas([obra('o1')], [{ obra_id: 'o1', fecha: '2026-09-30' }], HOY)).toHaveLength(0);
    expect(calcularObrasParadas([obra('o1')], [{ obra_id: 'o1', fecha: HOY }], HOY)).toHaveLength(0);
  });
  it('la entrada de otra obra no cuenta', () => {
    const r = calcularObrasParadas([obra('o1'), obra('o2')], [{ obra_id: 'o2', fecha: HOY }], HOY);
    expect(r.map((i) => i.id)).toEqual(['o1']);
  });
  it('ignora obras cerradas o pausadas', () => {
    const r = calcularObrasParadas(
      [obra('o1', { estado: 'cerrada' }), obra('o2', { estado: 'pausada' })],
      [],
      HOY
    );
    expect(r).toHaveLength(0);
  });
  it('no avisa de una obra recién creada sin entradas todavía', () => {
    expect(calcularObrasParadas([obra('o1', { created_at: '2026-10-03T08:00:00Z' })], [], HOY)).toHaveLength(0);
    expect(calcularObrasParadas([obra('o1', { fecha_inicio: '2026-10-04' })], [], HOY)).toHaveLength(0);
  });
  it('avisa de una obra antigua que nunca tuvo entradas', () => {
    expect(calcularObrasParadas([obra('o1')], [], HOY)).toHaveLength(1);
  });
});

describe('presupuestos sin respuesta', () => {
  const p = (id: string, fecha: string, estado = 'pendiente') => ({
    id,
    estado,
    fecha,
    cliente_nombre: 'Ana',
    numero_presupuesto: id,
    importe_total: 1000,
  });
  it('avisa si lleva más de 7 días y no si lleva 7 o menos', () => {
    const r = calcularPresupuestosSinRespuesta(
      [p('a', '2026-09-27'), p('b', '2026-09-28'), p('c', '2026-10-04')],
      HOY
    );
    expect(r.map((i) => i.id)).toEqual(['a']); // 8 días sí; 7 y 1 no
  });
  it('solo cuenta estados sin respuesta y ordena del más antiguo al más reciente', () => {
    const r = calcularPresupuestosSinRespuesta(
      [
        p('x', '2026-09-01', 'aceptado'),
        p('y', '2026-09-01', 'borrador'),
        p('z', '2026-09-10', 'enviado'),
        p('w', '2026-09-01', 'pendiente'),
        p('v', '2026-09-01', 'rechazado'),
      ],
      HOY
    );
    expect(r.map((i) => i.id)).toEqual(['w', 'z']);
    expect(r[0].href).toBe('/presupuestos?id=w');
    expect(r[0].detalle).toContain('hace 34 días');
  });
  it('usa created_at si no hay fecha', () => {
    const r = calcularPresupuestosSinRespuesta(
      [{ id: 'q', estado: 'pendiente', cliente_nombre: null, importe_total: null, created_at: '2026-09-01T10:00:00Z' }],
      HOY
    );
    expect(r).toHaveLength(1);
  });
});

describe('facturas pendientes y vencidas', () => {
  const f = (id: string, estado: string, fecha_vencimiento: string | null) => ({
    id,
    estado,
    numero_factura: `F-${id}`,
    cliente_nombre: 'Luis',
    total: 500,
    fecha_vencimiento,
  });
  const r = calcularFacturas(
    [
      f('1', 'pendiente', '2026-10-20'),
      f('2', 'pendiente', '2026-10-01'), // pendiente pero ya pasada de fecha → vencida
      f('3', 'vencida', null),
      f('4', 'pagada', '2026-09-01'),
      f('5', 'pendiente', HOY), // vence hoy: aún no vencida
      f('6', 'pendiente', null),
    ],
    HOY
  );
  it('separa pendientes de vencidas sin contar nada dos veces', () => {
    expect(r.pendientes.map((i) => i.id)).toEqual(['1', '5', '6']);
    expect(r.vencidas.map((i) => i.id)).toEqual(['2', '3']);
  });
  it('ignora las pagadas y enlaza a la factura', () => {
    expect([...r.pendientes, ...r.vencidas].some((i) => i.id === '4')).toBe(false);
    expect(r.vencidas[0].href).toBe('/facturas?id=2');
    expect(r.vencidas[0].detalle).toContain('vencida hace 4 días');
  });
});

describe('resumen completo', () => {
  it('sin nada que avisar: todo en orden', () => {
    const r = calcularResumenDia({ citas: [], obras: [], diario: [], presupuestos: [], facturas: [] }, NOW);
    expect(r.todoEnOrden).toBe(true);
    expect(r.totalAvisos).toBe(0);
    expect(textoResumen(r)).toBe('Resumen del día: todo en orden.');
  });
  it('cuenta los avisos y genera el texto', () => {
    const r = calcularResumenDia(
      {
        citas: [{ id: 'c', titulo: 'Medición', hora: '09:00', fecha: HOY }],
        obras: [],
        diario: [],
        presupuestos: [],
        facturas: [{ id: '1', estado: 'vencida', numero_factura: 'F-1', cliente_nombre: 'Luis', total: 100, fecha_vencimiento: '2026-10-01' }],
      },
      NOW
    );
    expect(r.todoEnOrden).toBe(false);
    expect(r.totalAvisos).toBe(2);
    const txt = textoResumen(r);
    expect(txt).toContain('Citas de hoy (1):');
    expect(txt).toContain('Facturas vencidas (1):');
    expect(txt).toContain('Medición');
  });
});

describe('margen en riesgo', () => {
  const obra = (id: string, extra = {}) => ({ id, nombre: id, estado: 'activa', created_at: '2026-08-01T00:00:00Z', ...extra });
  // 32 €/h: 25 h = 800 € = 80 % de 1000 (justo en el límite, no avisa); 26 h = 832 € = 83,2 %.
  const horas = (obra_id: string, h: number) => [{ obra_id, horas_reales: h }];
  const presu = (obra_id: string, importe: number, estado = 'aceptado') => ({ obra_id, importe_total: importe, estado });

  it('avisa si el coste de las horas supera el 80 % del presupuesto', () => {
    const r = calcularMargenEnRiesgo([obra('o1')], horas('o1', 26), [presu('o1', 1000)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'margen_riesgo', id: 'o1', href: '/obras?id=o1' });
    expect(r[0].detalle).toMatch(/83%/);
  });
  it('no avisa justo en el 80 % ni por debajo', () => {
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 25), [presu('o1', 1000)])).toHaveLength(0);
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 10), [presu('o1', 1000)])).toHaveLength(0);
  });
  it('suma las jornadas de la obra', () => {
    const j = [...horas('o1', 13), ...horas('o1', 13), ...horas('o2', 100)];
    expect(calcularMargenEnRiesgo([obra('o1')], j, [presu('o1', 1000)])).toHaveLength(1);
  });
  it('sin presupuesto (o con importe 0) no hay aviso', () => {
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 500), [])).toHaveLength(0);
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 500), [presu('o1', 0)])).toHaveLength(0);
  });
  it('ignora los presupuestos rechazados', () => {
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 500), [presu('o1', 1000, 'rechazado')])).toHaveLength(0);
    // Con un rechazado grande y uno bueno pequeño, manda el bueno.
    const r = calcularMargenEnRiesgo([obra('o1')], horas('o1', 26), [presu('o1', 50000, 'rechazado'), presu('o1', 1000)]);
    expect(r).toHaveLength(1);
  });
  it('usa el mayor de los presupuestos de la obra, no la suma', () => {
    // 26 h = 832 €; con dos presupuestos de 1000 sumados (2000) no avisaría; con el mayor sí.
    expect(calcularMargenEnRiesgo([obra('o1')], horas('o1', 26), [presu('o1', 1000), presu('o1', 1000)])).toHaveLength(1);
  });
  it('mira todas las obras activas (abierta, en_curso, activa) y no las cerradas', () => {
    const obras = ['abierta', 'en_curso', 'activa', 'cerrada'].map((e) => obra(e, { estado: e }));
    const j = obras.flatMap((o) => horas(o.id, 26));
    const p = obras.map((o) => presu(o.id, 1000));
    expect(calcularMargenEnRiesgo(obras, j, p).map((i) => i.id).sort()).toEqual(['abierta', 'activa', 'en_curso']);
  });
  it('entra en el resumen del día y cuenta como aviso', () => {
    const r = calcularResumenDia(
      { citas: [], obras: [obra('o1', { created_at: '2026-10-04T00:00:00Z' })], diario: [], presupuestos: [], facturas: [], jornadas: horas('o1', 26), presupuestosObra: [presu('o1', 1000)] },
      NOW
    );
    expect(r.margenEnRiesgo).toHaveLength(1);
    expect(r.totalAvisos).toBe(1);
    expect(r.todoEnOrden).toBe(false);
    expect(textoResumen(r)).toContain('Margen en riesgo (1):');
  });
});

describe('obras que terminan sin factura', () => {
  const obra = (id: string, fecha_fin: string | null, extra = {}) => ({ id, nombre: id, estado: 'en_curso', fecha_fin, ...extra });

  it('avisa si termina dentro de 7 días o menos y no tiene factura', () => {
    const r = calcularObrasSinFactura([obra('hoy', HOY), obra('dia7', '2026-10-12'), obra('dia8', '2026-10-13')], [], HOY);
    expect(r.map((i) => i.id)).toEqual(['hoy', 'dia7']);
    expect(r[0]).toMatchObject({ tipo: 'obra_sin_factura', href: '/obras?id=hoy' });
  });
  it('si ya pasó la fecha dice «terminó el», si no «termina el»', () => {
    const r = calcularObrasSinFactura([obra('pasada', '2026-10-01'), obra('futura', '2026-10-08')], [], HOY);
    expect(r.find((i) => i.id === 'pasada')?.detalle).toBe('terminó el 01/10/2026 y no tiene factura');
    expect(r.find((i) => i.id === 'futura')?.detalle).toBe('termina el 08/10/2026 y no tiene factura');
  });
  it('ordena por fecha de fin', () => {
    const r = calcularObrasSinFactura([obra('b', '2026-10-09'), obra('a', '2026-10-02')], [], HOY);
    expect(r.map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('no avisa si la obra ya tiene una factura, sin fecha_fin o no está activa', () => {
    expect(calcularObrasSinFactura([obra('o1', HOY)], [{ obra_id: 'o1' }], HOY)).toHaveLength(0);
    expect(calcularObrasSinFactura([obra('o1', null)], [], HOY)).toHaveLength(0);
    expect(calcularObrasSinFactura([obra('o1', HOY, { estado: 'cerrada' })], [], HOY)).toHaveLength(0);
  });
  it('entra en el resumen del día', () => {
    const r = calcularResumenDia(
      { citas: [], obras: [obra('o1', '2026-10-07', { created_at: '2026-10-04T00:00:00Z' })], diario: [], presupuestos: [], facturas: [], facturasObra: [] },
      NOW
    );
    expect(r.obrasSinFactura.map((i) => i.id)).toEqual(['o1']);
    expect(textoResumen(r)).toContain('Obras que terminan sin factura (1):');
  });
});
