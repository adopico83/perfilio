import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nombre, apellido, telefono, email } = body;

    if (!nombre || !apellido || !telefono || !email) {
      return NextResponse.json(
        { error: 'Faltan campos: nombre, apellido, telefono, email' },
        { status: 400 }
      );
    }

    const to = process.env.NOTIFICATION_EMAIL ?? process.env.RESEND_TO_EMAIL;
    if (!to) {
      return NextResponse.json(
        { error: 'NOTIFICATION_EMAIL o RESEND_TO_EMAIL no configurado' },
        { status: 500 }
      );
    }

    const from = process.env.RESEND_FROM ?? 'Perfilio <onboarding@resend.dev>';
    const now = new Date();
    const fechaHora = now.toLocaleString('es-ES', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const { data, error } = await resend.emails.send({
      from: from as string,
      to: [to],
      subject: '🎉 Nuevo contacto en lista de espera — Perfilio',
      html: `
        <h2>Nuevo contacto en la lista de espera</h2>
        <p><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
        <p><strong>Apellido:</strong> ${escapeHtml(apellido)}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(telefono)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Fecha y hora:</strong> ${escapeHtml(fechaHora)}</p>
      `,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error enviando notificación' },
      { status: 500 }
    );
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (c) => map[c] ?? c);
}
