import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort safety net: instead of a blank window, explain what happened and
 * offer a reload button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ResolveLink] UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center h-full p-6 bg-r-900 text-center">
        <div className="w-12 h-12 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-4">
          <AlertTriangle size={22} className="text-danger" />
        </div>
        <p className="text-[13px] font-semibold text-r-100">Something went wrong</p>
        <p className="text-[11px] text-r-400 max-w-[260px] leading-relaxed mt-1.5">
          ResolveLink hit an unexpected problem. Reloading usually fixes it — your links are stored on the bridge server.
        </p>
        <p className="text-[10px] font-mono text-r-500 mt-3 max-w-[280px] break-words">
          {this.state.error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary flex items-center gap-2 mt-5"
        >
          <RotateCcw size={13} />
          Reload ResolveLink
        </button>
      </div>
    );
  }
}
