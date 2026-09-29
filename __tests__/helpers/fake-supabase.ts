import type { McpContext } from '@/lib/mcp/context';

export type FakeRow = Record<string, unknown>;

type Filter =
  | { op: 'eq' | 'gte' | 'lte'; col: string; val: unknown }
  | { op: 'ilike'; col: string; pattern: string };

type Order = { col: string; ascending: boolean };

export type FakeQueryLog = {
  table: string;
  select: string | null;
  filters: Filter[];
  orders: Order[];
  limit: number | null;
};

export type FakeStorageCall =
  | { type: 'upload'; bucket: string; path: string; body: unknown; opts: unknown }
  | { type: 'createSignedUrl'; bucket: string; path: string; expiresIn: number; opts: unknown };

export type FakeSupabaseOptions = {
  /** Contenido inicial de cada tabla. Las filas se copian: el fake no muta las originales. */
  tables?: Record<string, FakeRow[]>;
  /** Error a devolver en toda consulta a la base de datos (`{ data: null, error }`). */
  dbError?: string;
};

export type FakeSupabase = {
  /** Cliente listo para pasar como `ctx.supabase`. */
  client: McpContext['supabase'];
  /** Una entrada por cada `from(...)` ejecutado, con lo que se pidió realmente. */
  queries: FakeQueryLog[];
  /** Llamadas a `storage.from(bucket)`, en orden. */
  storageCalls: FakeStorageCall[];
  /** Hace fallar la próxima(s) subida(s) con este mensaje (`null` para dejar de fallar). */
  failUpload: (message: string | null) => void;
  /** Hace fallar la firma de URLs con este mensaje (`null` para dejar de fallar). */
  failSignedUrl: (message: string | null) => void;
};

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function coincide(row: FakeRow, f: Filter): boolean {
  const valor = row[f.col];
  switch (f.op) {
    case 'eq':
      return valor === f.val;
    case 'gte':
      return valor != null && String(valor) >= String(f.val);
    case 'lte':
      return valor != null && String(valor) <= String(f.val);
    case 'ilike':
      return valor != null && likeToRegExp(f.pattern).test(String(valor));
  }
}

function comparar(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * Supabase en memoria para tests. Aplica de verdad los filtros (`eq`, `gte`, `lte`, `ilike`),
 * el orden y el límite sobre arrays de filas, y ofrece un `storage.from(bucket)` que registra
 * las llamadas y puede forzarse a fallar.
 */
export function createFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const tables: Record<string, FakeRow[]> = {};
  for (const [name, rows] of Object.entries(options.tables ?? {})) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const queries: FakeQueryLog[] = [];
  const storageCalls: FakeStorageCall[] = [];
  let uploadError: string | null = null;
  let signedUrlError: string | null = null;

  function from(table: string) {
    const log: FakeQueryLog = { table, select: null, filters: [], orders: [], limit: null };
    queries.push(log);

    const ejecutar = (): FakeRow[] => {
      let rows = (tables[table] ?? []).filter((row) => log.filters.every((f) => coincide(row, f)));
      for (const o of [...log.orders].reverse()) {
        rows = [...rows].sort((a, b) => (o.ascending ? 1 : -1) * comparar(a[o.col], b[o.col]));
      }
      if (log.limit != null) rows = rows.slice(0, log.limit);
      if (log.select && log.select !== '*') {
        const cols = log.select.split(',').map((c) => c.trim());
        rows = rows.map((row) => Object.fromEntries(cols.map((c) => [c, row[c]])));
      }
      return rows;
    };

    const resultado = () =>
      options.dbError
        ? { data: null, error: { message: options.dbError } }
        : { data: ejecutar(), error: null };

    const chain = {
      select(columns?: string) {
        log.select = columns ?? '*';
        return chain;
      },
      eq(col: string, val: unknown) {
        log.filters.push({ op: 'eq', col, val });
        return chain;
      },
      gte(col: string, val: unknown) {
        log.filters.push({ op: 'gte', col, val });
        return chain;
      },
      lte(col: string, val: unknown) {
        log.filters.push({ op: 'lte', col, val });
        return chain;
      },
      ilike(col: string, pattern: string) {
        log.filters.push({ op: 'ilike', col, pattern });
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        log.orders.push({ col, ascending: opts?.ascending ?? true });
        return chain;
      },
      limit(n: number) {
        log.limit = n;
        return chain;
      },
      async maybeSingle() {
        const r = resultado();
        if (r.error) return { data: null, error: r.error };
        return { data: r.data[0] ?? null, error: null };
      },
      then<T>(
        onFulfilled: (value: ReturnType<typeof resultado>) => T | PromiseLike<T>,
        onRejected?: (reason: unknown) => T | PromiseLike<T>
      ) {
        return Promise.resolve(resultado()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, body: unknown, opts?: unknown) {
          storageCalls.push({ type: 'upload', bucket, path, body, opts });
          if (uploadError) return { data: null, error: { message: uploadError } };
          return { data: { path }, error: null };
        },
        async createSignedUrl(path: string, expiresIn: number, opts?: unknown) {
          storageCalls.push({ type: 'createSignedUrl', bucket, path, expiresIn, opts });
          if (signedUrlError) return { data: null, error: { message: signedUrlError } };
          return {
            data: { signedUrl: `https://storage.test/${bucket}/${path}?token=fake&exp=${expiresIn}` },
            error: null,
          };
        },
      };
    },
  };

  return {
    client: { from, storage } as unknown as McpContext['supabase'],
    queries,
    storageCalls,
    failUpload: (message) => {
      uploadError = message;
    },
    failSignedUrl: (message) => {
      signedUrlError = message;
    },
  };
}
