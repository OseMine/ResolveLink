import { useState } from 'react';
import { MapPin, Loader2, AlertCircle } from 'lucide-react';
import { api, type TimelineMarker } from '../lib/api';

export function TimelineMarkers({ resolveConnected }: { resolveConnected: boolean }) {
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [timeline, setTimeline] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadMarkers = async () => {
    if (!resolveConnected || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMarkers();
      setMarkers(data.markers || []);
      setTimeline(data.timeline || '');
      setFps(data.fps || 0);
      setLoaded(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load markers');
    } finally {
      setLoading(false);
    }
  };

  const frameToTC = (frame: number) => {
    if (!fps) return `${frame}f`;
    const totalSec = frame / fps;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    const f = Math.round(frame % fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2">
      <button
        onClick={loadMarkers}
        disabled={!resolveConnected || loading}
        className="btn-ghost w-full flex items-center justify-center gap-2 text-[11px]"
      >
        {loading ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <MapPin size={11} />
        )}
        <span>{loaded ? 'Refresh Markers' : 'Load Timeline Markers'}</span>
      </button>

      {error && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-danger/10 border border-danger/20">
          <AlertCircle size={10} className="text-danger shrink-0" />
          <span className="text-[10px] text-danger/90">{error}</span>
        </div>
      )}

      {loaded && markers.length === 0 && !error && (
        <p className="text-[10px] text-r-400 text-center py-2">No markers on this timeline</p>
      )}

      {loaded && markers.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-r-400 truncate">{timeline}</span>
            <span className="text-[10px] text-r-500 font-mono">{markers.length} markers</span>
          </div>
          <div className="divide-y divide-r-700/30 max-h-40 overflow-y-auto rounded bg-r-850 border border-r-700/30">
            {markers.map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: m.color || '#666' }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-r-200 truncate block">{m.name || m.note || 'Marker'}</span>
                </div>
                <span className="text-[9px] font-mono text-r-500 shrink-0">{frameToTC(m.frame)}</span>
                {m.clipName && (
                  <span className="text-[9px] font-mono text-r-500 bg-r-750 px-1 py-[1px] rounded shrink-0 truncate max-w-20">
                    {m.clipName}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
