import { executeMcpTool } from '@/lib/mcp/execute-tool';
import {
  createDiarioObraSignedUpload,
  ingestDiarioObraFotos,
} from '@/lib/diario-obra-ingest';
import type { McpContext } from '@/lib/mcp/context';
import { parsePresupuestoGenerado } from '@/lib/pdf/parser';

jest.mock('@/lib/diario-obra-ingest', () => ({
  DIARIO_FOTO_INGEST_MAX_ITEMS: 8,
  ingestDiarioObraFotos: jest.fn(),
  createDiarioObraSignedUpload: jest.fn(),
}));

const ingestMock = ingestDiarioObraFotos as jest.MockedFunction<typeof ingestDiarioObraFotos>;
const signedUploadMock = createDiarioObraSignedUpload as jest.MockedFunction<
  typeof createDiarioObraSignedUpload
>;

const ENTRADA = '11111111-1111-4111-8111-111111111111';

function ctx(): McpContext {
  return {
    businessId: 'biz-1',
    userId: 'user-1',
    supabase: {} as McpContext['supabase'],
  };
}

describe('executeMcpTool — adjuntar_foto_diario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega el lote de URLs en la ingesta compartida', async () => {
    const c = ctx();
    ingestMock.mockResolvedValue({
      ok: true,
      entrada_id: ENTRADA,
      items: [
        {
          url: 'https://cdn.example.com/1.jpg',
          path: 'biz-1/1.jpg',
          signedUrl: 'https://signed/1.jpg',
        },
      ],
      errors: [{ url: 'https://cdn.example.com/2.jpg', error: 'Solo se admiten URLs https.' }],
    });

    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        foto_urls: ['https://cdn.example.com/1.jpg', '  https://cdn.example.com/2.jpg  '],
      },
      c
    );

    expect(ingestMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      entradaId: ENTRADA,
      sources: [
        { type: 'url', url: 'https://cdn.example.com/1.jpg' },
        { type: 'url', url: 'https://cdn.example.com/2.jpg' },
      ],
    });
    expect(result).toMatchObject({ ok: true, entrada_id: ENTRADA, items: [{ path: 'biz-1/1.jpg' }] });
  });

  it('rechaza base64 sin tocar storage ni la ingesta', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        foto_base64: '/9j/4AAQ',
        mime_type: 'image/jpeg',
      },
      ctx()
    );

    expect(result).toEqual({
      error:
        'foto_base64 ya no se admite. Crea una subida firmada con crear_upload_firmado_diario y adjunta storage_paths, o envía foto_urls (1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('exige storage_paths o foto_urls', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      { entrada_diario_id: ENTRADA },
      ctx()
    );
    expect(result).toEqual({
      error:
        'Indica storage_paths (1 a 8 rutas del bucket diario-obra) o, en integraciones, foto_urls (1 a 8 URLs https).',
    });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('adjunta por storage_paths con el businessId del contexto', async () => {
    const c = ctx();
    ingestMock.mockResolvedValue({
      ok: true,
      entrada_id: ENTRADA,
      items: [{ path: 'biz-1/1700_foto.jpg' }],
    });

    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        storage_paths: [' biz-1/1700_foto.jpg ', 'biz-1/1701_foto.jpg'],
      },
      c
    );

    expect(ingestMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      entradaId: ENTRADA,
      sources: [
        { type: 'storage_path', path: 'biz-1/1700_foto.jpg' },
        { type: 'storage_path', path: 'biz-1/1701_foto.jpg' },
      ],
    });
    expect(result).toMatchObject({ ok: true, items: [{ path: 'biz-1/1700_foto.jpg' }] });
  });

  it('no mezcla storage_paths y foto_urls', async () => {
    const result = await executeMcpTool(
      'adjuntar_foto_diario',
      {
        entrada_diario_id: ENTRADA,
        storage_paths: ['biz-1/a.jpg'],
        foto_urls: ['https://cdn.example.com/a.jpg'],
      },
      ctx()
    );
    expect(result).toEqual({ error: 'Indica solo storage_paths o solo foto_urls, no ambos.' });
    expect(ingestMock).not.toHaveBeenCalled();
  });
});

