import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envía un email de alerta cuando llega un mensaje urgente.
 * Requiere RESEND_API_KEY en el entorno.
 */
export async function sendUrgencyAlert(
  to: string,
  messageContent: string,
  senderName: string,
  channel: string
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY no configurada');
    return { success: false, error: 'RESEND_API_KEY no configurada' };
  }

  const from = 'Perfilio <onboarding@resend.dev>';

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #1a365d;">🚨 Mensaje urgente en Perfilio</h2>
      <p><strong>Remitente:</strong> ${escapeHtml(senderName)}</p>
      <p><strong>Canal:</strong> ${escapeHtml(channel)}</p>
      <hr style="border: 1px solid #e2e8f0;" />
      <p><strong>Contenido del mensaje:</strong></p>
      <p style="background: #f7fafc; padding: 1rem; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(messageContent)}</p>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: '🚨 Mensaje urgente en Perfilio',
    html,
  });

  if (error) {
    console.error('Error enviando alerta de urgencia:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
}
