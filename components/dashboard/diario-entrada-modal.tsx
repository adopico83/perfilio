'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

export type DiarioObraEntry = {
  id: string;
  obra_nombre: string;
  obra_direccion: string | null;
  texto: string | null;
  fotos: string[] | null;
  videos: string[] | null;
  fecha: string;
};

type DiarioEntradaModalProps = {
  entrada: DiarioObraEntry;
  onClose: () => void;
};

export default function DiarioEntradaModal({ entrada, onClose }: DiarioEntradaModalProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fechaLarga = useMemo(
    () =>
      new Date(entrada.fecha).toLocaleString('es-ES', {
        dateStyle: 'full',
        timeStyle: 'short',
      }),
    [entrada.fecha]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxUrl) setLightboxUrl(null);
        else onClose();
      }
    },
    [lightboxUrl, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const fotos = entrada.fotos?.filter((u) => typeof u === 'string' && u.trim()) ?? [];
  const videos = entrada.videos?.filter((u) => typeof u === 'string' && u.trim()) ?? [];
  const texto = entrada.texto?.trim() ?? '';
  const sinContenido = !texto && fotos.length === 0 && videos.length === 0;

  return (
    <>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-[#A04A2F]/40 bg-[#E5DFD0] shadow-xl text-white overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diario-entrada-modal-titulo"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 px-4 py-3 sm:px-5 border-b border-white/10 pr-12">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 p-2 rounded-lg text-[#A04A2F] hover:bg-[#A04A2F]/15 border border-[#A04A2F]/50 transition-colors"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
            <h2 id="diario-entrada-modal-titulo" className="text-lg font-bold text-[#A04A2F] pr-2">
              {entrada.obra_nombre}
            </h2>
            {entrada.obra_direccion ? (
              <p className="text-sm text-white/55 mt-1">{entrada.obra_direccion}</p>
            ) : null}
            <p className="text-xs text-zinc-600 tabular-nums mt-2">{fechaLarga}</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 space-y-4">
            {sinContenido ? (
              <p className="text-sm text-white/55 text-center py-6">Entrada sin contenido</p>
            ) : (
              <>
                {texto ? (
                  <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{texto}</p>
                ) : null}

                {fotos.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {fotos.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setLightboxUrl(url)}
                        className="block w-full overflow-hidden rounded-lg border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A04A2F]/70"
                      >
                        <img
                          src={url}
                          alt=""
                          className="w-full h-[200px] object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}

                {videos.length > 0 ? (
                  <div className="space-y-3">
                    {videos.map((url) => (
                      <video
                        key={url}
                        src={url}
                        controls
                        className="w-full rounded-lg border border-white/10 bg-black"
                        controlsList="nodownload"
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 sm:px-5 border-t border-white/10 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[#A04A2F] text-[#A04A2F] hover:bg-[#A04A2F]/15 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black p-4"
          role="presentation"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-lg text-white border border-white/30 hover:bg-white/10 transition-colors z-10"
            aria-label="Cerrar imagen"
          >
            <X className="size-6" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-[min(92vh,900px)] w-auto h-auto object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
