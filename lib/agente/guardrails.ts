export type PlannedTool = { tool: string; args: Record<string, unknown> };

const ESTADOS_BLOQUEO_BORRADO = new Set(['aceptado', 'facturado']);

function normEstado(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return s || null;
}

/** Estado del presupuesto en args (varias convenciones posibles en el plan). */
function extractPresupuestoEstadoFromArgs(args: Record<string, unknown>): string | null {
  const direct = normEstado(args.estado ?? args.estado_presupuesto ?? args.presupuesto_estado ?? args.status);
  if (direct) return direct;
  const nested = args.presupuesto;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const o = nested as Record<string, unknown>;
    return normEstado(o.estado ?? o.estado_presupuesto ?? o.status);
  }
  return null;
}

function isPresupuestoDocumentDeletionTool(name: string): boolean {
  if (!isDestructiveTool(name) || !name.includes('presupuesto')) return false;
  if (name.includes('partida')) return false;
  return true;
}

function isFacturaDesdePresupuestoTool(name: string): boolean {
  if (name === 'convertir_presupuesto_a_factura') return true;
  return name.startsWith('crear_') && name.includes('factura');
}

function validationPrefix(userMessage: string): string {
  const u = userMessage.trim();
  return u ? `${u}\n\n` : '';
}

function validatePresupuestoCriticalRules(
  tool: string,
  args: Record<string, unknown>,
  userMessage: string
): string | null {
  const estado = extractPresupuestoEstadoFromArgs(args);

  if (isPresupuestoDocumentDeletionTool(tool)) {
    if (!estado) {
      return (
        validationPrefix(userMessage) +
        'Requiere validación previa: eliminar o borrar un presupuesto sin conocer su estado no está permitido. ' +
        'Obtén primero el estado del presupuesto (p. ej. listar_presupuestos u otra lectura) y no ejecutes el borrado a ciegas.'
      );
    }
    if (ESTADOS_BLOQUEO_BORRADO.has(estado)) {
      return (
        validationPrefix(userMessage) +
        `No se permite eliminar ni borrar un presupuesto en estado «${estado}». Los presupuestos aceptados o facturados no pueden borrarse por esta vía.`
      );
    }
  }

  if (isFacturaDesdePresupuestoTool(tool)) {
    if (!estado) {
      return (
        validationPrefix(userMessage) +
        'Requiere validación previa: generar o crear factura desde un presupuesto sin conocer su estado no está permitido. ' +
        'Confirma primero que el presupuesto no está ya en estado facturado antes de convertir o crear la factura.'
      );
    }
    if (estado === 'facturado') {
      return (
        validationPrefix(userMessage) +
        'No se permite crear o convertir a factura un presupuesto que ya está en estado «facturado».'
      );
    }
  }

  return null;
}

export function isDestructiveTool(name: string): boolean {
  return name.startsWith('eliminar_') || name.startsWith('borrar_');
}

export function isWriteTool(name: string): boolean {
  return (
    name.startsWith('crear_') ||
    name.startsWith('actualizar_') ||
    name.startsWith('modificar_') ||
    name.startsWith('guardar_') ||
    name.startsWith('registrar_') ||
    name.startsWith('confirmar_') ||
    name.startsWith('convertir_')
  );
}

export function isCommunicationTool(name: string): boolean {
  return name === 'enviar_email' || name === 'enviar_presupuesto' || name === 'enviar_factura';
}

export function isReadTool(name: string): boolean {
  return (
    name.startsWith('listar_') ||
    name.startsWith('ver_') ||
    name.startsWith('buscar_') ||
    name.startsWith('obtener_')
  );
}

/**
 * Orden de ejecución deseada: destructivo → escritura → comunicación → otros → lectura (siempre al final).
 */
export function toolRank(name: string): number {
  if (isDestructiveTool(name)) return 1;
  if (isWriteTool(name)) return 2;
  if (isCommunicationTool(name)) return 3;
  if (isReadTool(name)) return 5;
  return 4;
}

export function isDuplicateLikeError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'number' && err === 23505) return true;
  if (typeof err === 'string') {
    const s = err.toLowerCase();
    return (
      s.includes('23505') ||
      s.includes('already exists') ||
      s.includes('duplicate') ||
      s.includes('ya existe')
    );
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const code = o.code;
    if (code === '23505' || code === 23505) return true;
    const msg = String(o.message ?? o.error ?? o.details ?? '').toLowerCase();
    if (
      msg.includes('23505') ||
      msg.includes('already exists') ||
      msg.includes('duplicate') ||
      msg.includes('ya existe')
    ) {
      return true;
    }
    if (typeof o.error === 'object' && o.error != null) return isDuplicateLikeError(o.error);
  }
  return false;
}

