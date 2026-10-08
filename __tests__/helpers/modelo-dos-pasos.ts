/** Modelo simulado para el traductor en DOS pasos: paso 1 `elegir_accion`, paso 2 `orden_jev`; el resto es charla. */
import { clasificadorSimulado } from './clasificador-simulado';

type Req = { tools?: Array<{ function: { name: string } }>; messages?: Array<{ role: string; content: unknown }> };

const llamada = (name: string, args: unknown) => ({ choices: [{ message: { content: null, tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

export function respuestaModelo(req: Req, orden: Record<string, unknown>, opciones: { continua?: boolean; charla?: string } = {}) {
  const nombres = req.tools?.map((t) => t.function.name) ?? [];
  if (nombres.includes('clasificar_intencion')) {
    const u = String(req.messages?.find((m) => m.role === 'user')?.content ?? '');
    const resumen = u.match(/ORDEN PENDIENTE DE CONFIRMAR \(lo que se le ense[^)]*\):\n([\s\S]*?)\n\n/)?.[1] ?? null;
    const pregunta = u.match(/PREGUNTA ABIERTA DEL ASISTENTE: ([^\n]+)/)?.[1];
    const mensaje = u.match(/MENSAJE DEL USUARIO: ([\s\S]*)$/)?.[1] ?? '';
    return llamada('clasificar_intencion', clasificadorSimulado({ mensaje, resumenPendiente: resumen, preguntaAbierta: pregunta && !/ninguna\.?$/.test(pregunta) ? pregunta : null }));
  }
  if (nombres.includes('elegir_accion')) return llamada('elegir_accion', { accion: orden.accion, continua_tarea: opciones.continua === true ? true : null });
  if (nombres.includes('orden_jev')) {
    const campos = Object.fromEntries(Object.entries(orden).filter(([k]) => k !== "accion"));
    return llamada('orden_jev', campos);
  }
  return { choices: [{ message: { content: opciones.charla ?? 'Hola' } }] };
}