describe('executeMcpTool — crear_upload_firmado_diario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('firma la subida con el businessId del contexto, no con un id del argumento', async () => {
    const c = ctx();
    signedUploadMock.mockResolvedValue({
      upload_url: 'https://upload.example/put?token=tok',
      path: 'biz-1/1700_abcd_fachada.jpg',
      token: 'tok',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      max_bytes: 10 * 1024 * 1024,
    });

    const result = await executeMcpTool(
      'crear_upload_firmado_diario',
      {
        mime_type: 'image/jpeg',
        nombre_archivo: 'fachada.jpg',
        entrada_diario_id: ENTRADA,
        business_id: 'otro-negocio',
      },
      c
    );

    expect(signedUploadMock).toHaveBeenCalledWith(c.supabase, {
      businessId: 'biz-1',
      mimeType: 'image/jpeg',
      fileName: 'fachada.jpg',
      entradaId: ENTRADA,
    });
    expect(result).toMatchObject({
      upload_url: 'https://upload.example/put?token=tok',
      path: expect.stringMatching(/^biz-1\//),
      token: 'tok',
    });
  });
});

type NumeroRow = {
  id: string;
  numero_presupuesto: number | null;
  presupuesto_generado?: unknown;
  cliente_nombre?: unknown;
  importe_total?: unknown;
  estado?: unknown;
  obra_id?: unknown;
};

/**
 * Imita el ORDER BY de Postgres: DESC pone NULL primero salvo que la consulta
 * excluya NULL o pida NULLS LAST. Así el test falla si se vuelve al bug.
 */
function presupuestoSupabase(seed: Array<number | null>) {
  const rows: NumeroRow[] = seed.map((numero, i) => ({
    id: `hist-${i}`,
    numero_presupuesto: numero,
  }));
  let seq = 0;
  let insertAttempts = 0;
  let forceCollision = false;
  let stealNextNumero = false;
  let readError: string | null = null;
  const reads: Array<{ notNull: boolean; nullsFirst: boolean | undefined; ascending: boolean | undefined }> =
    [];

  const supabase = {
    from(table: string) {
      if (table !== 'presupuestos') {
        throw new Error(`tabla inesperada: ${table}`);
      }
      let notNull = false;
      let nullsFirst: boolean | undefined;
      let ascending: boolean | undefined;
      let pending: Record<string, unknown> | null = null;

      const chain = {
        select() {
          return chain;
        },
        insert(row: Record<string, unknown>) {
          pending = row;
          return chain;
        },
        eq() {
          return chain;
        },
        not(column: string, operator: string, value: unknown) {
          if (column === 'numero_presupuesto' && operator === 'is' && value == null) {
            notNull = true;
          }
          return chain;
        },
        order(
          column: string,
          opts?: { ascending?: boolean; nullsFirst?: boolean }
        ) {
          if (column === 'numero_presupuesto') {
            ascending = opts?.ascending;
            nullsFirst = opts?.nullsFirst;
          }
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          reads.push({ notNull, nullsFirst, ascending });
          if (readError) return { data: null, error: { message: readError } };
          const ignoraNull = notNull || nullsFirst === false;
          if (!ignoraNull && rows.some((r) => r.numero_presupuesto == null)) {
            return { data: { numero_presupuesto: null }, error: null };
          }
          const max = rows.reduce<number | null>((acc, row) => {
            if (typeof row.numero_presupuesto !== 'number') return acc;
            return acc == null || row.numero_presupuesto > acc ? row.numero_presupuesto : acc;
          }, null);
          return {
            data: max == null ? null : { numero_presupuesto: max },
            error: null,
          };
        },
        async single() {
          insertAttempts += 1;
          if (!pending || typeof pending.numero_presupuesto !== 'number') {
            return { data: null, error: { message: 'insert inválido' } };
          }
          const numero = pending.numero_presupuesto;
          if (stealNextNumero) {
            stealNextNumero = false;
            rows.push({ id: `race-${seq++}`, numero_presupuesto: numero });
          }
          const colision = forceCollision || rows.some((r) => r.numero_presupuesto === numero);
          if (colision) {
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "presupuestos_business_numero_unique"',
              },
            };
          }
          const id = `new-${seq++}`;
          const stored: NumeroRow = {
            id,
            numero_presupuesto: numero,
            presupuesto_generado: pending.presupuesto_generado,
            cliente_nombre: pending.cliente_nombre,
            importe_total: pending.importe_total,
            estado: pending.estado,
            obra_id: pending.obra_id,
          };
          rows.push(stored);
          return {
            data: {
              id,
              numero_presupuesto: numero,
              cliente_nombre: pending.cliente_nombre,
              importe_total: pending.importe_total,
              estado: pending.estado,
              fecha: pending.fecha,
            },
            error: null,
          };
        },
      };
      return chain;
    },
  };

  return {
    supabase: supabase as unknown as McpContext['supabase'],
    rows,
    reads,
    insertAttempts: () => insertAttempts,
    stealNext() {
      stealNextNumero = true;
    },
    alwaysCollide() {
      forceCollision = true;
    },
    failRead(message: string) {
      readError = message;
    },
  };
}

