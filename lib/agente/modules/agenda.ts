import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Normaliza hora dictada o en texto libre a HH:MM cuando es posible. */
function normalizeHora(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  m = s.match(/^(\d{1,2})\s*h$/i);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  const low = s.toLowerCase();
  const mañana = low.includes('mañana') || low.includes('manana');
  const tarde = low.includes('tarde');
  const noche = low.includes('noche');

  m = s.match(/(?:a\s+las|^las)\s+(\d{1,2})(?::(\d{2}))?/i);
  if (!m) {
    m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  }
  if (!m) {
    m = s.match(/(\d{1,2})\s*(?:de\s+la\s+)?(?:mañana|manana)/i);
  }
  if (m) {
    let h = Number(m[1]);
    const min = m[2] != null && m[2] !== '' ? Number(m[2]) : 0;
    if (Number.isNaN(min) || min < 0 || min > 59) return null;
    if (tarde && h >= 1 && h <= 11) {
      h += 12;
    } else if (noche && h >= 1 && h <= 11) {
      h += 12;
    } else if (mañana && h >= 1 && h <= 11) {
      /* mañana: 1–11 se interpretan como horas de la mañana */
    }
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseHmToMinutes(hm: string): number {
  const [a, b] = hm.split(':').map((x) => Number(x));
  return a * 60 + b;
}

function formatMinutesToHm(totalMinutes: number): string {
  const minsInDay = 24 * 60;
  const wrapped = ((totalMinutes % minsInDay) + minsInDay) % minsInDay;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseMinutosAntelacion(raw: unknown): { value: number; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: 0 };
  const parsed =
    typeof raw === 'number' && Number.isInteger(raw) ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return { value: 0, error: 'minutos_antelacion debe ser un entero mayor o igual que 0' };
  }
  return { value: parsed };
}

function normTituloAgenda(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Mensajes cortos de confirmación (p. ej. tras vista previa SDD). Evita bucles si el modelo repite solo_vista_previa true. */
function esConfirmacionUsuario(raw: string): boolean {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!s) return false;
  const t = s.replace(/\s+/g, ' ').replace(/[¡!?¿.]/g, '').trim();
  if (/^(no|nop|no gracias|mejor no|cancela|cancelar|dejalo|déjalo|olvida|olvídalo)\b/.test(t)) {
    return false;
  }
  if (t.length <= 40) {
    if (
      /^(sí|si|vale|ok|okay|adelante|confirmo|correcto|exacto|hazlo|claro|genial|perfecto|listo)$/.test(t)
    ) {
      return true;
    }
    if (/^(si|sí)(\s+(por favor|vale|ok|adelante|elimina|borra))?$/.test(t)) {
      return true;
    }
    if (/^(elimina|eliminar|borra|borrar|elimínalo|borralo)$/.test(t)) {
      return true;
    }
  }
  return false;
}

export const AGENDA_HANDLED_TOOLS = new Set([
  'crear_recordatorio',
  'editar_recordatorio',
  'eliminar_recordatorio',
  'eliminar_evento_agenda',
  'modificar_evento_agenda',
]);

export const AGENDA_AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'crear_recordatorio',
      description: 'Crear un recordatorio en agenda',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          fecha: { type: 'string', description: 'Formato YYYY-MM-DD' },
          hora: { type: 'string', description: 'Formato HH:MM (opcional)' },
          minutos_antelacion: {
            type: 'integer',
            description:
              'Minutos de antelación con los que avisar antes de la hora del evento. Usa 0 si es un recordatorio simple (llevar algo, hacer una llamada). Usa 30 si es una cita, reunión o visita con otra persona. Usa 60 si el usuario lo pide explícitamente o si implica desplazamiento largo.',
            default: 0,
          },
        },
        required: ['titulo', 'fecha'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'editar_recordatorio',
      description: 'Editar un recordatorio existente',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          titulo: { type: 'string' },
          fecha: { type: 'string', description: 'Formato YYYY-MM-DD' },
          hora: { type: 'string', description: 'Formato HH:MM (o vacío para quitarla)' },
          minutos_antelacion: {
            type: 'integer',
            description: 'Minutos de antelación para el aviso (entero mayor o igual que 0).',
          },
        },
        required: ['id'],
      },
    },
  },
] as const;

