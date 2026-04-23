import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGastoCategoria } from '@/lib/gastos-categoria';
import {
  mensajeObrasAmbiguas,
  resolverObraDocumentoAgente,
  type Obra,
} from '@/lib/obras-context';

/** Cliente de la obra (JOIN clientes) para heredar en documentos cuando no hay cliente_id explícito. */
async function clienteDesdeObraSiAplica(
  supabase: SupabaseClient,
  businessId: string,
  obraId: string
): Promise<{ cliente_id: string | null; cliente_nombre: string | null }> {
  const { data, error } = await supabase
    .from('obras')
    .select('cliente_id, clientes ( nombre )')
    .eq('id', obraId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error || !data) return { cliente_id: null, cliente_nombre: null };
  const row = data as {
    cliente_id: string | null;
    clientes?: { nombre?: string | null } | null;
  };
  const cid = row.cliente_id ?? null;
  if (!cid) return { cliente_id: null, cliente_nombre: null };
  const cn =
    row.clientes && typeof row.clientes === 'object'
      ? String((row.clientes as { nombre?: string | null }).nombre ?? '').trim() || null
      : null;
  return { cliente_id: cid, cliente_nombre: cn };
}

export const GASTOS_HANDLED_TOOLS = new Set([
  'registrar_gasto_ticket',
  'vincular_gasto',
  'eliminar_gasto',
  'modificar_gasto',
]);