describe('executeMcpTool — crear_presupuesto', () => {
  const descripcion = 'Pintura salón\n- 2 manos\nTotal acordado en visita';

  function args(extra?: Record<string, unknown>) {
    return {
      cliente_nombre: 'Pino',
      descripcion,
      total: 1500,
      ...extra,
    };
  }

  it('asigna el siguiente correlativo aunque haya números NULL y repite la llamada', async () => {
    const db = presupuestoSupabase([null, null, 1, null]);
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const primero = await executeMcpTool('crear_presupuesto', args(), c);
    const segundo = await executeMcpTool(
      'crear_presupuesto',
      args({ cliente_nombre: 'Ana', total: 800, descripcion: 'Segundo tal cual' }),
      c
    );

    expect(primero).toMatchObject({
      ok: true,
      presupuesto: { numero_presupuesto: 2, cliente_nombre: 'Pino', importe_total: 1500, estado: 'borrador' },
    });
    expect(segundo).toMatchObject({
      ok: true,
      presupuesto: { numero_presupuesto: 3, cliente_nombre: 'Ana', importe_total: 800 },
    });
    expect(db.rows.find((r) => r.numero_presupuesto === 2)?.presupuesto_generado).toBe(descripcion);
    expect(db.rows.find((r) => r.numero_presupuesto === 3)?.presupuesto_generado).toBe('Segundo tal cual');
    expect(db.reads.every((r) => r.notNull && r.nullsFirst === false && r.ascending === false)).toBe(true);
  });

  it('empieza en 1 cuando todos los históricos tienen número NULL', async () => {
    const db = presupuestoSupabase([null, null]);
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('crear_presupuesto', args(), c);

    expect(result).toMatchObject({ ok: true, presupuesto: { numero_presupuesto: 1 } });
  });

  it('reintenta una vez tras una colisión única y usa el máximo recién leído', async () => {
    const db = presupuestoSupabase([null, 4]);
    db.stealNext();
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('crear_presupuesto', args(), c);

    expect(result).toMatchObject({ ok: true, presupuesto: { numero_presupuesto: 6 } });
    expect(db.insertAttempts()).toBe(2);
    expect(db.rows.map((r) => r.numero_presupuesto).filter((n) => n != null).sort()).toEqual([4, 5, 6]);
  });

  it('no se queda en bucle si la colisión persiste', async () => {
    const db = presupuestoSupabase([1]);
    db.alwaysCollide();
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('crear_presupuesto', args(), c);

    expect(result).toEqual({
      error: 'Colisión al generar número de presupuesto. Inténtalo de nuevo.',
    });
    expect(db.insertAttempts()).toBe(2);
  });

  it('devuelve el error de lectura sin insertar', async () => {
    const db = presupuestoSupabase([1]);
    db.failRead('timeout');
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('crear_presupuesto', args(), c);

    expect(result).toEqual({ error: 'timeout' });
    expect(db.insertAttempts()).toBe(0);
  });
});

