import { parsePresupuestoGenerado } from '@/lib/pdf/parser';
import { metricaPresupuesto } from '@/lib/demo-metricas';
import { GASTO_CATEGORIAS } from '@/lib/gastos-categoria';
import { pickHoy } from '@/lib/hoy';
import { construirGastos } from '@/lib/demo-data/orbegozo-operativa';
import { DEMO_OBRAS_BASE } from '@/lib/demo-data/orbegozo-base';
import {
  DEMO_CLIENTES,
  DEMO_EMPRESA,
  getDemoAgendaMes,
  getDemoAgendaProximos,
  getDemoAlbaranes,
  getDemoClienteFicha,
  getDemoClientes,
  getDemoDiario,
  getDemoDiarioAgrupado,
  getDemoFacturas,
  getDemoHoy,
  getDemoMensajes,
  getDemoObraDetalle,
  getDemoObras,
  getDemoPresupuestos,
  getDemoResumenGastos,
  getDemoResumenOperarios,
  demoFecha,
  demoHoy,
} from '@/lib/demo-data';

// Miércoles 15 de octubre de 2025: mes con varios días laborables ya transcurridos.
const NOW = new Date('2025-10-15T10:00:00Z');
const HOY = '2025-10-15';
const MES = '2025-10';

/** Cifras acordadas para el prospect: [base, iva, total]. */
const ESPERADO: Record<string, [number, number, number]> = {
  'demo-presupuesto-1': [24850, 5218.5, 30068.5],
  'demo-presupuesto-2': [2140, 449.4, 2589.4],
  'demo-presupuesto-3': [6980, 1465.8, 8445.8],
  'demo-presupuesto-4': [11420, 2398.2, 13818.2],
  'demo-presupuesto-5': [38600, 8106, 46706],
  'demo-presupuesto-6': [15300, 3213, 18513],
  'demo-presupuesto-7': [5900, 1239, 7139],
  'demo-presupuesto-8': [4250, 892.5, 5142.5],
};

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('demo-data: fechas relativas', () => {
  it('demoFecha es relativa a hoy en Europe/Madrid', () => {
    expect(demoHoy(NOW)).toBe(HOY);
    expect(demoFecha(-2, NOW)).toBe('2025-10-13');
    expect(demoFecha(20, NOW)).toBe('2025-11-04');
  });

  it('cambia de día según la zona horaria de Madrid, no la de UTC', () => {
    expect(demoHoy(new Date('2025-10-15T23:30:00Z'))).toBe('2025-10-16');
  });
});