export const GASTOS_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'registrar_gasto_ticket',
      description:
        'Registra un gasto (ticket, voz, OCR). SDD obligatorio como en generar_presupuesto_por_dictado: primero muestra resumen y espera confirmación explícita del usuario; solo entonces guarda. Usa solo_vista_previa true en la primera llamada (sin insertar en BD). Usa solo_vista_previa false u omítelo solo cuando el usuario haya confirmado (sí, adelante, correcto). Infiere o pregunta la categoría del gasto según el concepto (ladrillos, cemento → material; alquiler contenedor → vertido; furgoneta/transporte → transporte; subcontratista → subcontrata; herramienta → herramienta). Si no está claro, usa material. Si detectas devolución/descuento/abono/nota de crédito, usa importes negativos.',
      parameters: {
        type: 'object',
        properties: {
          proveedor: { type: 'string', description: 'Nombre del comercio o proveedor' },
          importe: {
            type: 'number',
            description: 'Importe sin IVA (base imponible)',
          },
          iva: { type: 'number', description: 'Cuantía del IVA en la misma moneda' },
          importe_total: { type: 'number', description: 'Total con IVA' },
          categoria: {
            type: 'string',
            enum: ['material', 'herramienta', 'vertido', 'subcontrata', 'transporte', 'otros'],
            description:
              'Tipo de gasto. Inferir del lenguaje del usuario o del ticket; por defecto material si hay duda.',
          },
          obra_id: {
            type: 'string',
            description: 'UUID de la obra (opcional). Si hay obra activa se rellena automáticamente.',
          },
          obra_nombre: {
            type: 'string',
            description: 'Nombre de la obra a la que vincular el gasto',
          },
          cliente_id: {
            type: 'string',
            description:
              'UUID del cliente si se conoce. Si no se envía y hay obra, se puede heredar de la obra.',
          },
          fecha: {
            type: 'string',
            description: 'Fecha del documento en formato YYYY-MM-DD',
          },
          descripcion: {
            type: 'string',
            description: 'Resumen breve del concepto del gasto (opcional)',
          },
          solo_vista_previa: {
            type: 'boolean',
            description:
              'Si true, solo muestra el resumen sin guardar en BD. Usar true en la primera llamada. Usar false (u omitir) solo tras confirmación explícita del usuario.',
          },
        },
        required: ['proveedor', 'importe', 'iva', 'importe_total', 'fecha'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vincular_gasto',
      description:
        'Enlaza un gasto ya registrado a factura(s) o albarán(es) por UUID.',
      parameters: {
        type: 'object',
        properties: {
          gasto_id: {
            type: 'string',
            description: 'UUID del gasto a vincular',
          },
          documentos: {
            type: 'array',
            description: 'Lista de documentos a los que vincular el gasto',
            items: {
              type: 'object',
              properties: {
                tipo: { type: 'string', enum: ['factura', 'albaran'] },
                id: { type: 'string', description: 'UUID del documento' },
              },
              required: ['tipo', 'id'],
              additionalProperties: false,
            },
          },
        },
        required: ['gasto_id', 'documentos'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eliminar_gasto',
      description:
        'Elimina un gasto (tabla gastos). Busca por proveedor, fecha, obra o descripción. SDD obligatorio: solo_vista_previa true primero; confirmación y solo_vista_previa false con gasto_id.',
      parameters: {
        type: 'object',
        properties: {
          proveedor: { type: 'string', description: 'Nombre o fragmento del proveedor' },
          fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional)' },
          obra_nombre: { type: 'string', description: 'Texto para filtrar por obra vinculada' },
          obra_id: { type: 'string', description: 'UUID de obra' },
          descripcion_fragmento: { type: 'string', description: 'Fragmento de descripción (opcional)' },
          gasto_id: { type: 'string', description: 'UUID del gasto a eliminar' },
          solo_vista_previa: {
            type: 'boolean',
            description:
              'True: solo muestra vista previa o candidatos. False u omitido: borra con gasto_id.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modificar_gasto',
      description:
        'Modifica un gasto existente (importe, proveedor, descripción, categoría, fecha). Busca por criterios o por gasto_id. SDD: solo_vista_previa true con cambios propuestos; luego solo_vista_previa false con gasto_id.',
      parameters: {
        type: 'object',
        properties: {
          gasto_id: { type: 'string', description: 'UUID del gasto' },
          proveedor: { type: 'string', description: 'Para buscar si no hay gasto_id' },
          fecha: { type: 'string', description: 'Fecha YYYY-MM-DD para buscar' },
          obra_nombre: { type: 'string', description: 'Nombre de obra para filtrar' },
          descripcion_fragmento: { type: 'string', description: 'Fragmento de descripción (búsqueda)' },
          nuevo_proveedor: { type: 'string', description: 'Nuevo nombre de proveedor' },
          nuevo_importe: { type: 'number', description: 'Nueva base imponible (sin IVA)' },
          nuevo_iva: { type: 'number', description: 'Nueva cuota de IVA' },
          nuevo_importe_total: { type: 'number', description: 'Nuevo total con IVA' },
          nueva_descripcion: { type: 'string', description: 'Nueva descripción' },
          nueva_categoria: {
            type: 'string',
            enum: ['material', 'herramienta', 'vertido', 'subcontrata', 'transporte', 'otros'],
            description: 'Nueva categoría',
          },
          nueva_fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
          solo_vista_previa: {
            type: 'boolean',
            description:
              'True: solo muestra vista previa o candidatos. False u omitido: aplica cambios con gasto_id.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

export const GASTOS_AGENT_SYSTEM_PROMPT = `Tu nombre es Bicho. Eres el subagente especialista en gestión de gastos del negocio. Tu trabajo es registrar, modificar, eliminar y vincular gastos con precisión absoluta.

PRINCIPIO FUNDAMENTAL:
Nunca respondas sin antes haber verificado toda la información necesaria. Nunca asumas datos que no hayas comprobado. Nunca ejecutes una acción sin haber validado que todos los campos requeridos son correctos y completos. Si falta cualquier dato crítico, pregunta antes de actuar.

IDENTIDAD Y ROL:
- Tu nombre es Bicho. Si el usuario te llama "Bicho", "Oye Bicho" o similares, ignora el nombre y ejecuta la petición.
- Eres especialista en gastos. No gestionas presupuestos, facturas, albaranes ni obras directamente — solo gastos.
- Hablas siempre en español, de forma clara y directa.
- Si el usuario cambia de tema drásticamente hacia agenda, operarios, presupuestos u obras, informa de que cierras el flujo de gastos y delega la respuesta al orquestador.

REGLAS DE REGISTRO (registrar_gasto_ticket):
- Antes de registrar, verifica que tienes: proveedor, importe, IVA, importe_total y fecha. Si falta alguno, pregunta.
- Validación de importes: verifica que importe + IVA ≈ importe_total. Permite un margen de error de +/- 0.05€ para ajustes de redondeo. Si la diferencia es mayor de 0.05€, detente e informa al usuario antes de guardar.
- Anti-duplicados obligatorio: antes de insertar, comprueba si ya existe un gasto con el mismo proveedor + fecha + importe_total. Si existe, informa al usuario y no insertes.
- Detección de devoluciones: si el usuario menciona "devolución", "descuento", "abono" o similares, aplica el signo negativo tanto a la base (importe) como al IVA y al importe_total para mantener la coherencia contable. Hazlo automáticamente sin preguntar.
- Inferencia de categoría: si el usuario no especifica categoría pero el proveedor o la descripción son claros (ej. "sacos de cemento" → "Materiales", "PcComponentes" → "Informática", "gasolinera" → "Transporte", "ferretería" → "Materiales"), infiere la categoría más lógica para un negocio de construcción y aplícala sin preguntar. Si no puedes inferirla con seguridad, pregunta.
- Resolución de obra: si el usuario menciona una obra, resuélvela siempre por nombre o contexto antes de insertar. Hereda cliente_id desde la obra resuelta.
- solo_vista_previa: si es true, muestra resumen sin insertar jamás.
- Confirma siempre el registro con un resumen claro: proveedor, importe, IVA, total, fecha, categoría, obra (si aplica).

REGLAS DE MODIFICACIÓN (modificar_gasto):
- SDD OBLIGATORIO: nunca modifiques sin mostrar primero vista previa (solo_vista_previa: true).
- Antes de buscar el gasto a modificar, verifica que tienes suficientes criterios de búsqueda (gasto_id, o combinación de proveedor+fecha+obra).
- Si la búsqueda devuelve varios candidatos, muéstralos todos y pide al usuario que especifique cuál.
- Solo ejecuta el UPDATE cuando el usuario confirme explícitamente ("sí", "confirma", "adelante").
- Normaliza siempre la categoría antes de guardar.
- Validación de nuevos importes: verifica que importe + IVA ≈ importe_total con margen de +/- 0.05€. Si la diferencia es mayor, detente y pregunta.

REGLAS DE ELIMINACIÓN (eliminar_gasto):
- SDD OBLIGATORIO: nunca elimines sin mostrar primero qué vas a borrar (solo_vista_previa: true).
- Si la búsqueda devuelve varios candidatos, muéstralos y pide confirmación de cuál eliminar.
- Solo ejecuta el DELETE cuando el usuario confirme explícitamente.
- Una vez eliminado, confirma con el nombre del proveedor y la fecha del gasto borrado.

REGLAS DE VINCULACIÓN (vincular_gasto):
- Antes de vincular, verifica que el gasto_id existe y pertenece al negocio.
- Verifica que cada documento (factura o albarán) existe y pertenece al negocio.
- Si algún ID no existe o no pertenece al negocio, informa del error específico sin insertar nada.
- Confirma la vinculación con el detalle de qué gasto se ha vinculado a qué documentos.

REGLAS ABSOLUTAS (nunca violar):
- business_id SIEMPRE de la sesión del servidor. NUNCA del input del usuario.
- parallel_tool_calls: false. Nunca ejecutes dos tools a la vez.
- Nunca inventes datos. Si no tienes un dato, pregunta.
- Nunca ejecutes una acción destructiva (UPDATE, DELETE, INSERT) sin haber pasado por vista previa y confirmación explícita del usuario (excepto registrar_gasto_ticket sin solo_vista_previa, que guarda directamente).
- Si detectas cualquier inconsistencia en los datos (importes que no cuadran más de 0.05€, fechas inválidas, IDs inexistentes), detente e informa antes de continuar.`;

export type HandleGastosCtx = {
  mensajeTrim?: string;
};

export async function handleGastosAgent(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient,
  _openai: OpenAI,
  ctx: HandleGastosCtx = {}
): Promise<Record<string, unknown>> {
  void userId;
  void _openai;
  const mensajeTrim = ctx.mensajeTrim ?? '';

  const resolveClienteIdOpcional = async (
    raw: unknown
  ): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> => {
    if (raw == null || !String(raw).trim()) return { ok: true, id: null };
    const cid = String(raw).trim();
    const { data: row, error: e0 } = await supabase
      .from('clientes')
      .select('id')
      .eq('id', cid)
      .eq('business_id', businessId)
      .maybeSingle();
    if (e0) return { ok: false, error: e0.message };
    if (!row?.id) return { ok: false, error: 'cliente_id no válido para este negocio' };
    return { ok: true, id: cid };
  };

  switch (toolName) {
    case 'eliminar_gasto': {
      const bidGDel = typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!bidGDel) return { error: 'business_id es requerido' };
      const soloVG =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const gastoIdG =
        typeof toolArgs.gasto_id === 'string' && toolArgs.gasto_id.trim()
          ? toolArgs.gasto_id.trim()
          : '';
      const proveedorG = String(toolArgs.proveedor ?? '').trim();
      const fechaG = String(toolArgs.fecha ?? '').trim();
      const obraNombreG = String(toolArgs.obra_nombre ?? '').trim();
      const obraIdG =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? toolArgs.obra_id.trim()
          : '';
      const descFragG = String(toolArgs.descripcion_fragmento ?? '').trim();

      const previewGastoRow = (r: {
        id: string;
        proveedor: string | null;
        importe_total: number | null;
        fecha: string | null;
        descripcion: string | null;
        obra_id?: string | null;
      }) => ({
        mensaje:
          `¿Eliminar este gasto?\n` +
          `• Proveedor: ${String(r.proveedor ?? '').trim() || '—'}\n` +
          `• Total: ${r.importe_total != null ? `${Number(r.importe_total).toFixed(2)} €` : '—'}\n` +
          `• Fecha: ${r.fecha ?? '—'}\n` +
          `• Descripción: ${String(r.descripcion ?? '').trim().slice(0, 120) || '—'}\n\n` +
          `Si el usuario confirma, vuelve a llamar a eliminar_gasto con gasto_id "${r.id}" y solo_vista_previa false (u omítelo).`,
        pendiente_confirmacion: true,
        gasto_id: r.id,
      });

      const borrarGasto = async (id: string) => {
        const { data: delG, error: delErr } = await supabase
          .from('gastos')
          .delete()
          .eq('id', id)
          .eq('business_id', bidGDel)
          .select('id')
          .maybeSingle();
        if (delErr) return { error: delErr.message };
        if (!delG?.id) {
          return { mensaje: 'No he encontrado ningún gasto que coincida.' };
        }
        return { mensaje: 'Gasto eliminado.', ok: true };
      };

      if (gastoIdG) {
        if (soloVG) {
          const { data: gr, error: ge } = await supabase
            .from('gastos')
            .select('id, proveedor, importe_total, fecha, descripcion, obra_id')
            .eq('id', gastoIdG)
            .eq('business_id', bidGDel)
            .maybeSingle();
          if (ge) return { error: ge.message };
          if (!gr?.id) {
            return { mensaje: 'No he encontrado ningún gasto que coincida.' };
          }
          return previewGastoRow(
            gr as {
              id: string;
              proveedor: string | null;
              importe_total: number | null;
              fecha: string | null;
              descripcion: string | null;
              obra_id?: string | null;
            }
          );
        }
        return borrarGasto(gastoIdG);
      }

      let qG = supabase
        .from('gastos')
        .select('id, proveedor, importe_total, fecha, descripcion, obra_id')
        .eq('business_id', bidGDel)
        .order('fecha', { ascending: false })
        .limit(80);

      if (proveedorG) {
        const safeP = proveedorG.replace(/[%_*]/g, '').slice(0, 120);
        if (safeP) qG = qG.ilike('proveedor', `%${safeP}%`);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaG)) {
        qG = qG.eq('fecha', fechaG);
      }
      if (descFragG) {
        const safeD = descFragG.replace(/[%_*]/g, '').slice(0, 200);
        if (safeD) qG = qG.ilike('descripcion', `%${safeD}%`);
      }

      const { data: gastosFilas, error: gErr } = await qG;
      if (gErr) return { error: gErr.message };

      let listaG = (gastosFilas ?? []) as Array<{
        id: string;
        proveedor: string | null;
        importe_total: number | null;
        fecha: string | null;
        descripcion: string | null;
        obra_id: string | null;
      }>;

      if (obraIdG) {
        listaG = listaG.filter((g) => g.obra_id === obraIdG);
      } else if (obraNombreG) {
        const obraResG = await resolverObraDocumentoAgente(
          supabase,
          bidGDel,
          undefined,
          [obraNombreG, mensajeTrim].filter(Boolean).join(' '),
          'gasto'
        );
        if (obraResG.ok && obraResG.obra_id) {
          listaG = listaG.filter((g) => g.obra_id === obraResG.obra_id);
        }
      }

      if (listaG.length === 0) {
        return { mensaje: 'No he encontrado ningún gasto que coincida.' };
      }
      if (listaG.length > 1) {
        const lines = listaG.slice(0, 15).map((g, i) => {
          const tot = g.importe_total != null ? `${Number(g.importe_total).toFixed(2)} €` : '—';
          return `${i + 1}. ${g.fecha ?? '—'} — ${String(g.proveedor ?? '').trim() || '—'} — ${tot} — id ${g.id}`;
        });
        return {
          mensaje: `Hay varios gastos que encajan:\n${lines.join('\n')}\nIndica cuál eliminar con gasto_id.`,
          candidatos: listaG.map((g) => g.id),
        };
      }

      const unoG = listaG[0]!;
      if (!soloVG) {
        return {
          error:
            'Para borrar con seguridad, primero muestra la vista prevía con solo_vista_previa true.',
        };
      }
      return previewGastoRow(unoG);
    }
    case 'modificar_gasto': {
      const bidModG = typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!bidModG) return { error: 'business_id es requerido' };
      const soloVMG =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const gastoIdMod =
        typeof toolArgs.gasto_id === 'string' && toolArgs.gasto_id.trim()
          ? toolArgs.gasto_id.trim()
          : '';

      const nuevoProv =
        toolArgs.nuevo_proveedor != null ? String(toolArgs.nuevo_proveedor).trim() : '';
      const nuevoImp = toolArgs.nuevo_importe;
      const nuevoIva = toolArgs.nuevo_iva;
      const nuevoTot = toolArgs.nuevo_importe_total;
      const nuevaDesc =
        toolArgs.nueva_descripcion != null ? String(toolArgs.nueva_descripcion).trim() : '';
      const nuevaFecha = String(toolArgs.nueva_fecha ?? '').trim();
      const categoriaExplicita =
        toolArgs.nueva_categoria !== undefined && toolArgs.nueva_categoria !== null;

      const tieneCambios =
        nuevoProv.length > 0 ||
        (typeof nuevoImp === 'number' && Number.isFinite(nuevoImp)) ||
        (typeof nuevoIva === 'number' && Number.isFinite(nuevoIva)) ||
        (typeof nuevoTot === 'number' && Number.isFinite(nuevoTot)) ||
        nuevaDesc.length > 0 ||
        categoriaExplicita ||
        /^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha);

      if (!tieneCambios) {
        return {
          error:
            'Indica al menos un campo nuevo (nuevo_proveedor, importes, descripción, categoría o fecha).',
        };
      }

      const cargarGasto = async (id: string) => {
        const { data: g, error } = await supabase
          .from('gastos')
          .select('id, proveedor, importe, iva, importe_total, fecha, descripcion, categoria, obra_id')
          .eq('id', id)
          .eq('business_id', bidModG)
          .maybeSingle();
        if (error) return { error: error.message } as const;
        if (!g?.id) return { notFound: true } as const;
        return { row: g } as const;
      };

      let targetId = gastoIdMod;

      if (!targetId) {
        const proveedorS = String(toolArgs.proveedor ?? '').trim();
        const fechaS = String(toolArgs.fecha ?? '').trim();
        const obraNombreS = String(toolArgs.obra_nombre ?? '').trim();
        const descFragS = String(toolArgs.descripcion_fragmento ?? '').trim();

        let qS = supabase
          .from('gastos')
          .select('id, proveedor, importe, iva, importe_total, fecha, descripcion, categoria, obra_id')
          .eq('business_id', bidModG)
          .order('fecha', { ascending: false })
          .limit(80);
        if (proveedorS) {
          const safe = proveedorS.replace(/[%_*]/g, '').slice(0, 120);
          if (safe) qS = qS.ilike('proveedor', `%${safe}%`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaS)) qS = qS.eq('fecha', fechaS);
        if (descFragS) {
          const sd = descFragS.replace(/[%_*]/g, '').slice(0, 200);
          if (sd) qS = qS.ilike('descripcion', `%${sd}%`);
        }
        const { data: gs, error: gsErr } = await qS;
        if (gsErr) return { error: gsErr.message };
        let listS = (gs ?? []) as Array<{ id: string; obra_id: string | null }>;
        if (obraNombreS) {
          const oRes = await resolverObraDocumentoAgente(
            supabase,
            bidModG,
            undefined,
            [obraNombreS, mensajeTrim].filter(Boolean).join(' '),
            'gasto'
          );
          if (oRes.ok && oRes.obra_id) {
            listS = listS.filter((x) => x.obra_id === oRes.obra_id);
          }
        }
        if (listS.length === 0) {
          return { mensaje: 'No he encontrado ningún gasto que coincida.' };
        }
        if (listS.length > 1) {
          const lines = listS.slice(0, 15).map((g, i) => `${i + 1}. id ${g.id}`);
          return {
            mensaje: `Hay varios gastos que encajan:\n${lines.join('\n')}\nIndica gasto_id y los cambios.`,
            candidatos: listS.map((g) => g.id),
          };
        }
        targetId = listS[0]!.id;
      }

      const loaded = await cargarGasto(targetId);
      if ('error' in loaded && loaded.error) return { error: loaded.error };
      if ('notFound' in loaded && loaded.notFound) {
        return { mensaje: 'No he encontrado ningún gasto que coincida.' };
      }
      const rowG = (loaded as { row: Record<string, unknown> }).row;
      const provAct = String(rowG.proveedor ?? '');
      const impAct = Number(rowG.importe ?? 0);
      const ivaAct = Number(rowG.iva ?? 0);
      const totAct = Number(rowG.importe_total ?? 0);
      const descAct = String(rowG.descripcion ?? '');
      const catAct = String(rowG.categoria ?? '');
      const fechaAct = String(rowG.fecha ?? '');

      const provN = nuevoProv || provAct;
      let impN = typeof nuevoImp === 'number' && Number.isFinite(nuevoImp) ? nuevoImp : impAct;
      let ivaN = typeof nuevoIva === 'number' && Number.isFinite(nuevoIva) ? nuevoIva : ivaAct;
      let totN = typeof nuevoTot === 'number' && Number.isFinite(nuevoTot) ? nuevoTot : totAct;
      if (
        typeof nuevoTot === 'number' &&
        Number.isFinite(nuevoTot) &&
        nuevoImp === undefined &&
        nuevoIva === undefined
      ) {
        totN = nuevoTot;
        const base = totN / 1.21;
        impN = Math.round(base * 100) / 100;
        ivaN = Math.round((totN - impN) * 100) / 100;
      }
      const descN = nuevaDesc.length > 0 ? nuevaDesc : descAct;
      const catN = categoriaExplicita ? normalizeGastoCategoria(toolArgs.nueva_categoria) : catAct;
      const fechaN = /^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha) ? nuevaFecha : fechaAct;

      const lineasPrev = [
        'Cambios propuestos en el gasto (no guardados aún):',
        `• Proveedor: ${provAct} → ${provN}`,
        `• Base: ${impAct.toFixed(2)} € → ${impN.toFixed(2)} €`,
        `• IVA: ${ivaAct.toFixed(2)} € → ${ivaN.toFixed(2)} €`,
        `• Total: ${totAct.toFixed(2)} € → ${totN.toFixed(2)} €`,
        `• Fecha: ${fechaAct} → ${fechaN}`,
        `• Descripción: ${descAct || '—'} → ${descN || '—'}`,
        `• Categoría: ${catAct || '—'} → ${catN || '—'}`,
        '',
        'Si el usuario confirma, vuelve a llamar a modificar_gasto con el mismo gasto_id y solo_vista_previa false.',
      ];

      if (soloVMG) {
        return {
          mensaje: lineasPrev.join('\n'),
          pendiente_confirmacion: true,
          gasto_id: targetId,
        };
      }

      const { data: upG, error: upGErr } = await supabase
        .from('gastos')
        .update({
          proveedor: provN,
          importe: impN,
          iva: ivaN,
          importe_total: totN,
          fecha: fechaN,
          descripcion: descN.length > 0 ? descN : null,
          categoria: catN || null,
        })
        .eq('id', targetId)
        .eq('business_id', bidModG)
        .select('id')
        .maybeSingle();
      if (upGErr) return { error: upGErr.message };
      if (!upG?.id) {
        return { mensaje: 'No he encontrado ningún gasto que coincida.' };
      }
      return { mensaje: 'Gasto actualizado correctamente.', ok: true, id: upG.id as string };
    }
    case 'registrar_gasto_ticket': {
      const proveedor = String(toolArgs.proveedor ?? '').trim();
      const importe = Number(toolArgs.importe);
      const iva = Number(toolArgs.iva);
      const importeTotal = Number(toolArgs.importe_total);
      const fecha = String(toolArgs.fecha ?? '').trim();
      const descripcion = String(toolArgs.descripcion ?? '').trim();
      const businessIdGasto = typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!businessIdGasto) {
        return { error: 'business_id es requerido' };
      }

      const crGasto = await resolveClienteIdOpcional(toolArgs.cliente_id);
      if (!crGasto.ok) return { error: crGasto.error };

      let explicitObraGasto =
        typeof toolArgs.obra_id === 'string' && toolArgs.obra_id.trim()
          ? String(toolArgs.obra_id).trim()
          : undefined;
      const obraNombreTool = String(toolArgs.obra_nombre ?? '').trim();
      if (!explicitObraGasto && obraNombreTool) {
        const ilikePat = (raw: string) => {
          const safe = raw.replace(/[%_*]/g, '').slice(0, 120);
          return safe ? `%${safe}%` : '';
        };
        const patObra = ilikePat(obraNombreTool);
        const { data: obrasPorNombre, error: errNomObra } = patObra
          ? await supabase
              .from('obras')
              .select('id, nombre')
              .eq('business_id', businessIdGasto)
              .in('estado', ['abierta', 'en_curso'])
              .ilike('nombre', patObra)
              .order('nombre', { ascending: true })
              .limit(15)
          : { data: [] as { id: string; nombre?: string | null }[], error: null };
        if (errNomObra) return { error: errNomObra.message };
        let lista: { id: string; nombre?: string | null }[] = obrasPorNombre ?? [];

        if (lista.length === 0) {
          const buscarClientesPorPat = async (label: string) => {
            const p = ilikePat(label);
            if (!p) {
              return {
                data: [] as { id: string; nombre?: string | null }[],
                error: null as string | null,
              };
            }
            const { data, error } = await supabase
              .from('clientes')
              .select('id, nombre')
              .eq('business_id', businessIdGasto)
              .ilike('nombre', p)
              .order('nombre', { ascending: true })
              .limit(15);
            return { data: data ?? [], error: error?.message ?? null };
          };

          let clist: { id: string; nombre?: string | null }[] = [];
          const rCli1 = await buscarClientesPorPat(obraNombreTool);
          if (rCli1.error) return { error: rCli1.error };
          clist = rCli1.data;

          if (clist.length === 0) {
            const clienteHint = obraNombreTool
              .replace(/^(obra\s+de\s+|la\s+obra\s+de\s+|obra\s+)/i, '')
              .trim();
            if (clienteHint && clienteHint !== obraNombreTool) {
              const rCli2 = await buscarClientesPorPat(clienteHint);
              if (rCli2.error) return { error: rCli2.error };
              clist = rCli2.data;
            }
          }

          if (clist.length === 0) {
            return {
              error: `No se encontró ninguna obra que coincida con «${obraNombreTool}» ni cliente asociado. Indica otro nombre u obra_id.`,
            };
          }
          if (clist.length > 1) {
            const lines = clist
              .map((c, i) => `${i + 1}. ${String((c as { nombre?: string | null }).nombre ?? '—')}`)
              .join('\n');
            return {
              mensaje:
                `He encontrado varios clientes que encajan con «${obraNombreTool}»:\n${lines}\n` +
                '¿Cuál es el correcto? Indica el nombre completo del cliente u obra_id.',
            };
          }

          const clienteIdRes = String((clist[0] as { id: string }).id);
          const nombreCli = String((clist[0] as { nombre?: string | null }).nombre ?? '').trim();
          const { data: obrasCliente, error: errOC } = await supabase
            .from('obras')
            .select('id, nombre')
            .eq('business_id', businessIdGasto)
            .eq('cliente_id', clienteIdRes)
            .in('estado', ['abierta', 'en_curso'])
            .order('nombre', { ascending: true })
            .limit(15);
          if (errOC) return { error: errOC.message };
          lista = obrasCliente ?? [];
          if (lista.length === 0) {
            return {
              error: `No hay obras abiertas vinculadas al cliente «${nombreCli || clienteIdRes}». Indica obra_id u otro criterio.`,
            };
          }
        }

        if (lista.length > 1) {
          const obrasAmb: Obra[] = lista.map((r) => ({
            id: String((r as { id: string }).id),
            business_id: businessIdGasto,
            cliente_id: null,
            nombre: String((r as { nombre?: string | null }).nombre ?? ''),
            direccion: null,
            estado: 'abierta',
          }));
          return { mensaje: mensajeObrasAmbiguas(obrasAmb, 'gasto') };
        }
        explicitObraGasto = String((lista[0] as { id: string }).id);
      }

      const textoObraGasto = [descripcion, proveedor, mensajeTrim].filter(Boolean).join(' ').trim();
      const obraGastoRes = await resolverObraDocumentoAgente(
        supabase,
        businessIdGasto,
        explicitObraGasto,
        textoObraGasto,
        'gasto'
      );
      if (!obraGastoRes.ok) return { mensaje: obraGastoRes.mensaje };
      const obraIdFinal = obraGastoRes.obra_id ?? '';

      let clienteIdGasto: string | null = crGasto.id;
      if (obraIdFinal && crGasto.id == null) {
        const { cliente_id: cidO } = await clienteDesdeObraSiAplica(
          supabase,
          businessIdGasto,
          obraIdFinal
        );
        if (cidO) clienteIdGasto = cidO;
      }

      if (!proveedor) {
        return { error: 'El proveedor es obligatorio' };
      }
      if (!Number.isFinite(importe) || !Number.isFinite(iva) || !Number.isFinite(importeTotal)) {
        return { error: 'importe, iva e importe_total deben ser números válidos' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return { error: 'La fecha debe tener formato YYYY-MM-DD' };
      }

      const categoria = normalizeGastoCategoria(toolArgs.categoria);
      const textoDeteccionDev = [
        mensajeTrim,
        proveedor,
        descripcion,
        String(toolArgs.texto_ocr ?? ''),
        String(toolArgs.concepto ?? ''),
        String(toolArgs.detalle ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();
      const hayPalabrasDevolucion =
        /\b(devolucion(?: de material)?|descuento|abono|nota de credito|negativo)\b/.test(
          textoDeteccionDev
        );
      const importeYaNegativo = importe < 0 || iva < 0 || importeTotal < 0;
      const esDevolucion = hayPalabrasDevolucion || importeYaNegativo;
      const imponerSigno = (n: number) => (esDevolucion ? -Math.abs(n) : n);
      const importeFinal = imponerSigno(importe);
      const ivaFinal = imponerSigno(iva);
      const importeTotalFinal = imponerSigno(importeTotal);
      const descripcionFinal = (() => {
        if (!esDevolucion) return descripcion;
        if (!descripcion) return '[DEVOLUCIÓN]';
        const normDesc = descripcion
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toUpperCase();
        if (normDesc.startsWith('[DEVOLUCION]')) return descripcion;
        return `[DEVOLUCIÓN] ${descripcion}`;
      })();

      const r2Gasto = (n: number) => Math.round(n * 100) / 100;
      const importeR = r2Gasto(importeFinal);
      const ivaR = r2Gasto(ivaFinal);
      const importeTotalR = r2Gasto(importeTotalFinal);

      const soloVistaGasto = toolArgs.solo_vista_previa === true;
      if (soloVistaGasto) {
        const lineas = [
          'Resumen del gasto (no guardado aún):',
          `• Proveedor: ${proveedor}`,
          `• Base: ${importeR.toFixed(2)} €, IVA: ${ivaR.toFixed(2)} €, Total: ${importeTotalR.toFixed(2)} €`,
          `• Fecha: ${fecha}`,
          `• Categoría: ${categoria}`,
        ];
        if (descripcionFinal.length > 0) lineas.push(`• Concepto: ${descripcionFinal}`);
        if (obraIdFinal) lineas.push('• Obra: vinculada (resuelta en servidor).');
        return {
          mensaje: lineas.join('\n'),
          pendiente_confirmacion: true,
        };
      }

      const { data: candidatosDup, error: dupErr } = await supabase
        .from('gastos')
        .select('id, importe_total')
        .eq('business_id', businessIdGasto)
        .eq('proveedor', proveedor)
        .eq('fecha', fecha);

      if (dupErr) {
        return { error: dupErr.message };
      }

      const duplicado = (candidatosDup ?? []).some(
        (g) => r2Gasto(Number((g as { importe_total?: unknown }).importe_total ?? 0)) === importeTotalR
      );
      if (duplicado) {
        return {
          mensaje: `Ya hay un gasto el ${fecha} para «${proveedor}» con el mismo importe total (${importeTotalR.toFixed(2)} €). No se ha vuelto a insertar para evitar duplicados.`,
          duplicado_evitado: true,
        };
      }

      const { data: row, error } = await supabase
        .from('gastos')
        .insert({
          business_id: businessIdGasto,
          proveedor,
          importe: importeFinal,
          iva: ivaFinal,
          importe_total: importeTotalFinal,
          fecha,
          categoria,
          descripcion: descripcionFinal.length > 0 ? descripcionFinal : null,
          ...(obraIdFinal ? { obra_id: obraIdFinal } : {}),
          ...(clienteIdGasto ? { cliente_id: clienteIdGasto } : {}),
        })
        .select('id')
        .single();

      if (error || !row?.id) {
        return { error: error?.message ?? 'No se pudo registrar el gasto' };
      }
      if (esDevolucion) {
        return {
          ok: true,
          id: row.id as string,
          mensaje: `Devolución registrada: -${Math.abs(importeTotalR).toFixed(2)}€ de ${proveedor}. ¿Algo más?`,
        };
      }
      return { ok: true, id: row.id as string };
    }
    case 'vincular_gasto': {
      const gastoId = String(toolArgs.gasto_id ?? '').trim();
      const documentosRaw = toolArgs.documentos;

      const businessIdVinc = typeof businessId === 'string' ? businessId : String(businessId ?? '');
      if (!businessIdVinc) {
        return { error: 'business_id es requerido' };
      }

      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!gastoId || !uuidRe.test(gastoId)) {
        return { error: 'gasto_id debe ser un UUID válido' };
      }
      if (!Array.isArray(documentosRaw) || documentosRaw.length === 0) {
        return { error: 'documentos debe ser un array con al menos un elemento' };
      }

      const { data: gastoRow, error: gastoErr } = await supabase
        .from('gastos')
        .select('id')
        .eq('id', gastoId)
        .eq('business_id', businessIdVinc)
        .maybeSingle();

      if (gastoErr) {
        return { error: `No se pudo comprobar el gasto: ${gastoErr.message}` };
      }
      if (!gastoRow?.id) {
        return { error: 'No se encontró el gasto o no pertenece a este negocio' };
      }

      type DocItem = { tipo: 'factura' | 'albaran'; id: string };
      const documentos: DocItem[] = [];
      for (let i = 0; i < documentosRaw.length; i++) {
        const item = documentosRaw[i];
        if (!item || typeof item !== 'object') {
          return { error: `documentos[${i}] debe ser un objeto con tipo e id` };
        }
        const o = item as Record<string, unknown>;
        const tipo = String(o.tipo ?? '').toLowerCase();
        const docId = String(o.id ?? '').trim();
        if (tipo !== 'factura' && tipo !== 'albaran') {
          return {
            error: `documentos[${i}].tipo debe ser "factura" o "albaran"`,
          };
        }
        if (!docId || !uuidRe.test(docId)) {
          return { error: `documentos[${i}].id debe ser un UUID válido` };
        }
        documentos.push({ tipo: tipo as 'factura' | 'albaran', id: docId });
      }

      for (let i = 0; i < documentos.length; i++) {
        const d = documentos[i];
        const tabla = d.tipo === 'factura' ? 'facturas' : 'albaranes';
        const { data: docRow, error: docErr } = await supabase
          .from(tabla)
          .select('id')
          .eq('id', d.id)
          .eq('business_id', businessIdVinc)
          .maybeSingle();

        if (docErr) {
          return {
            error: `No se pudo comprobar el documento (${d.tipo}): ${docErr.message}`,
          };
        }
        if (!docRow?.id) {
          return {
            error: `No se encontró la ${d.tipo} indicada o no pertenece a este negocio`,
          };
        }
      }

      const filas = documentos.map((d) => ({
        business_id: businessIdVinc,
        gasto_id: gastoId,
        documento_tipo: d.tipo,
        documento_id: d.id,
      }));

      const { error: insErr } = await supabase.from('gastos_documentos').insert(filas);

      if (insErr) {
        return {
          error: `No se pudo vincular el gasto: ${insErr.message}`,
        };
      }

      const n = documentos.length;
      return {
        mensaje: `Gasto vinculado correctamente a ${n} documento(s).`,
      };
    }
    default:
      return { error: `Tool de gastos no soportada: ${toolName}` };
  }
}
