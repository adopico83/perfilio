'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useEmailModal } from '@/contexts/email-modal-context';

function formatEmailFecha(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export default function EmailModal() {
  const router = useRouter();
  const { emailOpen, emailActual, cerrarEmail } = useEmailModal();

  if (!emailOpen || !emailActual) return null;

  const remitente = emailActual.remitente?.trim() || '(Sin remitente)';
  const asunto = emailActual.asunto?.trim() || '(Sin asunto)';
  const cuerpo = emailActual.cuerpo?.trim() || 'Sin contenido adicional disponible.';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={cerrarEmail}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-[#A04A2F]/40 bg-[#E5DFD0] shadow-xl text-white overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-modal-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <h2 id="email-modal-titulo" className="text-lg font-semibold text-[#A04A2F] pr-8">
            Email
          </h2>
          <button
            type="button"
            onClick={cerrarEmail}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-[#A04A2F] hover:bg-[#A04A2F]/15 border border-[#A04A2F]/50 transition-colors"
            aria-label="Cerrar email"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <p className="text-sm text-zinc-700">
            <span className="font-semibold text-white">Remitente:</span> {remitente}
          </p>
          <p className="text-xs text-[#A04A2F] tabular-nums">{formatEmailFecha(emailActual.fechaIso)}</p>
          <p className="text-base font-semibold text-white">{asunto}</p>
          <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed">{cuerpo}</p>
        </div>

        <div className="px-4 py-3 border-t border-white/10 shrink-0 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              cerrarEmail();
              const msg = `responde al email de ${remitente} sobre ${asunto}`;
              router.push(`/agente?mensaje=${encodeURIComponent(msg)}`);
            }}
            className="px-4 py-2 rounded-lg border border-[#A04A2F] text-[#A04A2F] hover:bg-[#A04A2F]/10 transition-colors text-sm font-medium"
          >
            Responder
          </button>
        </div>
      </div>
    </div>
  );
}