describe('demo-data: presupuestos', () => {
  const presupuestos = getDemoPresupuestos(NOW);

  it('hay 8 presupuestos con las cifras acordadas', () => {
    expect(presupuestos).toHaveLength(8);
    for (const p of presupuestos) {
      const [base, iva, total] = ESPERADO[p.id];
      const parsed = parsePresupuestoGenerado(p.presupuesto_generado ?? '');
      const sumaPartidas = r2(parsed.capitulos.flatMap((c) => c.partidas).reduce((s, x) => s + x.importe, 0));
      const sumaCapitulos = r2(parsed.capitulos.reduce((s, c) => s + c.total, 0));
      expect(sumaPartidas).toBe(base);
      expect(sumaCapitulos).toBe(base);
      expect(parsed.baseImponible).toBe(base);
      expect(parsed.importeIva).toBe(iva);
      expect(parsed.importeIva).toBe(r2(base * 0.21));
      expect(parsed.total).toBe(total);
      expect(r2(base + iva)).toBe(total);
      expect(p.importe_total).toBe(total);
      const m = metricaPresupuesto({
        id: p.id,
        cliente_nombre: p.cliente_nombre,
        fecha: p.fecha,
        importe_total: p.importe_total,
        presupuesto_generado: p.presupuesto_generado,
      });
      expect(m.base).toBe(base);
      expect(m.conIva).toBe(total);
    }
  });

  it('numero_presupuesto es correlativo y las fechas están entre -45 y -2 días', () => {
    const numeros = presupuestos.map((p) => p.numero_presupuesto).sort((a, b) => Number(a) - Number(b));
    expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const p of presupuestos) {
      expect(p.fecha! >= demoFecha(-45, NOW)).toBe(true);
      expect(p.fecha! <= demoFecha(-2, NOW)).toBe(true);
    }
  });

  it('estados esperados', () => {
    const estado = (id: string) => presupuestos.find((p) => p.id === id)?.estado;
    expect(estado('demo-presupuesto-1')).toBe('aceptado');
    expect(estado('demo-presupuesto-2')).toBe('pendiente');
    expect(estado('demo-presupuesto-3')).toBe('facturado');
    expect(estado('demo-presupuesto-5')).toBe('pendiente');
    expect(estado('demo-presupuesto-8')).toBe('borrador');
    expect(presupuestos.find((p) => p.id === 'demo-presupuesto-8')?.obra_id).toBeNull();
  });

  it('la home elige la obra destacada con un presupuesto accionable', () => {
    const { obras, presupuestos: pres } = getDemoHoy(NOW);
    const hoy = pickHoy(obras, pres);
    expect(hoy.obra?.nombre).toBe('Reforma integral piso Algorta');
    expect(hoy.presupuesto?.id).toBe('demo-presupuesto-2');
    expect(hoy.cta?.label).toBe('Presupuesto de esta obra');
  });
});

describe('demo-data: facturas y albaranes', () => {
  const facturas = getDemoFacturas(NOW);

  it('base + iva = total en cada factura y las líneas suman la base', () => {
    expect(facturas).toHaveLength(6);
    for (const f of facturas) {
      expect(r2(f.base_imponible! + f.iva!)).toBe(f.total);
      expect(r2(f.base_imponible! * 0.21)).toBe(f.iva);
      expect(r2(f.lineas.reduce((s, l) => s + l.importe, 0))).toBe(f.base_imponible);
      expect(f.numero_factura).toMatch(/^F-\d{4}-\d{3}$/);
    }
  });

  it('cifras acordadas y estados', () => {
    const f = (n: number) => facturas.find((x) => x.id === `demo-factura-${n}`)!;
    expect([f(1).base_imponible, f(1).iva, f(1).total, f(1).estado]).toEqual([5900, 1239, 7139, 'pagada']);
    expect([f(2).base_imponible, f(2).iva, f(2).total, f(2).estado]).toEqual([6980, 1465.8, 8445.8, 'pendiente']);
    expect([f(3).base_imponible, f(3).iva, f(3).total, f(3).estado]).toEqual([9940, 2087.4, 12027.4, 'pagada']);
    expect([f(4).base_imponible, f(4).iva, f(4).total, f(4).estado]).toEqual([4970, 1043.7, 6013.7, 'pendiente']);
    expect([f(5).base_imponible, f(5).iva, f(5).total, f(5).estado]).toEqual([3426, 719.46, 4145.46, 'vencida']);
    expect([f(6).base_imponible, f(6).iva, f(6).total, f(6).estado]).toEqual([4590, 963.9, 5553.9, 'pendiente']);
    expect(f(1).fecha).toBe(demoFecha(-18, NOW));
    expect(f(2).fecha_vencimiento).toBe(demoFecha(10, NOW));
    expect(f(4).fecha_vencimiento).toBe(demoFecha(5, NOW));
    expect(f(5).fecha_vencimiento).toBe(demoFecha(-4, NOW));
    expect(f(6).fecha_vencimiento).toBe(demoFecha(15, NOW));
  });

  it('albaranes: 4, totales = suma de líneas y los tres estados', () => {
    const albaranes = getDemoAlbaranes(NOW);
    expect(albaranes).toHaveLength(4);
    for (const a of albaranes) {
      expect(r2(a.lineas.reduce((s, l) => s + l.importe, 0))).toBe(a.total);
      for (const l of a.lineas) expect(r2(l.cantidad * l.precio)).toBe(l.importe);
    }
    expect(new Set(albaranes.map((a) => a.estado))).toEqual(new Set(['pendiente', 'entregado', 'facturado']));
    const porObra = (id: string) => albaranes.filter((a) => a.obra_id === id).length;
    expect([porObra('demo-obra-1'), porObra('demo-obra-2'), porObra('demo-obra-3')]).toEqual([2, 1, 1]);
  });
});

