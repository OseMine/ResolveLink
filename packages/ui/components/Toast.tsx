import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

type Listener = (items: ToastItem[]) => void;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener(items));
}

/**
 * Show a short, plain-language notification. Safe to call from anywhere,
 * including non-React helpers.
 */
export function toast(kind: ToastKind, title: string, description?: string) {
  const id = nextId++;
  items = [...items, { id, kind, title, description }];
  emit();

  const timer = setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4500);
  timers.set(id, timer);
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
}

export function ToastViewport() {
  const [visible, setVisible] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next) => setVisible(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      className="fixed bottom-3 left-3 right-3 z-[60] flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {visible.map((item) => {
        const palette =
          item.kind === 'success'
            ? { border: 'border-success/30', bg: 'bg-success/10', text: 'text-success', icon: <CheckCircle2 size={14} /> }
            : item.kind === 'error'
              ? { border: 'border-danger/30', bg: 'bg-danger/10', text: 'text-danger', icon: <AlertCircle size={14} /> }
              : { border: 'border-accent/30', bg: 'bg-accent/10', text: 'text-accent', icon: <Info size={14} /> };

        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border ${palette.border} ${palette.bg} px-3 py-2.5 shadow-card animate-slide-up backdrop-blur-sm`}
          >
            <span className={`${palette.text} shrink-0 mt-[1px]`}>{palette.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-semibold ${palette.text}`}>{item.title}</p>
              {item.description && (
                <p className="text-[10px] text-r-300 leading-snug mt-0.5">{item.description}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(item.id)}
              className="p-0.5 text-r-400 hover:text-r-200 transition-colors shrink-0"
              aria-label="Dismiss notification"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
