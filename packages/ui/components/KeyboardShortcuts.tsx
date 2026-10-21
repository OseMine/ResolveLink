import { useEffect, useCallback, useState } from 'react';

interface ShortcutHandlers {
  onRefresh?: () => void;
  onSend?: () => void;
  onToggleTools?: () => void;
  onSetup?: () => void;
  onClearExports?: () => void;
  onClearTemp?: () => void;
}

const SHORTCUTS = [
  { key: 'Ctrl+Shift+R', desc: 'Refresh selection from Resolve' },
  { key: 'Ctrl+Enter', desc: 'Send to After Effects' },
  { key: 'Ctrl+T', desc: 'Toggle tools panel' },
  { key: 'Ctrl+,', desc: 'Open setup wizard' },
  { key: 'Ctrl+Shift+E', desc: 'Clear exports folder' },
  { key: 'Ctrl+Shift+D', desc: 'Clear temp folder' },
  { key: '?', desc: 'Show this cheat sheet' },
] as const;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    // Don't capture when typing in inputs (except for ? key)
    const isInput = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';

    // ? key - toggle cheat sheet (always works)
    if (key === '?') {
      e.preventDefault();
      setCheatSheetOpen(!cheatSheetOpen);
      return;
    }

    // Escape - close cheat sheet
    if (key === 'escape') {
      setCheatSheetOpen(false);
      return;
    }

    // Don't capture other keys when typing in inputs
    if (isInput) return;

    // Ctrl+Shift+R — Refresh selection from Resolve
    if (ctrl && shift && key === 'r') {
      e.preventDefault();
      handlers.onRefresh?.();
      return;
    }

    // Ctrl+Enter — Send to AE
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      handlers.onSend?.();
      return;
    }

    // Ctrl+T — Toggle tools panel
    if (ctrl && key === 't') {
      e.preventDefault();
      handlers.onToggleTools?.();
      return;
    }

    // Ctrl+, — Open setup wizard
    if (ctrl && key === ',') {
      e.preventDefault();
      handlers.onSetup?.();
      return;
    }

    // Ctrl+Shift+E — Clear exports
    if (ctrl && shift && key === 'e') {
      e.preventDefault();
      handlers.onClearExports?.();
      return;
    }

    // Ctrl+Shift+D — Clear temp
    if (ctrl && shift && key === 'd') {
      e.preventDefault();
      handlers.onClearTemp?.();
      return;
    }
  }, [handlers, cheatSheetOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { cheatSheetOpen, setCheatSheetOpen };
}

// ─── Cheat Sheet Overlay ───

export function CheatSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cheat-sheet-title"
    >
      <div
        className="w-full max-w-[420px] bg-r-800 rounded-xl border border-r-700/50 shadow-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-r-700/50">
          <span id="cheat-sheet-title" className="text-sm font-semibold text-r-100">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-r-400 hover:text-r-200 p-0.5" aria-label="Close cheat sheet">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4 px-2 py-2 rounded-lg hover:bg-r-750/50 transition-colors">
              <span className="text-[11px] text-r-300 font-medium truncate">{desc}</span>
              <kbd className="font-mono bg-r-750 px-2.5 py-1 rounded text-r-100 border border-r-700/50 text-[10px] shrink-0">
                {key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-r-700/50 text-center">
          <p className="text-[10px] text-r-500">Press <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded border border-r-700/50">?</kbd> or <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded border border-r-700/50">Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
}

export function ShortcutHint() {
  return (
    <div className="space-y-1.5">
      <span className="section-label">Keyboard Shortcuts</span>
      <div className="space-y-1 text-[10px]">
        <div className="flex justify-between text-r-400">
          <span>Refresh selection</span>
          <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded text-r-300 border border-r-700/50">Ctrl+Shift+R</kbd>
        </div>
        <div className="flex justify-between text-r-400">
          <span>Send to AE</span>
          <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded text-r-300 border border-r-700/50">Ctrl+Enter</kbd>
        </div>
        <div className="flex justify-between text-r-400">
          <span>Toggle tools</span>
          <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded text-r-300 border border-r-700/50">Ctrl+T</kbd>
        </div>
        <div className="flex justify-between text-r-400">
          <span>Setup wizard</span>
          <kbd className="font-mono bg-r-750 px-1.5 py-0.5 rounded text-r-300 border border-r-700/50">Ctrl+,</kbd>
        </div>
      </div>
    </div>
  );
}