describe('demo-data: gastos', () => {
  const resumen = getDemoResumenGastos(MES, NOW);

  it('filas y totales cuadran', () => {
    const filas = resumen.por_obra.flatMap((o) => o.gastos);
    expect(filas.length).toBeGreaterThan(0);
    for (const g of filas) {
      expect(r2(g.importe + g.iva)).toBe(g.importe_total);
      expect(r2(g.importe * 0.21)).toBe(g.iva);
      expect(g.fecha.startsWith(MES)).toBe(true);
      expect(GASTO_CATEGORIAS).toContain(g.categoria);
    }
    for (const o of resumen.por_obra) {
      expect(r2(o.gastos.reduce((s, g) => s + g.importe_total, 0))).toBe(o.subtotal);
    }
    expect(r2(resumen.por_obra.reduce((s, o) => s + o.subtotal, 0))).toBe(resumen.total_mes);
    expect(r2(resumen.por_categoria.reduce((s, c) => s + c.total, 0))).toBe(resumen.total_mes);
    expect(resumen.por_categoria.map((c) => c.categoria)).toEqual([...GASTO_CATEGORIAS]);
  });

  it('un mes futuro no inventa gastos y nunca hay fechas posteriores a hoy', () => {
    expect(getDemoResumenGastos('2025-11', NOW).total_mes).toBe(0);
    const inicio = getDemoResumenGastos(MES, new Date('2025-10-02T10:00:00Z'));
    for (const g of inicio.por_obra.flatMap((o) => o.gastos)) expect(g.fecha <= '2025-10-02').toBe(true);
  });
});

describe('demo-data: operarios y partes de horas', () => {
  const resumen = getDemoResumenOperarios(MES, NOW);

  it('hay 4 operarios, un DNI y los totales son la suma', () => {
    expect(resumen.operarios.map((o) => o.nombre)).toEqual(['Unai G.', 'Ane M.', 'Xabier L.', 'Mikel A.']);
    expect(resumen.operarios.filter((o) => o.dni)).toHaveLength(1);
    expect(resumen.operarios.find((o) => o.dni)?.dni).toBe('00000001R');
    expect(r2(resumen.operarios.reduce((s, o) => s + o.horas_reales_mes, 0))).toBe(resumen.totales.horas_reales);
    expect(r2(resumen.operarios.reduce((s, o) => s + o.horas_convenio_mes, 0))).toBe(resumen.totales.horas_convenio);
  });

  it('por_obra y por_dia cuadran, de lunes a viernes, 6-8 h reales y 8 h de convenio', () => {
    for (const op of resumen.operarios) {
      expect(r2(op.por_obra.reduce((s, o) => s + o.horas_reales, 0))).toBe(op.horas_reales_mes);
      expect(r2(op.por_obra.reduce((s, o) => s + o.horas_convenio, 0))).toBe(op.horas_convenio_mes);
      for (const o of op.por_obra) {
        expect(r2(o.por_dia.reduce((s, d) => s + d.horas_reales, 0))).toBe(o.horas_reales);
        expect(r2(o.por_dia.reduce((s, d) => s + d.horas_convenio, 0))).toBe(o.horas_convenio);
        for (const d of o.por_dia) {
          const dow = new Date(`${d.fecha}T12:00:00Z`).getUTCDay();
          expect(dow).toBeGreaterThanOrEqual(1);
          expect(dow).toBeLessThanOrEqual(5);
          expect(d.horas_reales).toBeGreaterThanOrEqual(6);
          expect(d.horas_reales).toBeLessThanOrEqual(8);
          expect(d.horas_convenio).toBe(8);
          expect(d.fecha <= HOY).toBe(true);
        }
      }
    }
  });

  it('las horas de una obra solo caen en su periodo de ejecución', () => {
    const obras = getDemoObras(NOW);
    for (const op of resumen.operarios) {
      for (const o of op.por_obra) {
        const obra = obras.find((x) => x.id === o.obra_id)!;
        for (const d of o.por_dia) {
          if (o.obra_id === 'demo-obra-1') continue; // obra de reserva y de larga duración
          expect(d.fecha >= obra.fecha_inicio!).toBe(true);
          expect(d.fecha <= obra.fecha_fin!).toBe(true);
        }
      }
    }
  });
});

