import { useEffect, useState, useCallback } from 'react';
import { Sun, Moon, Lightbulb, Zap, Target, Settings, Keyboard, ArrowRight } from 'lucide-react';
import { toast } from './Toast';

type Theme = 'dark' | 'light';

const TIPS = [
  'Press <kbd>?</kbd> anytime to see all keyboard shortcuts.',
  'Ctrl+Enter sends selected clips to After Effects instantly.',
  'Ctrl+Shift+R refreshes your Resolve selection without leaving the app.',
  'Enable "Auto-import after render" in Settings to skip the manual import step.',
  'Use Stem Export in Settings to render each track as a separate WAV file.',
  'The System Check panel (in Tools) shows real-time status of all connections.',
  'Right-click any link in the queue for quick actions like "Render again" or "Show in Explorer".',
  'Drag the window by the titlebar — it\'s frameless for a clean look.',
  'Auto-connect on startup saves you a click when launching REAPER.',
  'Check Job History for detailed error messages if something fails.',
  'Stem Export renders each track separately — perfect for mixing in REAPER.',
  'Markers from your Resolve timeline transfer automatically to AE compositions.',
  'Use the Update Project script in REAPER to sync timeline changes from Resolve.',
  'The native REAPER panel (C++ extension) provides sub-millisecond job delivery.',
  'Auto-import-back sends rendered audio to Resolve without any clicks.',
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme | null;
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="btn-ghost p-1.5"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function RandomTip({ onDismiss }: { onDismiss?: () => void }) {
  const [tip, setTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const [visible, setVisible] = useState(true);

  const showNewTip = useCallback(() => {
    setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, 10000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-accent/10 border border-accent/20 animate-slide-up">
      <Lightbulb size={14} className="text-accent shrink-0 mt-[1px]" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-r-100">Tip of the Day</p>
        <p className="text-[10px] text-r-300 leading-relaxed mt-0.5" dangerouslySetInnerHTML={{ __html: tip }} />
      </div>
      <button
        onClick={showNewTip}
        className="p-0.5 text-r-400 hover:text-r-200 transition-colors shrink-0"
        aria-label="Show another tip"
        title="Show another tip"
      >
        <Zap size={12} />
      </button>
      <button
        onClick={() => setVisible(false)}
        className="p-0.5 text-r-400 hover:text-r-200 transition-colors shrink-0 ml-1"
        aria-label="Dismiss tip"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}