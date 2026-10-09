/**
 * Eval con el modelo REAL (no entra en `npm test` ni en CI):
 *
 *   OPENAI_API_KEY=sk-... npm run eval:jev-real
 *
 * Pasa TODAS las frases de `evals/frases-pino.ts` y las de la ronda 6 (`evals/ronda6.ts`) por el traductor .jev real
 * (GPT-4o mini, el mismo prompt y el mismo esquema `strict` que producción) y compara la orden con la esperada
 * (`evals/ordenes-jev.ts`). Después pasa cada orden por el motor sobre la base SIMULADA (nunca la real) y exige:
 *   - (el % de órdenes correctas, `EVAL_UMBRAL`=0,95, solo se muestra como aviso),
 *   - 0 datos inventados (importes, nombres que no están en el mensaje),
 *   - 0 escrituras antes del «Sí, hazlo».
 * Además corre el BLOQUE DE PARÁFRASIS (`evals/parafrasis.ts`, ≥ 60 escenarios dichos de otra forma) con el clasificador de
 * intención REAL y saca su porcentaje APARTE. El test falla SOLO por las métricas duras (escrituras incorrectas, órdenes perdidas sin
 * aviso, datos inventados, escrituras sin «Sí»); el % total y el de paráfrasis se muestran pero no hacen fallar.
 * Sin OPENAI_API_KEY se salta con un aviso. `EVAL_VECES=3` repite cada frase (el modelo no es 100 % determinista).
 */
import type { SalidaMotor } from '@/lib/jev/motor';
import { CASOS_FRASES_PINO } from './frases-pino';
import { ORDEN_POR_FRASE } from './ordenes-jev';
import { FRASES_RONDA6 } from './ronda6';
import { compararOrden } from './comparar-orden';
import { ESCENARIOS_RONDA8, ejecutarEscenario, escriturasIncorrectas, ordenesPerdidas, ordenPerdidaSinAviso } from './ronda8';
import { PARAFRASIS_R9 } from './parafrasis';
import { NEGOCIO_A, USUARIO, crearBaseSimulada } from './base-simulada';
import { crearFakeDb } from '../__tests__/helpers/fake-db';

const hayClave = Boolean(process.env.OPENAI_API_KEY?.trim());
const umbral = Number(process.env.EVAL_UMBRAL ?? '0.95');
const veces = Math.max(1, Number(process.env.EVAL_VECES ?? '1'));
/** Dos llamadas al modelo por frase y `EVAL_VECES` pasadas: 30 min sobran (el timeout general de jest.eval.config.js es de 2). */
const TIMEOUT_MS = 30 * 60 * 1000;

type Frase = { frase: string; categoria: string; esperada: Record<string, unknown>; historial: Array<{ role: 'user' | 'assistant'; content: string }> };

function frases(): Frase[] {
  const out: Frase[] = [];
  for (const c of CASOS_FRASES_PINO) {
    const conf = ORDEN_POR_FRASE[c.frase];
    if (c.frase === 'Sí' || !conf) continue;
    out.push({ frase: c.frase, categoria: c.intencionJev ?? 'general', esperada: conf.orden, historial: conf.historial ?? [] });
  }
  for (const c of FRASES_RONDA6) out.push({ frase: c.frase, categoria: c.categoria, esperada: c.orden, historial: [] });
  return out;
}

const MARCA = /<!--presupuesto:(\{.*?\})-->/;
const MARCA_F = /<!--factura:(\{.*?\})-->/;