describe('demo-data: diario', () => {
  it('8-10 entradas en O1-O4 con las fotos acordadas y agrupadas por obra', () => {
    const diario = getDemoDiario(NOW);
    expect(diario.length).toBeGreaterThanOrEqual(8);
    expect(diario.length).toBeLessThanOrEqual(10);
    for (const e of diario) {
      expect(['demo-obra-1', 'demo-obra-2', 'demo-obra-3', 'demo-obra-4']).toContain(e.obra_id);
      expect(e.fecha >= `${demoFecha(-20, NOW)}T00:00:00`).toBe(true);
      expect(e.fecha <= `${demoFecha(0, NOW)}T23:59:59`).toBe(true);
    }
    const agrupado = getDemoDiarioAgrupado(NOW);
    expect(Object.keys(agrupado)).toEqual(
      expect.arrayContaining([
        'Reforma integral piso Algorta',
        'Reforma baño Deusto',
        'Cocina Barakaldo',
        'Adecuación local cafetería Durango',
      ])
    );
    const fotoDe = (obraId: string) =>
      diario.filter((e) => e.obra_id === obraId).flatMap((e) => (e.fotos ?? []).map((f) => ({ f, fecha: e.fecha })));
    const o1 = fotoDe('demo-obra-1').sort((a, b) => a.fecha.localeCompare(b.fecha));
    expect(o1.map((x) => x.f)).toEqual([
      '/demo/obras/algorta-antes-cocina.jpg',
      '/demo/obras/algorta-durante-instalaciones.jpg',
    ]);
    const o2 = fotoDe('demo-obra-2').sort((a, b) => a.fecha.localeCompare(b.fecha));
    expect(o2.map((x) => x.f)).toEqual([
      '/demo/obras/deusto-bano-durante-alicatado.jpg',
      '/demo/obras/deusto-bano-despues.jpg',
    ]);
    expect(fotoDe('demo-obra-4').map((x) => x.f)).toEqual(['/demo/obras/durango-local-demolicion.jpg']);
  });

  it('todas las fotos empiezan por /demo/obras/', () => {
    const fotos = getDemoDiario(NOW).flatMap((e) => e.fotos ?? []);
    expect(fotos).toHaveLength(5);
    for (const f of fotos) expect(f.startsWith('/demo/obras/')).toBe(true);
  });
});

describe('demo-data: agenda', () => {
  it('hay citas próximas (hoy incluido) y solo cuentan las de hoy en adelante', () => {
    const proximos = getDemoAgendaProximos(NOW);
    expect(proximos.length).toBeGreaterThan(0);
    expect(proximos[0].fecha).toBe(HOY);
    for (const e of proximos) expect(e.fecha >= HOY).toBe(true);
    const mes = getDemoAgendaMes(2025, 9, NOW);
    expect(mes.length).toBeGreaterThanOrEqual(8);
    expect(mes.some((e) => e.fecha < HOY)).toBe(true);
  });
});