export const AGENDA_AGENT_SYSTEM_PROMPT = `Tu nombre es Bicho. Si el usuario te llama por tu nombre al inicio de una petición ('Oye Bicho...', 'Bicho escucha...', 'Bicho añade...', 'Eh Bicho...' o similar), ignora el nombre y ejecuta directamente lo que pide a continuación. No respondas al nombre, no lo confirmes, simplemente actúa.

Eres el especialista en agenda y recordatorios de Perfilio.

REGLAS ABSOLUTAS:
1. NUNCA confirmes un recordatorio sin haber recibido TOOL RESULT con ok:true. Llama a la tool primero, espera el resultado, solo entonces confirma.
2. Formato de confirmación obligatorio: 'Recordatorio [operación]: [título] para [fecha] a las [hora]. ¿Algo más?'
3. NUNCA uses body.business_id — usa siempre el business_id recibido por parámetro.
4. Si el usuario dicta una hora en lenguaje natural ('a las 9 de la mañana', 'a las 3 de la tarde'), conviértela siempre a formato HH:MM antes de guardar.
SINÓNIMOS: Las palabras 'alarma', 'aviso', 'alerta', 'recordatorio' y 'que me salte algo' son siempre peticiones de crear_recordatorio. Nunca las trates como ajenas al dominio de agenda.
5. Si el usuario dice algo ajeno a la agenda, responde: 'Para eso tendrás que preguntarme fuera del contexto de agenda. ¿Algo más con los recordatorios?'

ELIMINACIÓN (SDD — obligatorio):
6. Si el TOOL RESULT trae pendiente_confirmacion: true (vista previa de borrado), el siguiente mensaje del usuario que sea afirmación corta (sí, vale, ok, adelante, elimina, etc.) DEBE ejecutar el borrado: misma tool (eliminar_recordatorio o eliminar_evento_agenda) con el mismo id/evento_id y solo_vista_previa false u omitido. NO vuelvas a llamar con solo_vista_previa true tras una vista previa de borrado.
7. Si ya mostraste la vista previa y el usuario confirma, nunca repitas la pregunta de confirmación sin llamar antes a la tool en modo ejecución (solo_vista_previa false).`;

export type HandleAgendaCtx = {
  mensajeTrim?: string;
};

