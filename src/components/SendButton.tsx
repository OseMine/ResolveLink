import { Send, Loader2, RefreshCw, AlertCircle, ChevronRight, CheckSquare, Square } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { ResolveClipData, ResolveSelection } from '../lib/api';

interface SendButtonProps {
  connected: boolean;
  resolveConnected: boolean;
  selection: ResolveSelection | null;
  selectionLoading: boolean;
  onSend: (clipData?: ResolveClipData[], settings?: any) => Promise<any>;
  onRefreshSelection: () => Promise<any>;
}

export function SendButton({
  connected,
  resolveConnected,
  selection,
  selectionLoading,
  onSend,
  onRefreshSelection,
}: SendButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // When new selection arrives, select all clips by default
  useEffect(() => {
    if (selection?.clips) {
      setSelectedIndices(new Set(selection.clips.map((_, i) => i)));
    }
  }, [selection]);

  const handleRefresh = async () => {
    setError(null);
    try {
      await onRefreshSelection();
    } catch {
      setError('Could not read selection from Resolve');
    }
  };

  const toggleClip = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!selection?.clips) return;
    if (selectedIndices.size === selection.clips.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(selection.clips.map((_, i) => i)));
    }
  };

  const handleSend = async () => {
    if (loading || !connected || !selection?.clips) return;
    setLoading(true);
    setError(null);
    try {
      const selectedClips = selection.clips.filter((_, i) => selectedIndices.has(i));
      if (selectedClips.length === 0) {
        setError('No clips selected');
        return;
      }
      await onSend(selectedClips);
    } catch (err: any) {
      setError(err.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  const clipCount = selection?.clipCount || 0;
  const selectedCount = selectedIndices.size;
  const hasSelection = clipCount > 0;

  return (
    <div className="space-y-3">
      {/* Connection + Selection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={`w-[6px] h-[6px] rounded-full ${resolveConnected ? 'bg-success' : 'bg-danger'}`} />
            <span className="text-[10px] text-r-300 font-medium">
              {resolveConnected ? 'Resolve' : 'No Resolve'}
            </span>
          </div>
          {selection?.timeline && (
            <>
              <span className="text-r-600 text-[10px]">/</span>
              <span className="text-[10px] text-r-400">{selection.timeline}</span>
            </>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={!resolveConnected || selectionLoading}
          className="btn-ghost !p-1.5"
          title="Refresh selection from Resolve"
        >
          <RefreshCw size={11} className={selectionLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Selection card */}
      {hasSelection && (
        <div className="card animate-slide-up !p-0 overflow-hidden">
          {/* Header with select all */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-r-700/50 bg-r-750/30">
            <button onClick={toggleAll} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {selectedCount === clipCount ? (
                <CheckSquare size={12} className="text-accent" />
              ) : selectedCount > 0 ? (
                <div className="w-3 h-3 rounded-sm bg-accent/50 border border-accent flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-accent rounded-[1px]" />
                </div>
              ) : (
                <Square size={12} className="text-r-500" />
              )}
              <span className="text-[11px] text-r-200 font-medium">
                {selectedCount}/{clipCount} clip{clipCount !== 1 ? 's' : ''}
              </span>
            </button>
            <span className="text-[10px] text-r-400 font-mono">
              {selection!.fps}fps &middot; {selection!.width}x{selection!.height}
            </span>
          </div>

          {/* Clip list with checkboxes */}
          <div className="divide-y divide-r-700/30 max-h-48 overflow-y-auto">
            {selection!.clips.map((clip, i) => (
              <button
                key={i}
                onClick={() => toggleClip(i)}
                className={`flex items-center justify-between w-full px-3 py-1.5 transition-colors text-left ${
                  selectedIndices.has(i) ? 'bg-accent/5 hover:bg-accent/10' : 'hover:bg-r-650/30 opacity-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {selectedIndices.has(i) ? (
                    <CheckSquare size={11} className="text-accent shrink-0" />
                  ) : (
                    <Square size={11} className="text-r-500 shrink-0" />
                  )}
                  <span className="text-[11px] text-r-200 truncate">{clip.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] font-mono text-r-500 bg-r-750 px-1.5 py-[1px] rounded">
                    T{clip.trackIndex}
                  </span>
                  <span className="text-[9px] font-mono text-r-500">
                    {clip.duration}f
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 animate-slide-down">
          <AlertCircle size={12} className="text-danger shrink-0" />
          <span className="text-[11px] text-danger/90">{error}</span>
        </div>
      )}

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!connected || loading || !hasSelection || selectedCount === 0}
        className="btn-primary w-full flex items-center justify-center gap-2.5"
      >
        {loading ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            <span>Sending to AE...</span>
          </>
        ) : (
          <>
            <Send size={15} />
            <span>
              {selectedCount > 0
                ? `Send ${selectedCount} clip${selectedCount !== 1 ? 's' : ''} to AE`
                : hasSelection
                  ? 'Select clips to send'
                  : 'Select clips in Resolve'}
            </span>
            {selectedCount > 0 && <ChevronRight size={14} className="opacity-50" />}
          </>
        )}
      </button>

      {/* Bridge status */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-1.5 text-[10px] text-r-400">
          <span className={`w-[5px] h-[5px] rounded-full ${connected ? 'bg-success' : 'bg-danger'}`} />
          {connected ? 'Bridge connected' : 'Bridge disconnected'}
        </div>
      </div>
    </div>
  );
}
