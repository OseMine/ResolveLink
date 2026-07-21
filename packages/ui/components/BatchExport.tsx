import { useState, useEffect } from 'react';
import { Layers, Loader2, Check, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

interface BatchExportProps {
  resolveConnected: boolean;
}

export function BatchExport({ resolveConnected }: BatchExportProps) {
  const [timelines, setTimelines] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadTimelines = async () => {
    if (!resolveConnected) return;
    setLoading(true);
    setError(null);
    try {
      const tl = await api.resolveTimeline();
      if (tl && 'tracks' in tl) {
        // We only have the current timeline name, prompt user to enter names
        // or fetch from a dedicated endpoint
        setTimelines([tl.name]);
        setLoaded(true);
      }
    } catch {
      setError('Could not read timeline info from Resolve');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const runBatch = async () => {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.batchExport(Array.from(selected));
      setResult({ total: data.total, created: data.created });
    } catch (err: any) {
      setError(err.message || 'Batch export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="section-label">Batch Export</span>
        <button
          onClick={loadTimelines}
          disabled={!resolveConnected || loading}
          className="btn-ghost !p-1"
          title="Load current timeline"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <Layers size={11} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-danger/10 border border-danger/20">
          <AlertCircle size={10} className="text-danger shrink-0" />
          <span className="text-[10px] text-danger/90">{error}</span>
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-success/10 border border-success/20">
          <Check size={10} className="text-success shrink-0" />
          <span className="text-[10px] text-success">
            Sent {result.created}/{result.total} timeline{result.total !== 1 ? 's' : ''} to AE
          </span>
        </div>
      )}

      {loaded && (
        <>
          <div className="space-y-1">
            {timelines.map((name) => (
              <button
                key={name}
                onClick={() => toggle(name)}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left transition-colors ${
                  selected.has(name)
                    ? 'bg-accent/10 border border-accent/30'
                    : 'bg-r-850 border border-r-700/30 hover:bg-r-750'
                }`}
              >
                <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                  selected.has(name) ? 'bg-accent border-accent' : 'border-r-600'
                }`}>
                  {selected.has(name) && <Check size={8} className="text-white" />}
                </div>
                <span className="text-[11px] text-r-200 truncate">{name}</span>
              </button>
            ))}
          </div>

          <button
            onClick={runBatch}
            disabled={selected.size === 0 || loading}
            className="btn-primary w-full !py-2 !text-[11px] flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Layers size={12} />
            )}
            <span>Send {selected.size || ''} Timeline{selected.size !== 1 ? 's' : ''} to AE</span>
          </button>
        </>
      )}

      {!loaded && !error && (
        <p className="text-[10px] text-r-500 text-center py-1">
          Load timelines to send multiple at once
        </p>
      )}
    </div>
  );
}
