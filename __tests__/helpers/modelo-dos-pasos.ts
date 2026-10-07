/** Modelo simulado para el traductor en DOS pasos: paso 1 `elegir_accion`, paso 2 `orden_jev`; el resto es charla. */
type Req = { tools?: Array<{ function: { name: string } }> };

const llamada = (name: string, args: unknown) => ({ choices: [{ message: { content: null, tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

export function respuestaModelo(req: Req, orden: Record<string, unknown>, opciones: { continua?: boolean; charla?: string } = {}) {
  const nombres = req.tools?.map((t) => t.function.name) ?? [];
  if (nombres.includes('elegir_accion')) return llamada('elegir_accion', { accion: orden.accion, continua_tarea: opciones.continua === true ? true : null });
  if (nombres.includes('orden_jev')) {
    const { accion: _accion, ...campos } = orden;
    return llamada('orden_jev', campos);
  }
  return { choices: [{ message: { content: opciones.charla ?? 'Hola' } }] };
}
