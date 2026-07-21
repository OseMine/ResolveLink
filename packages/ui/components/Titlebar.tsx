import { Minus, X, Settings } from 'lucide-react';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      close: () => void;
    };
  }
}

export function Titlebar({ onSetup }: { onSetup?: () => void }) {
  return (
    <div className="titlebar-drag flex items-center justify-between h-10 bg-r-900 border-b border-r-700/50 px-3 shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="w-2.5 h-2.5 rounded-full bg-accent" />
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-accent animate-pulse-dot opacity-40" />
        </div>
        <span className="text-[11px] font-bold tracking-[0.15em] text-r-200 uppercase">
          ResolveLink
        </span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-0.5">
        {onSetup && (
          <button
            onClick={onSetup}
            title="Setup Wizard"
            className="p-1.5 rounded-md text-r-400 hover:text-r-200 hover:bg-r-650 transition-all duration-150"
          >
            <Settings size={13} strokeWidth={2.5} />
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="p-1.5 rounded-md text-r-400 hover:text-r-200 hover:bg-r-650 transition-all duration-150"
        >
          <Minus size={13} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="p-1.5 rounded-md text-r-400 hover:text-white hover:bg-danger/30 transition-all duration-150"
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
