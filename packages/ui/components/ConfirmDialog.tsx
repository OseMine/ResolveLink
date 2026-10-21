import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-[340px] bg-r-800 rounded-xl border border-r-700/60 shadow-2xl overflow-hidden animate-slide-up"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <div className={`p-1.5 rounded-md shrink-0 ${tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>
            <AlertTriangle size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p id="confirm-title" className="text-[12px] font-semibold text-r-100">{title}</p>
            <p className="text-[11px] text-r-300 leading-relaxed mt-1">{message}</p>
          </div>
          <button
            onClick={onCancel}
            className="p-0.5 text-r-400 hover:text-r-200 transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-r-850/60 border-t border-r-700/40">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] text-r-300 hover:text-r-100 rounded-md bg-r-750 hover:bg-r-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-3 py-1.5 text-[11px] font-medium text-white rounded-md transition-colors ${
              tone === 'danger' ? 'bg-danger hover:bg-danger/85' : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