export function normalizeToolResult(name: string, result: unknown): unknown {
  void name;
  if (!isDuplicateLikeError(result)) return result;
  if (result != null && typeof result === 'object' && !Array.isArray(result)) {
    const base = result as Record<string, unknown>;
    return {
      ...base,
      ok: true,
      duplicate_normalized: true,
      mensaje:
        typeof base.mensaje === 'string' && base.mensaje.trim()
          ? base.mensaje
          : 'El registro ya existía; se normaliza como éxito idempotente.',
    };
  }
  return {
    ok: true,
    duplicate_normalized: true,
    mensaje: 'El registro ya existía; se normaliza como éxito idempotente.',
  };
}

function stableArgSignature(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = args[k];
  return JSON.stringify(sorted);
}

export function dedupeBySignature(plan: PlannedTool[]): PlannedTool[] {
  const seen = new Set<string>();
  const out: PlannedTool[] = [];
  for (const step of plan) {
    const sig = `${step.tool}\0${stableArgSignature(step.args)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(step);
  }
  return out;
}

function normFechaRelativaFingerprint(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^el\s+/, '');
}

/**
 * Huella del evento que crear_recordatorio persistiría (misma lógica de título que agenda.ts).
 * Solo aplica a pasos de ejecución (no solo_vista_previa); las vistas previas no se colapsan aquí.
 */
function fingerprintCrearRecordatorioEjecucion(args: Record<string, unknown>): string | null {
  const soloVp =
    args.solo_vista_previa === true || String(args.solo_vista_previa ?? '').toLowerCase() === 'true';
  if (soloVp) return null;

  const rel = String(args.fecha_relativa ?? '').trim();
  let fechaToken = '';
  if (rel) {
    fechaToken = `rel:${normFechaRelativaFingerprint(rel)}`;
  } else {
    const fecha = String(args.fecha ?? '').trim().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
    fechaToken = `ymd:${fecha}`;
  }

  let titulo = String(args.titulo ?? '').trim();
  const tipo = String(args.tipo ?? '').trim();
  const clienteNombre = String(args.cliente ?? args.cliente_nombre ?? '').trim();
  if (!titulo) {
    if (tipo && clienteNombre) titulo = `${tipo} con ${clienteNombre}`;
    else if (tipo) titulo = tipo;
    else if (clienteNombre) titulo = `Cita con ${clienteNombre}`;
  }

  const normTitulo = titulo
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');

  const horaRaw = args.hora != null ? String(args.hora).trim() : '';
  const horaNorm = horaRaw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '');

  return `${fechaToken}\0${horaNorm}\0${normTitulo}`;
}

/** Evita dos inserciones del mismo evento en un único plan cuando los args difieren en campos accesorios. */
function dedupeCrearRecordatorioMismoEvento(plan: PlannedTool[]): PlannedTool[] {
  const seen = new Set<string>();
  const out: PlannedTool[] = [];
  for (const step of plan) {
    if (step.tool !== 'crear_recordatorio') {
      out.push(step);
      continue;
    }
    const fp = fingerprintCrearRecordatorioEjecucion(step.args);
    if (!fp) {
      out.push(step);
      continue;
    }
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(step);
  }
  return out;
}

export type PerfilioGuardrailsResult =
  | { ok: true; plan: PlannedTool[] }
  | { ok: false; error: string };

/**
 * Deduplica, valida reglas de presupuesto/factura, ordena por criticidad y deja como mucho una herramienta de lectura al final.
 */
export function applyPerfilioGuardrails(
  plan: PlannedTool[],
  userMessage: string
): PerfilioGuardrailsResult {
  const deduped = dedupeCrearRecordatorioMismoEvento(dedupeBySignature(plan));

  for (const step of deduped) {
    const err = validatePresupuestoCriticalRules(step.tool, step.args, userMessage);
    if (err) return { ok: false, error: err };
  }

  const withIndex = deduped.map((step, i) => ({ step, i }));
  withIndex.sort((a, b) => {
    const ra = toolRank(a.step.tool);
    const rb = toolRank(b.step.tool);
    if (ra !== rb) return ra - rb;
    return a.i - b.i;
  });

  const ordered = withIndex.map((x) => x.step);
  const nonReads: PlannedTool[] = [];
  const reads: PlannedTool[] = [];
  for (const step of ordered) {
    if (isReadTool(step.tool)) reads.push(step);
    else nonReads.push(step);
  }

  const finalReads = reads.length <= 1 ? reads : [reads[reads.length - 1]];

  return { ok: true, plan: [...nonReads, ...finalReads] };
}
