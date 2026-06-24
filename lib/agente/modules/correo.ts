import type OpenAI from 'openai';
import { getGmailAccessTokenForUser } from '@/lib/gmail/get-access-token';

export const CORREO_HANDLED_TOOLS = new Set(['leer_emails_recientes', 'enviar_email']);

export const CORREO_AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'leer_emails_recientes',
      description: 'Últimos 5 emails del inbox: remitente, asunto, resumen del cuerpo.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_email',
      description:
        'Crea borrador de email (para, asunto, cuerpo); el usuario aprueba y envía desde el panel, no se envía solo. No aplica el flujo SDD de presupuestos/facturas.',
      parameters: {
        type: 'object',
        properties: {
          destinatario: { type: 'string' },
          asunto: { type: 'string' },
          cuerpo: { type: 'string' },
        },
        required: ['destinatario', 'asunto', 'cuerpo'],
        additionalProperties: false,
      },
    },
  },
];

export type EmailPendienteAprobacion = {
  tipo: 'email_pendiente_aprobacion';
  para: string;
  asunto: string;
  cuerpo: string;
};

export type EmailPendienteCliente = Pick<EmailPendienteAprobacion, 'para' | 'asunto' | 'cuerpo'>;

export type EmailRecienteItem = {
  remitente: string | null;
  asunto: string | null;
  resumen: string | null;
};

export async function getGmailAccessToken(
  authUserId: string | undefined
): Promise<{ accessToken: string } | { error: string }> {
  if (!authUserId) return { error: 'No hay usuario autenticado para Gmail' };
  const r = await getGmailAccessTokenForUser(authUserId);
  if ('error' in r) {
    return { error: r.error };
  }
  return { accessToken: r.accessToken };
}

export async function handleLeerEmailsRecientes(
  _toolArgs: Record<string, unknown>,
  authUserId: string | undefined
): Promise<{ items: EmailRecienteItem[] } | { error: string }> {
  const tokenResult = await getGmailAccessToken(authUserId);
  if ('error' in tokenResult) return { error: tokenResult.error };
  const accessToken = tokenResult.accessToken;

  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!listRes.ok) {
    return { error: 'No se pudieron leer emails recientes de Gmail' };
  }

  const listJson = (await listRes.json()) as {
    messages?: Array<{ id: string }>;
  };

  const msgIds = listJson.messages ?? [];
  const items: EmailRecienteItem[] = [];

  for (const msg of msgIds) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!msgRes.ok) continue;

    const msgJson = (await msgRes.json()) as {
      snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };

    const headers = msgJson.payload?.headers ?? [];
    const from =
      headers.find((h) => (h.name ?? '').toLowerCase() === 'from')?.value ?? null;
    const subject =
      headers.find((h) => (h.name ?? '').toLowerCase() === 'subject')?.value ?? null;

    items.push({
      remitente: from,
      asunto: subject,
      resumen: msgJson.snippet ?? null,
    });
  }

  return { items };
}

export function handleEnviarEmail(
  toolArgs: Record<string, unknown>
): EmailPendienteAprobacion | { error: string } {
  const destinatario = String(toolArgs.destinatario ?? '').trim();
  const asunto = String(toolArgs.asunto ?? '').trim();
  const cuerpo = String(toolArgs.cuerpo ?? '').trim();

  if (!destinatario || !asunto || !cuerpo) {
    return { error: 'Faltan parámetros obligatorios para enviar email' };
  }

  return {
    tipo: 'email_pendiente_aprobacion',
    para: destinatario,
    asunto,
    cuerpo,
  };
}

export async function handleCorreoAgent(
  toolName: string,
  toolArgs: Record<string, unknown>,
  authUserId: string | undefined
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case 'leer_emails_recientes':
      return handleLeerEmailsRecientes(toolArgs, authUserId);
    case 'enviar_email':
      return handleEnviarEmail(toolArgs);
    default:
      return { error: `Tool de correo no soportada: ${toolName}` };
  }
}

export function capturarEmailPendiente(toolResult: unknown): EmailPendienteCliente | null {
  if (!toolResult || typeof toolResult !== 'object') return null;
  const o = toolResult as Record<string, unknown>;
  if (o.tipo !== 'email_pendiente_aprobacion') return null;
  if (
    typeof o.para !== 'string' ||
    typeof o.asunto !== 'string' ||
    typeof o.cuerpo !== 'string'
  ) {
    return null;
  }
  return {
    para: o.para,
    asunto: o.asunto,
    cuerpo: o.cuerpo,
  };
}