describe('demo-data: obras, clientes y referencias', () => {
  const obras = getDemoObras(NOW);
  const clientes = getDemoClientes(NOW);

  it('6 obras con avance y responsable al inicio de la descripción', () => {
    expect(obras).toHaveLength(6);
    expect(obras[0].nombre).toBe('Reforma integral piso Algorta');
    for (const o of obras) expect(o.descripcion).toMatch(/^Avance \d+ % · Responsable: .+ · .+/);
    expect(obras.find((o) => o.id === 'demo-obra-5')?.estado).toBe('pausada');
    expect(obras.find((o) => o.id === 'demo-obra-6')?.estado).toBe('cerrada');
  });

  it('todos los obra_id y cliente_id referencian entidades existentes', () => {
    const obraIds = new Set(obras.map((o) => o.id));
    const clienteIds = new Set(DEMO_CLIENTES.map((c) => c.id));
    for (const o of obras) expect(clienteIds.has(o.cliente_id!)).toBe(true);
    const docs = [...getDemoPresupuestos(NOW), ...getDemoFacturas(NOW), ...getDemoAlbaranes(NOW)];
    for (const d of docs) {
      if (d.obra_id) expect(obraIds.has(d.obra_id)).toBe(true);
      if (d.cliente_id) expect(clienteIds.has(d.cliente_id)).toBe(true);
    }
    for (const e of getDemoDiario(NOW)) expect(obraIds.has(e.obra_id!)).toBe(true);
    for (const o of getDemoResumenGastos(MES, NOW).por_obra) {
      if (o.obra_id) expect(obraIds.has(o.obra_id)).toBe(true);
    }
    for (const op of getDemoResumenOperarios(MES, NOW).operarios) {
      for (const o of op.por_obra) expect(obraIds.has(o.obra_id)).toBe(true);
    }
  });

  it('los contadores de obras y clientes coinciden con los documentos', () => {
    const pres = getDemoPresupuestos(NOW);
    const fac = getDemoFacturas(NOW);
    const alb = getDemoAlbaranes(NOW);
    for (const o of obras) {
      expect(o.num_presupuestos).toBe(pres.filter((p) => p.obra_id === o.id).length);
      expect(o.num_facturas).toBe(fac.filter((f) => f.obra_id === o.id).length);
      expect(o.num_albaranes).toBe(alb.filter((a) => a.obra_id === o.id).length);
    }
    expect(clientes).toHaveLength(8);
    const suma = (k: 'num_presupuestos' | 'num_facturas' | 'num_albaranes') =>
      clientes.reduce((s, c) => s + c[k], 0);
    expect(suma('num_presupuestos')).toBe(8);
    expect(suma('num_facturas')).toBe(6);
    expect(suma('num_albaranes')).toBe(4);
    expect(clientes.find((c) => c.nombre === 'Aitor Elorriaga')?.num_presupuestos).toBe(0);
  });

  it('las fichas de obra y de cliente tienen contenido', () => {
    const ficha = getDemoObraDetalle('demo-obra-1', NOW)!;
    expect(ficha.cliente?.nombre).toBe('Nerea Urrutia');
    expect(ficha.presupuestos).toHaveLength(2);
    expect(ficha.facturas).toHaveLength(2);
    expect(ficha.albaranes).toHaveLength(2);
    expect(ficha.entradas_diario_obra.length).toBeGreaterThan(0);
    expect(ficha.registros_jornada.length).toBeGreaterThan(0);
    expect(getDemoObraDetalle('no-existe', NOW)).toBeNull();
    const cli = getDemoClienteFicha('demo-cliente-1', NOW)!;
    expect(cli.presupuestos).toHaveLength(2);
    expect(cli.facturas).toHaveLength(2);
    expect(getDemoClienteFicha('no-existe', NOW)).toBeNull();
  });
});