// --- Fake de Supabase para previsualizar_presupuesto / confirmar_presupuesto ---
// Soporta las tablas 'presupuestos', 'presupuesto_previews' y 'obras' con el
// mismo estilo encadenable que presupuestoSupabase, pero en memoria compartida
// entre llamadas (varios `from()` sobre las mismas filas).

type PreviewRow = {
  id: string;
  business_id: string;
  creado_por: string | null;
  cliente_nombre: string;
  obra_id: string | null;
  iva_porcentaje: number;
  partidas: unknown;
  texto_canonico: string;
  base_imponible: number | null;
  iva_importe: number | null;
  total: number;
  avisos: unknown;
  observaciones: string | null;
  estado: string;
  presupuesto_id: string | null;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
};

type PresRow = {
  id: string;
  business_id: string;
  numero_presupuesto: number | null;
  cliente_nombre?: unknown;
  presupuesto_generado?: unknown;
  importe_total?: unknown;
  estado?: unknown;
  fecha?: unknown;
  obra_id?: unknown;
};

type ObraRow = { id: string; business_id: string };

function previewFakeSupabase(opts?: { obras?: ObraRow[] }) {
  const previews: PreviewRow[] = [];
  const presupuestos: PresRow[] = [];
  const obras: ObraRow[] = opts?.obras ?? [];
  const fromCalls: string[] = [];
  let seq = 0;

  function matches(row: Record<string, unknown>, filters: Array<[string, unknown]>): boolean {
    return filters.every(([k, v]) => row[k] === v);
  }

  const supabase = {
    from(table: string) {
      fromCalls.push(table);
      const filters: Array<[string, unknown]> = [];
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      let isNumeroRead = false;

      const chain = {
        select() {
          return chain;
        },
        insert(row: Record<string, unknown>) {
          pendingInsert = row;
          return chain;
        },
        update(row: Record<string, unknown>) {
          pendingUpdate = row;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return chain;
        },
        not(col: string) {
          if (col === 'numero_presupuesto') isNumeroRead = true;
          return chain;
        },
        order() {
          isNumeroRead = true;
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          if (table === 'presupuestos') {
            if (isNumeroRead) {
              const rows = presupuestos.filter(
                (r) => matches(r, filters) && r.numero_presupuesto != null
              );
              const max = rows.reduce<number | null>(
                (acc, r) =>
                  typeof r.numero_presupuesto === 'number' && (acc == null || r.numero_presupuesto > acc)
                    ? r.numero_presupuesto
                    : acc,
                null
              );
              return { data: max == null ? null : { numero_presupuesto: max }, error: null };
            }
            const row = presupuestos.find((r) => matches(r, filters));
            return { data: row ?? null, error: null };
          }
          if (table === 'presupuesto_previews') {
            if (pendingUpdate) {
              const idx = previews.findIndex((r) => matches(r as unknown as Record<string, unknown>, filters));
              if (idx === -1) return { data: null, error: null };
              previews[idx] = { ...previews[idx], ...pendingUpdate } as PreviewRow;
              return { data: { id: previews[idx].id }, error: null };
            }
            const row = previews.find((r) => matches(r as unknown as Record<string, unknown>, filters));
            return { data: row ?? null, error: null };
          }
          if (table === 'obras') {
            const row = obras.find((r) => matches(r as unknown as Record<string, unknown>, filters));
            return { data: row ?? null, error: null };
          }
          throw new Error(`tabla inesperada: ${table}`);
        },
        async single() {
          if (table === 'presupuestos') {
            const id = `pres-${seq++}`;
            const numero = pendingInsert!.numero_presupuesto as number;
            const stored: PresRow = {
              id,
              business_id: pendingInsert!.business_id as string,
              numero_presupuesto: numero,
              cliente_nombre: pendingInsert!.cliente_nombre,
              presupuesto_generado: pendingInsert!.presupuesto_generado,
              importe_total: pendingInsert!.importe_total,
              estado: pendingInsert!.estado,
              fecha: pendingInsert!.fecha,
              obra_id: pendingInsert!.obra_id ?? null,
            };
            presupuestos.push(stored);
            return {
              data: {
                id,
                numero_presupuesto: numero,
                cliente_nombre: stored.cliente_nombre,
                importe_total: stored.importe_total,
                estado: stored.estado,
                fecha: stored.fecha,
              },
              error: null,
            };
          }
          if (table === 'presupuesto_previews') {
            const id = `prev-${seq++}`;
            const stored: PreviewRow = {
              id,
              business_id: pendingInsert!.business_id as string,
              creado_por: (pendingInsert!.creado_por as string) ?? null,
              cliente_nombre: pendingInsert!.cliente_nombre as string,
              obra_id: (pendingInsert!.obra_id as string | null) ?? null,
              iva_porcentaje: pendingInsert!.iva_porcentaje as number,
              partidas: pendingInsert!.partidas,
              texto_canonico: pendingInsert!.texto_canonico as string,
              base_imponible: (pendingInsert!.base_imponible as number | null) ?? null,
              iva_importe: (pendingInsert!.iva_importe as number | null) ?? null,
              total: pendingInsert!.total as number,
              avisos: pendingInsert!.avisos,
              observaciones: (pendingInsert!.observaciones as string | null) ?? null,
              estado: (pendingInsert!.estado as string) ?? 'pendiente',
              presupuesto_id: null,
              expires_at: pendingInsert!.expires_at as string,
              created_at: pendingInsert!.created_at as string,
              confirmed_at: null,
            };
            previews.push(stored);
            return { data: { id: stored.id, expires_at: stored.expires_at }, error: null };
          }
          throw new Error(`tabla inesperada para single(): ${table}`);
        },
      };
      return chain;
    },
  };

  return {
    supabase: supabase as unknown as McpContext['supabase'],
    previews,
    presupuestos,
    obras,
    fromCalls,
  };
}