(hayClave ? describe : describe.skip)('traductor .jev REAL (GPT-4o mini)', () => {
  it('cero escrituras incorrectas, cero órdenes perdidas sin aviso, cero datos inventados y cero escrituras sin «Sí» (los porcentajes se muestran aparte)', async () => {
    const { traducirMensaje } = await import('@/lib/jev/traductor');
    const { completarOrden } = await import('@/lib/jev/ordenes');
    const { procesarMensajeJev } = await import('@/lib/jev/motor');
    const { crearRunToolJev } = await import('@/lib/jev/despacho');

    const lista = frases();
    const filas: Array<{ frase: string; ok: boolean; motivos: string[]; inventados: string[]; escrituras: number; parafrasis?: boolean }> = [];
    // MÉTRICAS QUE MANDAN (el % total es secundario): guardar algo distinto de lo pedido o perder una orden sin avisar es un fallo duro.
    const escriturasMal: string[] = [];
    const perdidasSinAviso: string[] = [];
    const perdidasConAviso: string[] = [];
    for (let v = 0; v < veces; v++) {
      for (const f of lista) {
        const db = crearFakeDb(crearBaseSimulada());
        const ultimoAsistente = [...f.historial].reverse().find((h) => h.role === 'assistant')?.content;
        const runTool = crearRunToolJev({ supabase: db.client, businessId: NEGOCIO_A, userId: USUARIO });
        // Los PDF no se generan en el eval (@react-pdf/renderer es ESM y los mocks de jest se pierden entre pasadas):
        // la tool de PDF se simula aquí, justo donde el servidor la llamaría con el id ya resuelto.
        const runToolEval: typeof runTool = async (tool, args) => (/pdf/.test(tool) ? { ok: true, mensaje: `[PDF simulado: ${tool}]` } : runTool(tool, args));
        let cruda: unknown = null;
        let salida: SalidaMotor | null = null;
        let error = '';
        try {
          salida = await procesarMensajeJev({
            supabase: db.client,
            businessId: NEGOCIO_A,
            userId: USUARIO,
            mensaje: f.frase,
            categoria: f.categoria,
            hoyTexto: 'martes, 6 de octubre de 2026',
            ahora: new Date('2026-10-06T10:00:00Z'),
            ultimoAsistente,
            ultimoPresupuestoId: (() => { try { return (JSON.parse(ultimoAsistente?.match(MARCA)?.[1] ?? 'null') as { id?: string } | null)?.id ?? null; } catch { return null; } })(),
            ultimaFacturaId: (() => { try { return (JSON.parse(ultimoAsistente?.match(MARCA_F)?.[1] ?? 'null') as { id?: string } | null)?.id ?? null; } catch { return null; } })(),
            runTool: runToolEval,
            traducir: async (e) => {
              const s = await traducirMensaje(e);
              cruda = s.orden;
              return s;
            },
          });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const veredicto = compararOrden(f.frase, f.esperada, completarOrden(cruda));
        // Si lo esperado es una pregunta («Anota esto», «Factura el albarán»): vale cualquier camino que NO acabe en una
        // acción preparada (orden pendiente) ni escriba nada; lo decide el servidor, no el modelo.
        if (f.esperada.accion === 'ACLARAR' && salida?.accionPendiente) veredicto.motivos.push('esperaba una pregunta y quedó una orden pendiente');
        if (f.esperada.accion === 'ACLARAR') veredicto.motivos = veredicto.motivos.filter((m) => !m.startsWith('esperaba una pregunta y salió'));
        const escrituras = db.inserts.filter((i) => i.tabla !== 'jev_ordenes_pendientes').length + db.updates.filter((u) => u.tabla !== 'jev_ordenes_pendientes').length;
        const motivos = [...veredicto.motivos];
        if (error) motivos.push(`error: ${error}`);
        if (escrituras > 0) motivos.push(`${escrituras} escrituras antes del «Sí»`);
        if (salida && /No te he entendido/.test(salida.respuesta) && f.esperada.accion !== 'ACLARAR') motivos.push('respondió «No te he entendido»');
        filas.push({ frase: f.frase, ok: motivos.length === 0, motivos, inventados: veredicto.inventados, escrituras });
      }
    }

    // Conversaciones de varios turnos (ronda 8): rechazos, correcciones durante la confirmación, varias órdenes en una frase,
    // facturas sueltas, citas por referencia… Cada escenario cuenta como una fila y se juzga por lo MOSTRADO y lo GUARDADO.
    for (let v = 0; v < veces; v++) {
      for (const esc of ESCENARIOS_RONDA8) {
        let problemas: string[];
        try {
          ({ problemas } = await ejecutarEscenario(esc, (e) => traducirMensaje(e)));
        } catch (err) {
          problemas = [`error: ${err instanceof Error ? err.message : String(err)}`];
        }
        filas.push({ frase: `[escenario] ${esc.nombre}`, ok: problemas.length === 0, motivos: problemas, inventados: [], escrituras: 0 });
      }
    }

    // BLOQUE DE PARÁFRASIS: lo mismo dicho de otra forma (cancelar, confirmar, corregir, varias órdenes, respuestas cortas,
    // proveedor frente a cliente, dudas). El clasificador y el traductor son los REALES; su porcentaje sale aparte.
    for (let v = 0; v < veces; v++) {
      for (const esc of PARAFRASIS_R9) {
        let problemas: string[];
        try {
          const r = await ejecutarEscenario(esc, (e) => traducirMensaje(e));
          problemas = r.problemas;
          for (const m of escriturasIncorrectas(esc, r.db)) escriturasMal.push(`${esc.nombre}: ${m}`);
          if (ordenPerdidaSinAviso(esc, r.db, r.respuestas, r.avisos)) perdidasSinAviso.push(`${esc.nombre}: ${ordenesPerdidas(esc, r.db).join(', ')}`);
          else if (ordenesPerdidas(esc, r.db).length) perdidasConAviso.push(`${esc.nombre}: ${ordenesPerdidas(esc, r.db).join(', ')}`);
        } catch (err) {
          problemas = [`error: ${err instanceof Error ? err.message : String(err)}`];
        }
        filas.push({ frase: esc.nombre, ok: problemas.length === 0, motivos: problemas, inventados: [], escrituras: 0, parafrasis: true });
      }
    }

    const buenas = filas.filter((x) => x.ok).length;
    const pct = buenas / filas.length;
    const inventados = filas.filter((x) => x.inventados.length).length;
    const escrituras = filas.reduce((n, x) => n + x.escrituras, 0);
    const tabla = filas.map((x) => `${x.ok ? 'OK ' : 'KO '} ${x.frase}${x.ok ? '' : `\n      → ${x.motivos.join(' | ')}`}`).join('\n');
    const para = filas.filter((x) => x.parafrasis);
    const paraBuenas = para.filter((x) => x.ok).length;
    const paraPct = para.length ? paraBuenas / para.length : 1;
    console.log(
      `\n${tabla}\n\nÓRDENES CORRECTAS (TOTAL): ${buenas}/${filas.length} (${(pct * 100).toFixed(1)} %) · frases con datos inventados: ${inventados} · escrituras sin «Sí»: ${escrituras}` +
        `\nBLOQUE DE PARÁFRASIS: ${paraBuenas}/${para.length} (${(paraPct * 100).toFixed(1)} %)` +
        `\nESCRITURAS INCORRECTAS: ${escriturasMal.length}${escriturasMal.length ? `\n  ${escriturasMal.join('\n  ')}` : ''}` +
        `\nÓRDENES PERDIDAS SIN AVISO: ${perdidasSinAviso.length}${perdidasSinAviso.length ? `\n  ${perdidasSinAviso.join('\n  ')}` : ''}` +
        `\nÓRDENES NO GUARDADAS (con aviso o pregunta): ${perdidasConAviso.length}${perdidasConAviso.length ? `\n  ${perdidasConAviso.join('\n  ')}` : ''}\n`
    );
    expect(escriturasMal).toEqual([]);
    expect(perdidasSinAviso).toEqual([]);
    expect(inventados).toBe(0);
    expect(escrituras).toBe(0);
    // Los porcentajes (total y paráfrasis) se MUESTRAN pero ya no hacen fallar el test: mandan las métricas duras de arriba.
    if (pct < umbral || paraPct < umbral) console.warn(`[eval:jev-real] aviso: por debajo del ${Math.round(umbral * 100)} % (total ${(pct * 100).toFixed(1)} %, paráfrasis ${(paraPct * 100).toFixed(1)} %). No falla el test.`);
  }, TIMEOUT_MS);
});

if (!hayClave) {
  console.warn('\n[eval:jev-real] SALTADO: falta OPENAI_API_KEY. Ejecútalo con: OPENAI_API_KEY=sk-... npm run eval:jev-real\n');
  describe('traductor .jev REAL (sin clave)', () => {
    it.skip('se salta sin OPENAI_API_KEY', () => {});
  });
}