describe('demo-data: mensajes', () => {
  it('4 conversaciones pending, ordenadas por prioridad, con respuesta sugerida', () => {
    const m = getDemoMensajes(NOW);
    expect(m).toHaveLength(4);
    expect(m.map((c) => c.priority)).toEqual(['urgent', 'normal', 'normal', 'low']);
    for (const c of m) {
      expect(c.status).toBe('pending');
      expect(['whatsapp', 'email']).toContain(c.channel);
      expect(c.ai_responses?.[0]?.ai_response?.length).toBeGreaterThan(20);
    }
  });
});

describe('demo-data: todo es ficticio', () => {
  it('ningún email fuera de example.com y los teléfonos son ficticios (944 00 00 0x)', () => {
    const blob = JSON.stringify([
      DEMO_EMPRESA,
      DEMO_CLIENTES,
      getDemoPresupuestos(NOW),
      getDemoFacturas(NOW),
      getDemoAlbaranes(NOW),
      getDemoMensajes(NOW),
      getDemoDiario(NOW),
    ]);
    const emails = blob.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) {
      const dominio = e.split('@')[1].toLowerCase();
      expect(dominio === 'example.com' || dominio.endsWith('.example.com')).toBe(true);
    }
    const telefonos = blob.match(/\b\d{3} \d{2} \d{2} \d{2}\b/g) ?? [];
    expect(telefonos.length).toBeGreaterThan(0);
    for (const t of telefonos) expect(t).toMatch(/^944 00 00 0\d$/);
  });
});

/* ---------------- Reglas de pulido, con distintas fechas simuladas ---------------- */

const ESCENARIOS: Array<[string, Date]> = [
  ['15 oct 2025 (mitad de mes)', new Date('2025-10-15T10:00:00Z')],
  ['1 nov 2026 (domingo, mes recién empezado)', new Date('2026-11-01T10:00:00Z')],
  ['3 nov 2026 (martes, mes recién empezado)', new Date('2026-11-03T10:00:00Z')],
  ['1 nov 2026 a las 08:00', new Date('2026-11-01T07:00:00Z')],
  ['3 nov 2026 a las 08:00', new Date('2026-11-03T07:00:00Z')],
  ['10 ene 2027 (cambio de año)', new Date('2027-01-10T10:00:00Z')],
];

