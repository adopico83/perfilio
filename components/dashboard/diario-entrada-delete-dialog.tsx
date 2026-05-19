'use client';

type DiarioEntradaDeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
};

export default function DiarioEntradaDeleteDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
}: DiarioEntradaDeleteDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="diario-delete-title"
        aria-describedby="diario-delete-desc"
        className="w-full max-w-md rounded-xl border border-white/15 bg-[#E5DFD0] shadow-xl p-5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="diario-delete-title" className="text-lg font-semibold text-[#A04A2F]">
          Eliminar entrada
        </h2>
        <p id="diario-delete-desc" className="mt-3 text-sm text-white/85 leading-relaxed">
          ¿Eliminar esta entrada del diario? Esta acción no se puede deshacer
        </p>
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition-colors disabled:opacity-50 touch-manipulation"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className="min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 touch-manipulation"
          >
            {loading ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
