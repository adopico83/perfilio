import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  crearCitaAgenda,
  listarCitasAgenda,
  parseFechaCita,
  parseHoraCita,
} from '@/lib/mcp/citas';
import type { McpContext } from '@/lib/mcp/context';

const AHORA = new Date('2026-09-23T10:00:00.000Z');

type Fila = {
  id: string;
  business_id: string;
  titulo: string;
  fecha: string;
  hora: string | null;
  completado: boolean;
  description: string | null;
  location: string | null;
  minutos_antelacion: number;
};

function agendaDb(initial: Fila[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  const inserts: Record<string, unknown>[] = [];
  let selectError: string | null = null;

  const supabase = {
    from(table: string) {
      if (table !== 'agenda') throw new Error(`tabla inesperada: ${table}`);
      const filters: Array<{ op: 'eq' | 'gte' | 'lte'; col: string; val: unknown }> = [];
      const orders: Array<{ col: string; ascending: boolean; nullsFirst?: boolean }> = [];
      let pending: Record<string, unknown> | null = null;
      let limitN: number | null = null;

      const coincide = (row: Fila) =>
        filters.every((f) => {
          const valor = row[f.col as keyof Fila];
          if (f.op === 'eq') return valor === f.val;
          if (f.op === 'gte') return String(valor) >= String(f.val);
          return String(valor) <= String(f.val);
        });

      const chain = {
        select() {
          return chain;
        },
        insert(row: Record<string, unknown>) {
          pending = row;
          inserts.push(row);
          return chain;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: 'eq', col, val });
          return chain;
        },
        gte(col: string, val: unknown) {
          filters.push({ op: 'gte', col, val });
          return chain;
        },
        lte(col: string, val: unknown) {
          filters.push({ op: 'lte', col, val });
          return chain;
        },
        order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
          orders.push({ col, ascending: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
          return chain;
        },
        limit(n: number) {
          limitN = n;
          return chain;
        },
        async single() {
          if (selectError && !pending) return { data: null, error: { message: selectError } };
          if (!pending) return { data: null, error: { message: 'sin insert' } };
          const id = `cita-${rows.length + 1}`;
          rows.push({ ...(pending as Omit<Fila, 'id'>), id });
          return {
            data: { id, titulo: pending.titulo, fecha: pending.fecha, hora: pending.hora },
            error: null,
          };
        },
        then(resolve: (value: { data: Fila[] | null; error: { message: string } | null }) => unknown) {
          if (selectError) return Promise.resolve({ data: null, error: { message: selectError } }).then(resolve);
          let matched = rows.filter(coincide);
          matched.sort((a, b) => {
            for (const order of orders) {
              const av = a[order.col as keyof Fila];
              const bv = b[order.col as keyof Fila];
              if (av == null && bv == null) continue;
              if (av == null) return order.nullsFirst === false ? 1 : -1;
              if (bv == null) return order.nullsFirst === false ? -1 : 1;
              if (av === bv) continue;
              const cmp = String(av) < String(bv) ? -1 : 1;
              return order.ascending ? cmp : -cmp;
            }
            return 0;
          });
          if (limitN != null) matched = matched.slice(0, limitN);
          return Promise.resolve({ data: matched, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };

  return {
    supabase: supabase as unknown as McpContext['supabase'],
    rows,
    inserts,
    fallarSelect(message: string) {
      selectError = message;
    },
  };
}

function ctx(db: ReturnType<typeof agendaDb>, businessId = 'biz-1'): McpContext {
  return { businessId, userId: 'user-1', supabase: db.supabase };
}

describe('parseFechaCita / parseHoraCita', () => {
  it('interpreta el dictado en el calendario de Madrid', () => {
    expect(parseFechaCita('2026-09-24', AHORA)).toBe('2026-09-24');
    expect(parseFechaCita('24/09/2026', AHORA)).toBe('2026-09-24');
    expect(parseFechaCita('hoy', AHORA)).toBe('2026-09-23');
    expect(parseFechaCita('mañana', AHORA)).toBe('2026-09-24');
    expect(parseFechaCita('pasado mañana', AHORA)).toBe('2026-09-25');
    expect(parseFechaCita('el viernes', AHORA)).toBe('2026-09-25');
    expect(parseFechaCita('miércoles', AHORA)).toBe('2026-09-23');
    expect(parseFechaCita('lunes', AHORA)).toBe('2026-09-28');
    expect(parseFechaCita('24 de septiembre', AHORA)).toBe('2026-09-24');
    expect(parseFechaCita('24 de septiembre', new Date('2026-10-01T10:00:00.000Z'))).toBe('2027-09-24');
    expect(parseFechaCita('31/02/2026', AHORA)).toBeNull();

    const nocheMadrid = new Date('2026-09-23T22:30:00.000Z');
    expect(parseFechaCita('hoy', nocheMadrid)).toBe('2026-09-24');
  });

  it('pasa las horas habladas a HH:MM sin convertir a UTC', () => {
    expect(parseHoraCita('10:00')).toBe('10:00');
    expect(parseHoraCita('10:00:00')).toBe('10:00');
    expect(parseHoraCita('a las 10')).toBe('10:00');
    expect(parseHoraCita('10 de la mañana')).toBe('10:00');
    expect(parseHoraCita('3 de la tarde')).toBe('15:00');
    expect(parseHoraCita('9 de la noche')).toBe('21:00');
    expect(parseHoraCita('12 de la noche')).toBe('00:00');
    expect(parseHoraCita('mediodía')).toBe('12:00');
    expect(parseHoraCita('10 y media')).toBe('10:30');
    expect(parseHoraCita('10 y cuarto')).toBe('10:15');
    expect(parseHoraCita('25:00')).toBeNull();
  });
});

describe('crearCitaAgenda', () => {
  it('guarda la cita en el negocio de la conexión', async () => {
    const db = agendaDb();
    const result = await crearCitaAgenda(
      ctx(db),
      {
        asunto: 'Cita con Mendi',
        fecha: 'mañana',
        hora_inicio: 'a las 10 de la mañana',
        hora_fin: '11:30',
        lugar: 'Calle Mayor 3',
        notas: 'Llevar el plano',
        business_id: 'otro-negocio',
      },
      AHORA
    );

    expect(result).toMatchObject({
      ok: true,
      id: 'cita-1',
      titulo: 'Cita con Mendi',
      asunto: 'Cita con Mendi',
      fecha: '2026-09-24',
      hora: '10:00',
      hora_fin: '11:30',
      starts_at: '2026-09-24T10:00:00+02:00',
      ends_at: '2026-09-24T11:30:00+02:00',
      duracion_minutos: 90,
      time_zone: 'Europe/Madrid',
      lugar: 'Calle Mayor 3',
      notas: 'Llevar el plano',
      obra_id: null,
      google_calendar_hint: {
        summary: 'Cita con Mendi',
        start: '2026-09-24T10:00:00+02:00',
        end: '2026-09-24T11:30:00+02:00',
        location: 'Calle Mayor 3',
        description: 'Llevar el plano',
        reminder_minutes: 15,
      },
    });
    expect(result).toMatchObject({
      cuando: expect.stringMatching(/24 de septiembre de 2026, de 10:00 a 11:30/),
    });
    expect(db.inserts).toEqual([
      {
        business_id: 'biz-1',
        titulo: 'Cita con Mendi',
        fecha: '2026-09-24',
        hora: '10:00',
        completado: false,
        description: 'Llevar el plano\nHora de fin: 11:30',
        location: 'Calle Mayor 3',
        minutos_antelacion: 0,
      },
    ]);
  });

  it('no inserta si el mismo asunto y la misma hora ya están ese día', async () => {
    const db = agendaDb([
      {
        id: 'ya',
        business_id: 'biz-1',
        titulo: 'Cita con Mendi',
        fecha: '2026-09-24',
        hora: '10:00',
        completado: false,
        description: null,
        location: null,
        minutos_antelacion: 0,
      },
    ]);

    const result = await crearCitaAgenda(
      ctx(db),
      { asunto: 'cita con mendi', fecha: '2026-09-24', hora_inicio: '10:00' },
      AHORA
    );

    expect(result).toMatchObject({
      ok: true,
      duplicado: true,
      id: 'ya',
      titulo: 'Cita con Mendi',
      starts_at: '2026-09-24T10:00:00+02:00',
      ends_at: '2026-09-24T11:00:00+02:00',
      duracion_minutos: 60,
      obra_id: null,
      google_calendar_hint: {
        summary: 'Cita con Mendi',
        start: '2026-09-24T10:00:00+02:00',
        end: '2026-09-24T11:00:00+02:00',
        reminder_minutes: 15,
      },
    });
    expect(db.inserts).toHaveLength(0);
  });

  it('rechaza el solape y propone el hueco más cercano', async () => {
    const db = agendaDb([
      {
        id: 'ocupada',
        business_id: 'biz-1',
        titulo: 'Visita de obra',
        fecha: '2026-09-24',
        hora: '10:00',
        completado: false,
        description: null,
        location: null,
        minutos_antelacion: 0,
      },
      {
        id: 'otro-negocio',
        business_id: 'biz-2',
        titulo: 'Cita ajena',
        fecha: '2026-09-24',
        hora: '11:00',
        completado: false,
        description: null,
        location: null,
        minutos_antelacion: 0,
      },
    ]);

    const ocupada = await crearCitaAgenda(
      ctx(db),
      { asunto: 'Reunión de mediciones', fecha: '2026-09-24', hora_inicio: '10:30' },
      AHORA
    );
    expect(ocupada).toEqual({
      error: 'Esa franja ya está ocupada. El hueco libre más cercano es a las 11:00.',
      solapamiento: true,
      hueco_sugerido: '11:00',
    });
    expect(db.inserts).toHaveLength(0);

    const libre = await crearCitaAgenda(
      ctx(db),
      { asunto: 'Reunión de mediciones', fecha: '2026-09-24', hora_inicio: '11:00' },
      AHORA
    );
    expect(libre).toMatchObject({ ok: true, hora: '11:00' });
    expect(db.inserts[0]?.business_id).toBe('biz-1');
  });

  it('respeta la hora de fin guardada al comprobar el solape', async () => {
    const db = agendaDb([
      {
        id: 'corta',
        business_id: 'biz-1',
        titulo: 'Llamada',
        fecha: '2026-09-24',
        hora: '10:00',
        completado: false,
        description: 'Hora de fin: 10:30',
        location: null,
        minutos_antelacion: 0,
      },
    ]);

    const result = await crearCitaAgenda(
      ctx(db),
      { asunto: 'Visita', fecha: '2026-09-24', hora_inicio: '10:30', hora_fin: '11:00' },
      AHORA
    );
    expect(result).toMatchObject({
      ok: true,
      hora: '10:30',
      hora_fin: '11:00',
      starts_at: '2026-09-24T10:30:00+02:00',
      ends_at: '2026-09-24T11:00:00+02:00',
      duracion_minutos: 30,
    });
  });

  it('usa el desfase de invierno y una hora de fin por defecto de 60 minutos', async () => {
    const db = agendaDb();
    const result = await crearCitaAgenda(
      ctx(db),
      { asunto: 'Visita', fecha: '2026-01-15', hora_inicio: '23:30' },
      AHORA
    );
    expect(result).toMatchObject({
      ok: true,
      hora_fin: null,
      starts_at: '2026-01-15T23:30:00+01:00',
      ends_at: '2026-01-16T00:30:00+01:00',
      duracion_minutos: 60,
      google_calendar_hint: {
        start: '2026-01-15T23:30:00+01:00',
        end: '2026-01-16T00:30:00+01:00',
        location: '',
        description: '',
        reminder_minutes: 15,
      },
    });
  });

  it('exige asunto, fecha y hora de inicio', async () => {
    const db = agendaDb();
    const c = ctx(db);
    expect(await crearCitaAgenda(c, { fecha: 'mañana', hora_inicio: '10:00' }, AHORA)).toEqual({
      error: 'El asunto es obligatorio.',
    });
    expect(await crearCitaAgenda(c, { asunto: 'Cita', hora_inicio: '10:00' }, AHORA)).toEqual({
      error: 'La fecha es obligatoria.',
    });
    expect(await crearCitaAgenda(c, { asunto: 'Cita', fecha: 'mañana' }, AHORA)).toEqual({
      error: 'La hora de inicio es obligatoria.',
    });
    expect(await crearCitaAgenda(c, { asunto: 'Cita', fecha: 'cuando sea', hora_inicio: '10:00' }, AHORA)).toEqual({
      error:
        'La fecha no es válida. Usa AAAA-MM-DD, o un día como hoy, mañana, viernes o 24 de septiembre.',
    });
    expect(
      await crearCitaAgenda(c, { asunto: 'Cita', fecha: 'mañana', hora_inicio: '10:00', hora_fin: '09:00' }, AHORA)
    ).toEqual({ error: 'La hora de fin tiene que ser posterior a la de inicio.' });
    expect(db.inserts).toHaveLength(0);
  });
});

describe('listarCitasAgenda', () => {
  it('devuelve las próximas del negocio, sin completadas ni días pasados', async () => {
    const db = agendaDb([
      fila('pasada', 'biz-1', '2026-09-22', '09:00', false),
      fila('hecha', 'biz-1', '2026-09-24', '09:00', true),
      fila('ajena', 'biz-2', '2026-09-24', '09:00', false),
      fila('tarde', 'biz-1', '2026-09-23', '18:00', false),
      fila('pronto', 'biz-1', '2026-09-23', '08:00', false),
      fila('sin-hora', 'biz-1', '2026-09-23', null, false),
    ]);

    const result = await listarCitasAgenda(ctx(db), {}, AHORA);
    expect(result).toMatchObject({ desde: '2026-09-23', hasta: null });
    if (!('items' in result)) throw new Error('se esperaba un listado');
    expect(result.items.map((item) => item.id)).toEqual(['pronto', 'tarde', 'sin-hora']);
    expect(result.items[0]).toMatchObject({
      titulo: 'pronto',
      hora: '08:00',
      cuando: expect.stringMatching(/23 de septiembre de 2026 a las 08:00/),
    });
  });

  it('acepta desde y hasta en lenguaje natural', async () => {
    const db = agendaDb([
      fila('hoy', 'biz-1', '2026-09-23', '10:00', false),
      fila('manana', 'biz-1', '2026-09-24', '10:00', false),
      fila('viernes', 'biz-1', '2026-09-25', '10:00', false),
    ]);
    const result = await listarCitasAgenda(ctx(db), { desde: 'mañana', hasta: 'mañana' }, AHORA);
    if (!('items' in result)) throw new Error('se esperaba un listado');
    expect(result.items.map((item) => item.id)).toEqual(['manana']);
  });
});

describe('executeMcpTool — citas', () => {
  it('crea y lista por el mismo camino que el resto de tools', async () => {
    const db = agendaDb();
    const c = ctx(db);
    const creada = await executeMcpTool(
      'crear_cita',
      { asunto: 'Revisión del presupuesto', fecha: '2026-09-30', hora_inicio: '09:30', lugar: 'Oficina' },
      c
    );
    expect(creada).toMatchObject({ ok: true, titulo: 'Revisión del presupuesto', hora: '09:30', lugar: 'Oficina' });

    const lista = await executeMcpTool('ver_citas', { desde: '2026-09-30', hasta: '2026-09-30' }, c);
    expect(lista).toMatchObject({
      items: [{ titulo: 'Revisión del presupuesto', lugar: 'Oficina', hora: '09:30' }],
    });
  });
});

function fila(
  id: string,
  businessId: string,
  fecha: string,
  hora: string | null,
  completado: boolean
): Fila {
  return {
    id,
    business_id: businessId,
    titulo: id,
    fecha,
    hora,
    completado,
    description: null,
    location: null,
    minutos_antelacion: 0,
  };
}
