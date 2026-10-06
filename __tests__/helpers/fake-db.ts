/**
 * Base de datos en memoria con lo que `__tests__/helpers/fake-supabase.ts` no cubre:
 * insert, update, not-null y fallos de insert programables (p. ej. 23505).
 * Sin PostgREST de verdad: solo los métodos que usan crearFacturaDesdePresupuesto y compañía.
 */
export type Fila = Record<string, unknown>;
export type ErrorDb = { code?: string; message: string; details?: string };

export function crearFakeDb(inicial: Record<string, Fila[]> = {}) {
  const tablas: Record<string, Fila[]> = {};
  for (const [n, rows] of Object.entries(inicial)) tablas[n] = rows.map((r) => ({ ...r }));
  /** Errores que se devuelven (uno por insert, en orden) para una tabla antes de insertar de verdad. */
  const erroresInsert: Record<string, ErrorDb[]> = {};
  const inserts: Array<{ tabla: string; fila: Fila }> = [];
  /** Gancho que se ejecuta justo antes de cada insert (para simular otra escritura concurrente). */
  const ganchos: { antesDeInsertar?: (tabla: string) => void } = {};
  const updates: Array<{ tabla: string; valores: Fila; filtros: Array<[string, unknown]> }> = [];
  let contador = 0;

  function from(tabla: string) {
    const filtros: Array<[string, unknown]> = [];
    const notNull: string[] = [];
    const patrones: Array<[string, string]> = [];
    let orden: { col: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let modo: 'select' | 'insert' | 'update' = 'select';
    let valores: Fila = {};
    let cols: string | null = null;

    const filas = () => {
      let rows = (tablas[tabla] ?? []).filter(
        (r) =>
          filtros.every(([c, v]) => r[c] === v) &&
          notNull.every((c) => r[c] != null) &&
          patrones.every(([c, p]) => String(r[c] ?? '').toLowerCase().includes(p))
      );
      if (orden) {
        const { col, asc } = orden;
        rows = [...rows].sort((a, b) => (asc ? 1 : -1) * (Number(a[col]) - Number(b[col])));
      }
      if (limite != null) rows = rows.slice(0, limite);
      return rows;
    };
    const proyectar = (r: Fila) => {
      if (!cols || cols === '*') return r;
      return Object.fromEntries(cols.split(',').map((c) => [c.trim(), r[c.trim()]]));
    };

    const ejecutar = (): { data: Fila[] | null; error: ErrorDb | null } => {
      if (modo === 'insert') {
        ganchos.antesDeInsertar?.(tabla);
        const err = erroresInsert[tabla]?.shift();
        if (err) return { data: null, error: err };
        const fila = { id: `${tabla}-${++contador}`, ...valores };
        (tablas[tabla] ??= []).push(fila);
        inserts.push({ tabla, fila });
        return { data: [proyectar(fila)], error: null };
      }
      if (modo === 'update') {
        const rows = filas();
        rows.forEach((r) => Object.assign(r, valores));
        updates.push({ tabla, valores, filtros: [...filtros] });
        return { data: rows.map(proyectar), error: null };
      }
      return { data: filas().map(proyectar), error: null };
    };

    const chain = {
      select(c?: string) {
        cols = c ?? '*';
        return chain;
      },
      insert(v: Fila) {
        modo = 'insert';
        valores = v;
        return chain;
      },
      update(v: Fila) {
        modo = 'update';
        valores = v;
        return chain;
      },
      eq(c: string, v: unknown) {
        filtros.push([c, v]);
        return chain;
      },
      ilike(c: string, patron: string) {
        patrones.push([c, patron.replace(/%/g, '').toLowerCase()]);
        return chain;
      },
      not(c: string) {
        notNull.push(c);
        return chain;
      },
      order(col: string, o?: { ascending?: boolean }) {
        orden = { col, asc: o?.ascending ?? true };
        return chain;
      },
      limit(n: number) {
        limite = n;
        return chain;
      },
      async maybeSingle() {
        const r = ejecutar();
        return r.error ? { data: null, error: r.error } : { data: r.data?.[0] ?? null, error: null };
      },
      async single() {
        const r = ejecutar();
        if (r.error) return { data: null, error: r.error };
        return r.data?.[0]
          ? { data: r.data[0], error: null }
          : { data: null, error: { message: 'no rows' } };
      },
      then<T>(ok: (v: { data: Fila[] | null; error: ErrorDb | null }) => T, ko?: (e: unknown) => T) {
        return Promise.resolve(ejecutar()).then(ok, ko);
      },
    };
    return chain;
  }

  return {
    client: { from } as never,
    tablas,
    inserts,
    updates,
    erroresInsert,
    ganchos,
  };
}
