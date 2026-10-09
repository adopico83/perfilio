/**
 * Pares de órdenes con un «modelo» que FALLA a propósito (olvida una, copia otra, la repite con otro formato). Pasa por el traductor
 * real (con OpenAI simulado), el motor y las confirmaciones, y comprueba lo que manda:
 *   - nada se pierde sin aviso,
 *   - nada se guarda dos veces,
 *   - solo se escribe lo pedido.
 */
import { crearFakeDb } from './helpers/fake-db';
import { baseRonda5 } from './helpers/jev-sesion';
import { NEGOCIO_A, USUARIO } from '../evals/base-simulada';
import { crearRunToolJev } from '@/lib/jev/despacho';
import { confirmarOrdenJev, procesarMensajeJev } from '@/lib/jev/motor';
import { traducirMensaje } from '@/lib/jev/traductor';
import { escriturasPorTabla } from '../evals/ronda8';

const createMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a: unknown[]) => createMock(...a) } } })),
}));
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

type Tipo = { clave: string; frase: string; orden: Record<string, unknown>; variante: Record<string, unknown>; tabla: string };
const CATALOGO: Tipo[] = [
  { clave: 'GASTO', frase: 'apunta 87,40 con IVA de Saltoki para lo de Leire', tabla: 'gastos',
    orden: { accion: 'GASTO', proveedor_texto: 'Saltoki', importe_texto: '87,40', iva_modo: 'incluido', obra_texto: 'Leire' },
    variante: { accion: 'GASTO', proveedor_texto: 'saltoki', importe_texto: '87.40', iva_modo: 'mas', obra_texto: 'lo de Leire', descripcion_texto: 'material' } },
  { clave: 'HORAS', frase: 'ponle 6 horas a Jon en lo de Paqui', tabla: 'registros_jornada',
    orden: { accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6', obra_texto: 'Paqui' },
    variante: { accion: 'HORAS', operario_texto: 'Jon', horas_texto: '6 horas', obra_texto: 'lo de Paqui' } },
  { clave: 'CITA_CREAR', frase: 'visita con Paqui el viernes a las 10', tabla: 'agenda',
    orden: { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'el viernes', hora_texto: 'a las 10' },
    variante: { accion: 'CITA_CREAR', cliente_texto: 'Paqui', fecha_texto: 'viernes', hora_texto: '10', titulo_texto: 'Visita' } },
  { clave: 'DIARIO', frase: 'anota en el diario de Paqui que se ha picado el baño', tabla: 'diario_obra',
    orden: { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'se ha picado el baño' },
    variante: { accion: 'DIARIO', obra_texto: 'Paqui', texto: 'Se ha picado el baño' } },
];
type Modo = 'bien' | 'copia' | 'olvida';
const NEXOS = [' y de paso ', '; también ', ', ah y '];

/** El «modelo»: ante el mensaje entero falla según `modo`; ante UNA frase suelta acierta. */
function modelo(modo: Modo, a: Tipo, b: Tipo, mensaje: string, nexo: string) {
  const llamada = (name: string, args: unknown) => ({ choices: [{ message: { content: null, tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const usadas = { orden: 0 };
  createMock.mockReset();
  createMock.mockImplementation(async (req: { tool_choice: { function: { name: string } }; messages: Array<{ role: string; content: string }> }) => {
    const nombre = req.tool_choice.function.name;
    const usuario = req.messages.find((m) => m.role === 'user')!.content;
    const sistema = req.messages[0]!.content;
    const entera = usuario === mensaje;
    if (nombre === 'trocear') return llamada('trocear', { trozos: [a.frase, `${nexo.trim()} ${b.frase}`.trim()] });
    if (nombre === 'elegir_accion') {
      const quien = [a, b].find((t) => usuario.includes(t.frase));
      if (!entera) return llamada('elegir_accion', { accion: quien?.clave ?? 'ACLARAR', continua_tarea: null, otras_acciones: null });
      if (modo === 'bien') return llamada('elegir_accion', { accion: a.clave, continua_tarea: null, otras_acciones: [b.clave] });
      if (modo === 'copia') return llamada('elegir_accion', { accion: a.clave, continua_tarea: null, otras_acciones: [a.clave] });
      return llamada('elegir_accion', { accion: a.clave, continua_tarea: null, otras_acciones: null });
    }
    if (nombre === 'orden_jev') {
      const tipo = [a, b].find((t) => new RegExp(`la orden es ${t.clave}\\b`).test(sistema))!;
      const copia = modo === 'copia' && entera && ++usadas.orden > 1;
      const { accion: _a, ...campos } = copia ? tipo.variante : tipo.orden;
      void _a;
      return llamada('orden_jev', campos);
    }
    return { choices: [{ message: { content: 'Hola' } }] };
  });
}

const pares: Array<[string, Tipo, Tipo, Modo, string]> = [];
for (const a of CATALOGO) for (const b of CATALOGO) if (a !== b) for (const modo of ['bien', 'copia', 'olvida'] as Modo[]) pares.push([`${a.clave} + ${b.clave} (${modo})`, a, b, modo, NEXOS[(pares.length) % NEXOS.length]!]);

describe('pares de órdenes con un modelo que falla: nada se pierde, nada se guarda dos veces, solo se escribe lo pedido', () => {
  it.each(pares)('%s', async (_n, a, b, modo, nexo) => {
    process.env.OPENAI_API_KEY = 'k';
    const mensaje = `${a.frase}${nexo}${b.frase}`;
    modelo(modo, a, b, mensaje, nexo);
    const db = crearFakeDb(baseRonda5());
    const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
    const base = { supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO, runTool };
    const avisos: string[] = [];
    let r = await procesarMensajeJev({ ...base, mensaje, categoria: 'general', hoyTexto: 'martes, 6 de octubre de 2026', ahora: new Date('2026-10-06T10:00:00Z'), clasificar: async () => ({ intencion: 'VARIAS', segura: true }), traducir: traducirMensaje });
    avisos.push(...(r.avisos ?? []));
    for (let i = 0; i < 4 && r.accionPendiente; i++) {
      r = await confirmarOrdenJev({ ...base, ordenId: r.accionPendiente.orden_id, ahora: new Date('2026-10-06T10:00:00Z') });
      avisos.push(...(r.avisos ?? []));
    }
    const hechas = escriturasPorTabla(db);
    // 1) solo se escribe lo pedido, y como mucho UNA vez cada cosa
    for (const [t, n] of Object.entries(hechas)) expect([a.tabla, b.tabla]).toContain(t), expect(n).toBeLessThanOrEqual(1);
    // 2) nada se pierde sin aviso: lo pedido está guardado, o se avisó de lo que falta
    const faltan = [a, b].filter((t) => !hechas[t.tabla]);
    if (faltan.length) expect(avisos.length).toBeGreaterThan(0);
    // En este modelo de pruebas, además, la segunda orden SIEMPRE se recupera (la frase suelta se traduce bien).
    expect(faltan.map((t) => t.clave)).toEqual([]);
  });
});
