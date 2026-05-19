'use client';

import { X } from 'lucide-react';
import { useEmailModal } from '@/contexts/email-modal-context';

function formatEmailFecha(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export default function UrgentesModal() {
  const { urgentesOpen, urgentes, cerrarUrgentes, abrirEmail } = useEmailModal();

  if (!urgentesOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[109] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={cerrarUrgentes}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-[#A04A2F]/40 bg-[#E5DFD0] shadow-xl text-white overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="urgentes-modal-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <h2 id="urgentes-modal-titulo" className="text-lg font-semibold text-[#A04A2F] pr-8">
            Emails urgentes
          </h2>
          <button
            type="button"
            onClick={cerrarUrgentes}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-[#A04A2F] hover:bg-[#A04A2F]/15 border border-[#A04A2F]/50 transition-colors"
            aria-label="Cerrar urgentes"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {urgentes.length === 0 ? (
            <p className="text-sm text-zinc-600">No hay emails urgentes.</p>
          ) : (
            <ul className="space-y-2">
              {urgentes.map((email, idx) => (
                <li key={`${email.fechaIso ?? ''}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => abrirEmail(email)}
                    className="w-full text-left rounded-lg border border-white/10 bg-[#EFEADF]/50 hover:bg-[#A04A2F]/10 px-3 py-2 transition-colors"
                  >
                    <p className="text-sm font-semibold text-white truncate">
                      {email.remitente?.trim() || '(Sin remitente)'}
                    </p>
                    <p className="text-sm text-white/85 line-clamp-2 mt-0.5">
                      {email.asunto?.trim() || '(Sin asunto)'}
                    </p>
                    <p className="text-[11px] text-[#A04A2F] mt-1 tabular-nums">
                      {formatEmailFecha(email.fechaIso)}
                    </p>
                    {Array.isArray(email.motivoUrgencia) && email.motivoUrgencia.length > 0 ? (
                      <p className="text-[11px] text-red-200 mt-1">
                        Motivo: {email.motivoUrgencia.join(', ')}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
