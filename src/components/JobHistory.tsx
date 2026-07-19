import { useState, useEffect } from 'react';
import { Clock, Check, X, Send, Download, Upload } from 'lucide-react';
import { api, type JobHistoryEntry } from '../lib/api';

export function JobHistory() {
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getHistory().then(setHistory).catch(() => {});
  }, []);

  // Also listen for real-time updates via WebSocket
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:${window.location.port || 3030}`);
    ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data);
        if (type === 'job:history') setHistory(payload);
      } catch {}
    };
    ws.onclose = () => setTimeout(() => {}, 3000);
    return () => ws.close();
  }, []);

  if (history.length === 0) return null;

  const shown = expanded ? history : history.slice(0, 3);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="section-label">History</span>
        {history.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-r-500 hover:text-accent transition-colors"
          >
            {expanded ? 'Show less' : `+${history.length - 3} more`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {shown.map((entry, i) => (
          <HistoryRow key={`${entry.timestamp}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: JobHistoryEntry }) {
  const icons = {
    create: <Send size={10} />,
    render: <Download size={10} />,
    import: <Upload size={10} />,
  };
  const statusColors = {
    created: 'text-r-400',
    success: 'text-success',
    error: 'text-error',
  };
  const statusIcons = {
    created: <Clock size={9} />,
    success: <Check size={9} />,
    error: <X size={9} />,
  };
  const typeLabels = {
    create: 'Link created',
    render: 'Rendered',
    import: 'Imported to Resolve',
  };

  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-r-850 border border-r-700/30">
      <span className={`${statusColors[entry.status]}`}>{statusIcons[entry.status]}</span>
      <span className="text-r-500">{icons[entry.type]}</span>
      <span className="text-[11px] text-r-200 flex-1 truncate">{typeLabels[entry.type]}</span>
      {entry.clipCount !== undefined && (
        <span className="text-[10px] text-r-500 font-mono">{entry.clipCount} clips</span>
      )}
      <span className="text-[10px] text-r-500 font-mono">{time}</span>
    </div>
  );
}