export async function handleAgenda(
  toolName: string,
  toolArgs: Record<string, unknown>,
  businessId: string,
  userId: string | null,
  supabase: SupabaseClient,
  _openai: OpenAI,
  ctx: HandleAgendaCtx = {}
): Promise<Record<string, unknown>> {
  void userId;
  void _openai;
  const mensajeTrim = ctx.mensajeTrim ?? '';

  const bid =
    typeof businessId === 'string' ? businessId : String(businessId ?? '');
  if (!bid) {
    return { error: 'business_id es requerido' };
  }

  switch (toolName) {
    case 'crear_recordatorio': {
      const titulo = String(toolArgs.titulo ?? '').trim();
      const fechaRaw = String(toolArgs.fecha ?? '').trim();
      const horaOpt = toolArgs.hora != null ? String(toolArgs.hora).trim() : '';
      const { value: minutosAntelacion, error: errMinAnt } = parseMinutosAntelacion(
        toolArgs.minutos_antelacion
      );

      if (!titulo) {
        return { error: 'El título del recordatorio es obligatorio' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
        return { error: 'La fecha debe tener formato YYYY-MM-DD' };
      }
      if (errMinAnt) {
        return { error: errMinAnt };
      }

      const tituloNorm = normTituloAgenda(titulo);
      const { data: mismoDia, error: errMismoDia } = await supabase
        .from('agenda')
        .select('id, titulo')
        .eq('business_id', bid)
        .eq('fecha', fechaRaw);

      if (errMismoDia) {
        return { error: errMismoDia.message };
      }

      const minLenSimilar = 12;
      const safeIlike = titulo.replace(/[%_]/g, '').trim().toLowerCase();
      for (const r of mismoDia ?? []) {
        const ex = String((r as { titulo?: string | null }).titulo ?? '');
        const nEx = normTituloAgenda(ex);
        if (nEx === tituloNorm) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
        if (
          tituloNorm.length >= minLenSimilar &&
          nEx.length >= minLenSimilar &&
          (tituloNorm.includes(nEx) || nEx.includes(tituloNorm))
        ) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
        const exLow = ex.toLowerCase();
        const tituloLow = titulo.toLowerCase();
        if (
          safeIlike.length >= 4 &&
          (exLow.includes(safeIlike) ||
            (ex.trim().length >= 4 && tituloLow.includes(ex.trim().toLowerCase())))
        ) {
          return {
            mensaje: 'Ya tienes este evento agendado',
            duplicado_evitado: true,
          };
        }
      }

      const insertPayload: {
        business_id: string;
        titulo: string;
        fecha: string;
        hora?: string;
        minutos_antelacion: number;
      } = {
        business_id: bid,
        titulo,
        fecha: fechaRaw,
        minutos_antelacion: minutosAntelacion,
      };
      if (horaOpt) {
        const normalized = normalizeHora(horaOpt);
        insertPayload.hora = normalized ?? horaOpt;
      }

      const { data: row, error } = await supabase
        .from('agenda')
        .insert(insertPayload)
        .select('id')
        .single();

      if (error || !row?.id) {
        return { error: error?.message ?? 'No se pudo crear el recordatorio' };
      }
      const horaConfirmacion = insertPayload.hora ?? (horaOpt || '—');
      const avisoNatural =
        minutosAntelacion > 0
          ? insertPayload.hora
            ? ` Perfecto, te aviso a las ${formatMinutesToHm(parseHmToMinutes(insertPayload.hora) - minutosAntelacion)} para que llegues a tiempo a las ${insertPayload.hora}.`
            : ` Perfecto, te aviso con ${minutosAntelacion} minutos de antelación.`
          : '';
      return {
        ok: true,
        id: row.id as string,
        mensaje: `Recordatorio creado: ${titulo} para ${fechaRaw} a las ${horaConfirmacion}.${avisoNatural} ¿Algo más?`,
      };
    }
    case 'editar_recordatorio': {
      const id = String(toolArgs.id ?? '').trim();
      if (!id) {
        return { error: 'id es obligatorio' };
      }

      const updates: {
        titulo?: string;
        fecha?: string;
        hora?: string | null;
        minutos_antelacion?: number;
      } = {};
      if (toolArgs.titulo !== undefined) {
        const t = String(toolArgs.titulo ?? '').trim();
        if (!t) {
          return { error: 'El título no puede estar vacío' };
        }
        updates.titulo = t;
      }
      if (toolArgs.fecha !== undefined) {
        const f = String(toolArgs.fecha ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
          return { error: 'La fecha debe tener formato YYYY-MM-DD' };
        }
        updates.fecha = f;
      }
      if (toolArgs.hora !== undefined) {
        const h = String(toolArgs.hora ?? '').trim();
        if (!h.length) {
          updates.hora = null;
        } else {
          const norm = normalizeHora(h);
          updates.hora = norm ?? h;
        }
      }
      if (toolArgs.minutos_antelacion !== undefined) {
        const { value, error: err } = parseMinutosAntelacion(toolArgs.minutos_antelacion);
        if (err) {
          return { error: err };
        }
        updates.minutos_antelacion = value;
      }

      if (Object.keys(updates).length === 0) {
        return {
          error:
            'Indica al menos un campo a actualizar (titulo, fecha, hora o minutos_antelacion)',
        };
      }

      const { data: row, error } = await supabase
        .from('agenda')
        .update(updates)
        .eq('id', id)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();

      if (error) {
        return { error: error.message };
      }
      if (!row?.id) {
        return { error: 'No se encontró el evento o no pertenece a este negocio' };
      }
      return { ok: true, id: row.id as string };
    }
    case 'eliminar_recordatorio': {
      const id = String(toolArgs.id ?? '').trim();
      if (!id) {
        return { error: 'id es obligatorio' };
      }

      const soloVR =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const userConfirms = esConfirmacionUsuario(mensajeTrim);

      const previewElimRec = async () => {
        const { data: ev, error: evErr } = await supabase
          .from('agenda')
          .select('id, titulo, fecha, hora')
          .eq('id', id)
          .eq('business_id', bid)
          .maybeSingle();
        if (evErr) return { error: evErr.message } as const;
        if (!ev?.id) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' } as const;
        }
        return {
          mensaje:
            `¿Eliminar este recordatorio?\n` +
            `• ${String(ev.titulo ?? '').trim() || '—'}\n` +
            `• Fecha: ${String(ev.fecha ?? '').trim() || '—'}\n` +
            `• Hora: ${String(ev.hora ?? '').trim() || '—'}\n\n` +
            `Si el usuario confirma, vuelve a llamar a eliminar_recordatorio con el mismo id y solo_vista_previa false (u omítelo).`,
          pendiente_confirmacion: true,
          id: ev.id as string,
        } as const;
      };

      if (soloVR && !userConfirms) {
        const prev = await previewElimRec();
        if ('error' in prev && prev.error) return { error: prev.error };
        return prev;
      }

      const { data: deleted, error } = await supabase
        .from('agenda')
        .delete()
        .eq('id', id)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();

      if (error) {
        return { error: error.message };
      }
      if (!deleted) {
        return { error: 'No se encontró el evento o no pertenece a este negocio' };
      }
      return { ok: true };
    }
    case 'eliminar_evento_agenda': {
      const soloVAg =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const userConfirms = esConfirmacionUsuario(mensajeTrim);
      const eventoIdAg =
        typeof toolArgs.evento_id === 'string' && toolArgs.evento_id.trim()
          ? toolArgs.evento_id.trim()
          : '';
      const tituloFragAg = String(toolArgs.titulo_fragmento ?? '').trim();
      const fechaAg = String(toolArgs.fecha ?? '').trim();

      if (eventoIdAg) {
        if (soloVAg && !userConfirms) {
          const { data: ev, error: evErr } = await supabase
            .from('agenda')
            .select('id, titulo, fecha, hora')
            .eq('id', eventoIdAg)
            .eq('business_id', bid)
            .maybeSingle();
          if (evErr) return { error: evErr.message };
          if (!ev?.id) {
            return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
          }
          return {
            mensaje:
              `¿Eliminar este recordatorio?\n` +
              `• ${String(ev.titulo ?? '').trim() || '—'}\n` +
              `• Fecha: ${String(ev.fecha ?? '').trim() || '—'}\n` +
              `• Hora: ${String(ev.hora ?? '').trim() || '—'}\n\n` +
              `Si el usuario confirma, vuelve a llamar a eliminar_evento_agenda con el mismo evento_id y solo_vista_previa false (u omítelo).`,
            pendiente_confirmacion: true,
            evento_id: ev.id,
          };
        }
        const { data: delEv, error: delEvErr } = await supabase
          .from('agenda')
          .delete()
          .eq('id', eventoIdAg)
          .eq('business_id', bid)
          .select('id')
          .maybeSingle();
        if (delEvErr) return { error: delEvErr.message };
        if (!delEv?.id) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
        }
        return { mensaje: 'Evento de agenda eliminado.', ok: true };
      }

      if (!tituloFragAg && !/^\d{4}-\d{2}-\d{2}$/.test(fechaAg)) {
        return {
          error: 'Indica titulo_fragmento y/o fecha (YYYY-MM-DD) para buscar el evento, o evento_id.',
        };
      }

      let qEv = supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('business_id', bid)
        .order('fecha', { ascending: false })
        .limit(80);

      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaAg)) {
        qEv = qEv.eq('fecha', fechaAg);
      }
      if (tituloFragAg) {
        const safeT = tituloFragAg.replace(/[%_*]/g, '').slice(0, 200);
        if (safeT) qEv = qEv.ilike('titulo', `%${safeT}%`);
      }

      const { data: evRows, error: evQErr } = await qEv;
      if (evQErr) return { error: evQErr.message };

      const evList = (evRows ?? []) as Array<{
        id: string;
        titulo: string | null;
        fecha: string | null;
        hora: string | null;
      }>;

      if (evList.length === 0) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      if (evList.length > 1) {
        const lines = evList.slice(0, 15).map((e, i) => {
          return `${i + 1}. ${e.fecha ?? '—'} — ${String(e.titulo ?? '').trim() || '—'} — id ${e.id}`;
        });
        return {
          mensaje: `Hay varios eventos que encajan:\n${lines.join('\n')}\nIndica cuál eliminar con evento_id.`,
          candidatos: evList.map((e) => e.id),
        };
      }

      const unoEv = evList[0]!;
      if (soloVAg && !userConfirms) {
        return {
          mensaje:
            `¿Eliminar este recordatorio?\n` +
            `• ${String(unoEv.titulo ?? '').trim() || '—'}\n` +
            `• Fecha: ${String(unoEv.fecha ?? '').trim() || '—'}\n` +
            `• Hora: ${String(unoEv.hora ?? '').trim() || '—'}\n\n` +
            `Si el usuario confirma, vuelve a llamar a eliminar_evento_agenda con evento_id "${unoEv.id}" y solo_vista_previa false (u omítelo).`,
          pendiente_confirmacion: true,
          evento_id: unoEv.id,
        };
      }
      if (!soloVAg && !userConfirms) {
        return {
          error:
            'Para borrar con seguridad, primero muestra la vista prevía con solo_vista_previa true.',
        };
      }

      const { data: delUno, error: delUnoErr } = await supabase
        .from('agenda')
        .delete()
        .eq('id', unoEv.id)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();
      if (delUnoErr) return { error: delUnoErr.message };
      if (!delUno?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      return { mensaje: 'Evento de agenda eliminado.', ok: true };
    }
    case 'modificar_evento_agenda': {
      const soloVEv =
        toolArgs.solo_vista_previa === true ||
        String(toolArgs.solo_vista_previa ?? '').toLowerCase() === 'true';
      const eventoIdM =
        typeof toolArgs.evento_id === 'string' && toolArgs.evento_id.trim()
          ? toolArgs.evento_id.trim()
          : '';

      const nuevoTit = toolArgs.nuevo_titulo != null ? String(toolArgs.nuevo_titulo).trim() : '';
      const nuevaFechaM = String(toolArgs.nueva_fecha ?? '').trim();
      const nuevaHoraM = toolArgs.nueva_hora !== undefined ? String(toolArgs.nueva_hora) : undefined;

      const tieneAlguno =
        nuevoTit.length > 0 ||
        /^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM) ||
        nuevaHoraM !== undefined;
      if (!tieneAlguno) {
        return { error: 'Indica nuevo_titulo, nueva_fecha y/o nueva_hora para modificar el evento.' };
      }

      let idEv = eventoIdM;
      if (!idEv) {
        const titFr = String(toolArgs.titulo_fragmento ?? '').trim();
        const fechaBus = String(toolArgs.fecha ?? '').trim();
        if (!titFr && !/^\d{4}-\d{2}-\d{2}$/.test(fechaBus)) {
          return { error: 'Indica evento_id o titulo_fragmento y/o fecha para buscar el evento.' };
        }
        let qM = supabase
          .from('agenda')
          .select('id, titulo, fecha, hora')
          .eq('business_id', bid)
          .order('fecha', { ascending: false })
          .limit(80);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaBus)) qM = qM.eq('fecha', fechaBus);
        if (titFr) {
          const st = titFr.replace(/[%_*]/g, '').slice(0, 200);
          if (st) qM = qM.ilike('titulo', `%${st}%`);
        }
        const { data: rowsM, error: errM } = await qM;
        if (errM) return { error: errM.message };
        const listM = (rowsM ?? []) as Array<{ id: string }>;
        if (listM.length === 0) {
          return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
        }
        if (listM.length > 1) {
          return {
            mensaje: `Hay varios eventos que encajan. Indica evento_id.\n${listM
              .slice(0, 15)
              .map((e, i) => `${i + 1}. ${e.id}`)
              .join('\n')}`,
            candidatos: listM.map((e) => e.id),
          };
        }
        idEv = listM[0]!.id;
      }

      const { data: evRow, error: evFE } = await supabase
        .from('agenda')
        .select('id, titulo, fecha, hora')
        .eq('id', idEv)
        .eq('business_id', bid)
        .maybeSingle();
      if (evFE) return { error: evFE.message };
      if (!evRow?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }

      const titAct = String(evRow.titulo ?? '');
      const fechaActE = String(evRow.fecha ?? '');
      const horaAct = String(evRow.hora ?? '');

      const titN = nuevoTit || titAct;
      const fechaN = /^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM) ? nuevaFechaM : fechaActE;
      let horaN: string | null = horaAct;
      if (nuevaHoraM !== undefined) {
        const h = nuevaHoraM.trim();
        if (h.length === 0) {
          horaN = null;
        } else {
          const norm = normalizeHora(h);
          horaN = norm ?? h;
        }
      }

      const prevLines = [
        'Cambios propuestos en el evento (no guardados aún):',
        `• Título: ${titAct} → ${titN}`,
        `• Fecha: ${fechaActE} → ${fechaN}`,
        `• Hora: ${horaAct || '—'} → ${horaN ?? '—'}`,
        '',
        'Si el usuario confirma, vuelve a llamar a modificar_evento_agenda con el mismo evento_id y solo_vista_previa false.',
      ];

      if (soloVEv) {
        return {
          mensaje: prevLines.join('\n'),
          pendiente_confirmacion: true,
          evento_id: idEv,
        };
      }

      const updatesEv: { titulo?: string; fecha?: string; hora?: string | null } = {};
      if (nuevoTit.length > 0) updatesEv.titulo = titN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaM)) updatesEv.fecha = fechaN;
      if (nuevaHoraM !== undefined) updatesEv.hora = horaN;

      if (Object.keys(updatesEv).length === 0) {
        return { error: 'No hay cambios que aplicar.' };
      }

      const { data: upEv, error: upEvErr } = await supabase
        .from('agenda')
        .update(updatesEv)
        .eq('id', idEv)
        .eq('business_id', bid)
        .select('id')
        .maybeSingle();
      if (upEvErr) return { error: upEvErr.message };
      if (!upEv?.id) {
        return { mensaje: 'No he encontrado ningún evento de agenda que coincida.' };
      }
      return { mensaje: 'Evento de agenda actualizado.', ok: true, id: upEv.id as string };
    }
    default:
      return { error: `Tool de agenda no soportada: ${toolName}` };
  }
}