function capitulosPreviewBasico() {
  return [
    {
      nombre: 'Cocina',
      partidas: [
        { descripcion: 'Alicatado', cantidad: 20, precio_unitario: 35 },
        { descripcion: 'Grifería', cantidad: 1, precio_unitario: 120 },
      ],
    },
  ];
}

describe('executeMcpTool — previsualizar_presupuesto', () => {
  it('no toca presupuestos e inserta la previsualización con el business_id del contexto', async () => {
    const db = previewFakeSupabase();
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool(
      'previsualizar_presupuesto',
      { cliente_nombre: 'Pino', capitulos: capitulosPreviewBasico() },
      c
    );

    expect(db.fromCalls).not.toContain('presupuestos');
    expect(result).toMatchObject({ ok: true, confirmable: true });
    const r = result as { preview_id: string; expires_at: string };
    expect(r.preview_id).toBeTruthy();
    expect(r.expires_at).toBeTruthy();
    expect(db.previews).toHaveLength(1);
    expect(db.previews[0].business_id).toBe('biz-1');
    expect(db.previews[0].id).toBe(r.preview_id);
  });
});

describe('executeMcpTool — confirmar_presupuesto', () => {
  async function previsualizarYObtenerId(db: ReturnType<typeof previewFakeSupabase>, businessId = 'biz-1') {
    const c: McpContext = { businessId, userId: 'user-1', supabase: db.supabase };
    const result = (await executeMcpTool(
      'previsualizar_presupuesto',
      { cliente_nombre: 'Pino', capitulos: capitulosPreviewBasico() },
      c
    )) as { ok: true; preview_id: string; base_imponible: number; iva_importe: number; total: number };
    return { result, previewId: result.preview_id };
  }

  it('crea el presupuesto con número correlativo y el texto guardado es releíble', async () => {
    const db = previewFakeSupabase();
    const { result: preview, previewId } = await previsualizarYObtenerId(db);
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const confirmado = await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, c);

    expect(confirmado).toMatchObject({ ok: true });
    const conf = confirmado as { ok: true; presupuesto_id: string; numero_presupuesto: number };
    expect(typeof conf.numero_presupuesto).toBe('number');

    const guardado = db.presupuestos.find((p) => p.id === conf.presupuesto_id);
    expect(guardado).toBeDefined();
    const parseado = parsePresupuestoGenerado(String(guardado?.presupuesto_generado ?? ''));
    expect(parseado.baseImponible).toBe(preview.base_imponible);
    expect(parseado.importeIva).toBe(preview.iva_importe);
    expect(parseado.total).toBe(preview.total);
    const todasPartidas = parseado.capitulos.flatMap((cap) => cap.partidas);
    expect(todasPartidas).toHaveLength(2);
  });

  it('confirmar dos veces devuelve el mismo presupuesto y solo hay un insert', async () => {
    const db = previewFakeSupabase();
    const { previewId } = await previsualizarYObtenerId(db);
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const primera = (await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, c)) as {
      presupuesto_id: string;
      numero_presupuesto: number;
    };
    const segunda = (await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, c)) as {
      presupuesto_id: string;
      numero_presupuesto: number;
    };

    expect(segunda.presupuesto_id).toBe(primera.presupuesto_id);
    expect(segunda.numero_presupuesto).toBe(primera.numero_presupuesto);
    expect(db.presupuestos).toHaveLength(1);
  });

  it('devuelve preview_caducada si expires_at ya pasó, sin crear presupuesto', async () => {
    const db = previewFakeSupabase();
    const { previewId } = await previsualizarYObtenerId(db);
    db.previews[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, c);

    expect(result).toMatchObject({ ok: false, code: 'preview_caducada' });
    expect(db.presupuestos).toHaveLength(0);
  });

  it('devuelve preview_ajena si la previsualización es de otro negocio', async () => {
    const db = previewFakeSupabase();
    const { previewId } = await previsualizarYObtenerId(db, 'biz-1');
    const otro: McpContext = { businessId: 'biz-2', userId: 'user-2', supabase: db.supabase };

    const result = await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, otro);

    expect(result).toMatchObject({ ok: false, code: 'preview_ajena' });
    expect(db.presupuestos).toHaveLength(0);
  });

  it('devuelve no_encontrado si el preview_id no existe', async () => {
    const db = previewFakeSupabase();
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('confirmar_presupuesto', { preview_id: 'no-existe' }, c);

    expect(result).toMatchObject({ ok: false, code: 'no_encontrado' });
  });

  it('devuelve en_curso si otra confirmación ya reclamó la previsualización', async () => {
    const db = previewFakeSupabase();
    const { previewId } = await previsualizarYObtenerId(db);
    // Simula que otra llamada concurrente ya movió la fila a 'confirmando'
    // antes del reclamo atómico de esta llamada.
    db.previews[0].estado = 'confirmando';
    const c: McpContext = { businessId: 'biz-1', userId: 'user-1', supabase: db.supabase };

    const result = await executeMcpTool('confirmar_presupuesto', { preview_id: previewId }, c);

    expect(result).toMatchObject({ ok: false, code: 'en_curso' });
    expect(db.presupuestos).toHaveLength(0);
  });
});
