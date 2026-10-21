import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Circle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api, type Diagnostics } from '../lib/api';

interface SystemCheckProps {
  connected: boolean;
  resolveConnected: boolean;
}

type CheckState = 'ok' | 'warn' | 'missing' | 'optional';

interface CheckRow {
  key: string;
  label: string;
  state: CheckState;
  value: string;
  hint?: string;
}

function basename(value: string | null): string {
  if (!value) return '';
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value;
}

export function SystemCheck({ connected, resolveConnected }: SystemCheckProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDiagnostics();
      setDiagnostics(data);
      setCheckedAt(new Date());
    } catch (err: any) {
      setError(err?.message || 'Could not run the system check');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const ae = diagnostics?.integrations?.ae;
  const reaper = diagnostics?.integrations?.reaper;
  const python = diagnostics?.python;
  const exportDir = diagnostics?.paths?.exportDir;
  const tempDir = diagnostics?.paths?.tempDir;

  const rows: CheckRow[] = [
    {
      key: 'bridge',
      label: 'ResolveLink bridge',
      state: connected ? 'ok' : 'warn',
      value: connected ? 'Connected' : 'Reconnecting…',
      hint: connected ? undefined : 'The background server is not reachable. Start ResolveLink again.',
    },
    {
      key: 'resolve',
      label: 'DaVinci Resolve',
      state: resolveConnected ? 'ok' : 'warn',
      value: resolveConnected ? 'Connected' : 'Not detected',
      hint: resolveConnected
        ? undefined
        : 'Open DaVinci Resolve, then enable Preferences → System → General → External scripting using → Local.',
    },
    {
      key: 'python',
      label: 'Python',
      state: python ? (python.found && python.supported ? 'ok' : 'missing') : 'warn',
      value: python ? (python.version || python.command) : 'Checking…',
      hint: python && !python.found
        ? 'Install Python 3.10 or newer and add it to PATH, then reopen ResolveLink.'
        : python && !python.supported
          ? 'ResolveLink needs Python 3.10 or newer.'
          : undefined,
    },
    {
      key: 'ae',
      label: 'After Effects',
      state: ae?.available ? 'ok' : 'missing',
      value: ae?.available ? basename(ae.installPath) : 'Not found',
      hint: ae?.available ? undefined : 'Install Adobe After Effects, or set its folder in Setup.',
    },
    {
      key: 'reaper',
      label: 'REAPER (optional)',
      state: reaper?.available ? 'ok' : 'optional',
      value: reaper?.available ? basename(reaper.installPath) : 'Not installed',
      hint: reaper?.available ? undefined : 'Only needed for the audio round-trip workflow.',
    },
    {
      key: 'folders',
      label: 'Working folders',
      state: exportDir?.writable && tempDir?.writable ? 'ok' : 'missing',
      value: exportDir?.writable && tempDir?.writable ? 'Writable' : 'Permission problem',
      hint: exportDir?.writable && tempDir?.writable
        ? undefined
        : 'ResolveLink cannot write to its exports or temp folder. Check folder permissions in Setup.',
    },
  ];

  const problems = rows.filter((row) => row.state === 'warn' || row.state === 'missing');
  const summary = problems.length === 0 ? 'Everything looks good' : `${problems.length} item${problems.length === 1 ? '' : 's'} need attention`;

  const iconFor = (state: CheckState) => {
    if (state === 'ok') return <CheckCircle2 size={12} className="text-success shrink-0" />;
    if (state === 'warn') return <AlertTriangle size={12} className="text-warn shrink-0" />;
    if (state === 'missing') return <AlertTriangle size={12} className="text-danger shrink-0" />;
    return <Circle size={10} className="text-r-500 shrink-0" />;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1.5 min-w-0"
          aria-expanded={expanded}
        >
          <span className="section-label">System Check</span>
          <span
            className={`text-[9px] font-medium px-1.5 py-[1px] rounded ${
              problems.length === 0
                ? 'bg-success/10 text-success'
                : 'bg-warn/10 text-warn'
            }`}
          >
            {summary}
          </span>
          {expanded ? <ChevronUp size={10} className="text-r-500" /> : <ChevronDown size={10} className="text-r-500" />}
        </button>
        <button
          onClick={runCheck}
          disabled={loading}
          className="btn-ghost !p-1"
          title="Run the system check again"
          aria-label="Run the system check again"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-danger/10 border border-danger/20">
          <AlertTriangle size={11} className="text-danger shrink-0 mt-[1px]" />
          <div className="min-w-0">
            <p className="text-[10px] text-danger/90 leading-snug">{error}</p>
            <button onClick={runCheck} className="text-[10px] text-accent hover:underline mt-1">
              Try again
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-1 animate-slide-up">
          {rows.map((row) => (
            <div key={row.key} className="px-2.5 py-1.5 rounded bg-r-850 border border-r-700/30">
              <div className="flex items-center gap-2">
                {iconFor(row.state)}
                <span className="text-[11px] text-r-200 flex-1 truncate">{row.label}</span>
                <span className="text-[9px] font-mono text-r-400 truncate max-w-[110px]" title={row.value}>
                  {row.value}
                </span>
              </div>
              {row.hint && (
                <p className="text-[10px] text-r-400 leading-snug mt-1 pl-[18px]">{row.hint}</p>
              )}
            </div>
          ))}

          {checkedAt && (
            <p className="text-[9px] text-r-500 text-center pt-0.5">
              Checked {checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {diagnostics ? ` · v${diagnostics.app.version}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