describe.each(ESCENARIOS)('demo-data pulido: %s', (_nombre, now) => {
  const hoy = demoHoy(now);
  const mesActual = hoy.slice(0, 7);
  const esFinDeSemana = (iso: string) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

  it('gastos: laborables, no antes del inicio de su obra, no después de hoy y en los últimos 30 días', () => {
    const gastos = construirGastos(now);
    expect(gastos).toHaveLength(12);
    for (const g of gastos) {
      expect(esFinDeSemana(g.fecha)).toBe(false);
      expect(g.fecha <= hoy).toBe(true);
      expect(g.fecha >= demoFecha(-30, now)).toBe(true);
      if (g.obra_id) {
        const obra = DEMO_OBRAS_BASE.find((o) => o.id === g.obra_id)!;
        expect(g.fecha >= demoFecha(obra.inicio, now)).toBe(true);
      }
    }
    // Repartidos: al menos 8 fechas distintas y un rango de 3 semanas o más.
    const fechas = gastos.map((g) => g.fecha).sort();
    expect(new Set(fechas).size).toBeGreaterThanOrEqual(8);
    const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
    expect(dias(fechas[0], fechas[fechas.length - 1])).toBeGreaterThanOrEqual(21);
  });

  it('gastos: la página del mes actual nunca sale vacía y sus totales cuadran', () => {
    const r = getDemoResumenGastos(mesActual, now);
    expect(r.por_obra.flatMap((o) => o.gastos).length).toBeGreaterThan(0);
    expect(r2(r.por_obra.reduce((s, o) => s + o.subtotal, 0))).toBe(r.total_mes);
    expect(r2(r.por_categoria.reduce((s, c) => s + c.total, 0))).toBe(r.total_mes);
  });

  it('operarios: el mes actual no sale vacío y las horas cuadran', () => {
    const r = getDemoResumenOperarios(mesActual, now);
    expect(r.totales.horas_reales).toBeGreaterThan(0);
    for (const op of r.operarios) {
      expect(op.por_obra.length).toBeGreaterThan(0);
      expect(r2(op.por_obra.reduce((s, o) => s + o.horas_reales, 0))).toBe(op.horas_reales_mes);
      for (const o of op.por_obra) {
        for (const d of o.por_dia) {
          expect(esFinDeSemana(d.fecha)).toBe(false);
          expect(d.fecha <= hoy).toBe(true);
        }
      }
    }
    const dias = new Set(r.operarios.flatMap((o) => o.por_obra.flatMap((x) => x.por_dia.map((d) => d.fecha))));
    // Con menos de 10 laborables en el mes se usan los últimos 20; si no, los del mes.
    expect(dias.size).toBeGreaterThanOrEqual(Math.min(10, 20));
  });

  it('facturas y albaranes: numeración correlativa por fecha y año calculado de la fecha', () => {
    for (const docs of [
      getDemoFacturas(now).map((f) => ({ fecha: f.fecha!, numero: f.numero_factura! })),
      getDemoAlbaranes(now).map((a) => ({ fecha: a.fecha!, numero: a.numero_albaran! })),
    ]) {
      const porFecha = [...docs].sort((a, b) => a.fecha.localeCompare(b.fecha));
      let anterior: { anio: string; n: number } | null = null;
      for (const d of porFecha) {
        const m = d.numero.match(/^[A-Z]+-(\d{4})-(\d{3})$/)!;
        expect(m).not.toBeNull();
        expect(m[1]).toBe(d.fecha.slice(0, 4));
        if (anterior && anterior.anio === m[1]) expect(Number(m[2])).toBe(anterior.n + 1);
        anterior = { anio: m[1], n: Number(m[2]) };
      }
      expect(new Set(docs.map((d) => d.numero)).size).toBe(docs.length);
    }
  });

  it('nada en el futuro: diario y mensajes de hoy llevan una hora anterior a la actual', () => {
    const ahora = now.getTime();
    const local = (ts: string) => {
      // Los timestamps del mock son hora de Madrid sin zona; se comparan como tal.
      const madrid = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(ahora));
      return ts.slice(0, 16) <= madrid.replace(' ', 'T');
    };
    for (const e of getDemoDiario(now)) expect(local(e.fecha)).toBe(true);
    for (const m of getDemoMensajes(now)) expect(local(m.created_at)).toBe(true);
    for (const p of [...getDemoPresupuestos(now), ...getDemoFacturas(now), ...getDemoAlbaranes(now)]) {
      expect(local(p.created_at)).toBe(true);
    }
  });
});

describe('demo-data pulido: hoy a las 08:00', () => {
  const now = new Date('2026-11-03T07:00:00Z'); // 08:00 en Madrid

  it('lo de hoy pasa a ayer si «ahora menos 2-3 h» sería demasiado temprano', () => {
    const diarioHoy = getDemoDiario(now).find((e) => e.id === 'demo-diario-4')!;
    expect(diarioHoy.fecha.startsWith('2026-11-02')).toBe(true);
    const mensajeHoy = getDemoMensajes(now).find((m) => m.id === 'demo-conversacion-1')!;
    expect(mensajeHoy.created_at.startsWith('2026-11-03T07:00')).toBe(true);
  });

  it('a media mañana se queda hoy, 2 h antes', () => {
    const tarde = new Date('2026-11-03T12:00:00Z'); // 13:00 en Madrid
    const diarioHoy = getDemoDiario(tarde).find((e) => e.id === 'demo-diario-4')!;
    expect(diarioHoy.fecha).toBe('2026-11-03T11:00:00');
  });
});
