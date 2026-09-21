/** Índice de la completion final de prosa: router (0) + agente con tools (1) + final (2). */
export const AGENTE_FINAL_CALL_INDEX = 2;

type ToolCallLike = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type MessageLike = {
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: ToolCallLike[];
};

export function toolResultsMapFromFinalCompletion(
  createMock: jest.Mock,
  finalIndex = AGENTE_FINAL_CALL_INDEX
): Map<string, unknown> {
  const req = createMock.mock.calls[finalIndex]?.[0] as
    | { messages?: MessageLike[] }
    | undefined;
  const messages = req?.messages ?? [];
  const map = new Map<string, unknown>();

  const assistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length);
  const toolMsgs = messages.filter((m) => m.role === 'tool');

  if (assistant?.tool_calls && toolMsgs.length) {
    const byId = new Map<string, unknown>();
    for (const tm of toolMsgs) {
      const id = String(tm.tool_call_id ?? '');
      const raw =
        typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content ?? null);
      try {
        byId.set(id, JSON.parse(raw));
      } catch {
        byId.set(id, raw);
      }
    }
    for (const tc of assistant.tool_calls) {
      const name = tc.function?.name;
      if (!name) continue;
      const id = String(tc.id ?? '');
      if (byId.has(id)) map.set(name, byId.get(id));
    }
    if (map.size) return map;
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const content = String(lastUser?.content ?? '');
  for (const line of content.split('\n')) {
    const idx = line.indexOf(': ');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    if (!/^[a-z0-9_]+$/.test(name)) continue;
    try {
      map.set(name, JSON.parse(line.slice(idx + 2)));
    } catch {
      /* línea no es JSON de tool */
    }
  }
  return map;
}

export function singleToolResultFromFinalCompletion(
  createMock: jest.Mock,
  finalIndex = AGENTE_FINAL_CALL_INDEX
): unknown {
  const tr = toolResultsMapFromFinalCompletion(createMock, finalIndex);
  if (tr.size !== 1) {
    throw new Error(`Expected 1 tool result, got ${tr.size}: ${[...tr.keys()].join(', ')}`);
  }
  return [...tr.values()][0];
}

export function toolPayloadFromFinalCompletion(
  createMock: jest.Mock,
  toolName: string,
  finalIndex = AGENTE_FINAL_CALL_INDEX
): unknown {
  const tr = toolResultsMapFromFinalCompletion(createMock, finalIndex);
  if (!tr.has(toolName)) {
    throw new Error(`missing tool line ${toolName}`);
  }
  return tr.get(toolName);
}

export function openaiCallParams(
  createMock: jest.Mock,
  index: number
): Record<string, unknown> {
  return (createMock.mock.calls[index]?.[0] ?? {}) as Record<string, unknown>;
}

export function findOpenAiCallWithTools(
  createMock: jest.Mock
): { index: number; params: Record<string, unknown> } | null {
  for (let i = 0; i < createMock.mock.calls.length; i++) {
    const params = openaiCallParams(createMock, i);
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      return { index: i, params };
    }
  }
  return null;
}
