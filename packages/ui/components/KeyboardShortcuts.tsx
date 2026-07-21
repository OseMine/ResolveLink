import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onRefresh?: () => void;
  onSend?: () => void;
  onToggleTools?: () => void;
  onSetup?: () => void;
  onClearExports?: () => void;
  onClearTemp?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    // Don't capture when typing in inputs
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

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
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
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
