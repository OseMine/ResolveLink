import { useState, useEffect } from 'react';
import { Settings, FolderOpen, Check, AlertTriangle, RefreshCw, X, Music } from 'lucide-react';
import { api, type SetupConfig } from '../lib/api';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const [setup, setSetup] = useState<SetupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [pythonPath, setPythonPath] = useState('');
  const [aePath, setAePath] = useState('');
  const [reaperPath, setReaperPath] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [tempDir, setTempDir] = useState('');
  const [port, setPort] = useState('3030');
  const [host, setHost] = useState('127.0.0.1');
  const [scriptingPath, setScriptingPath] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setMessage('');
    api.getSetup()
      .then((data) => {
        setSetup(data);
        setPythonPath(data.config.pythonPath || data.detected.pythonPath || '');
        setAePath(data.config.aePath || data.detected.aePath || '');
        setReaperPath(data.config.reaperPath || data.detected.reaperPath || '');
        setExportDir(data.config.exportDir);
        setTempDir(data.config.tempDir);
        setPort(String(data.config.port));
        setHost(data.config.host);
        setScriptingPath(data.config.scriptingPath);
      })
      .catch(() => setError('Could not load the current configuration.'))
      .finally(() => setLoading(false));
  }, [open]);

  // Escape closes the wizard.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleSave = async () => {
    const portNumber = parseInt(port, 10);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError('Port must be a number between 1 and 65535.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await api.saveSetup({
        pythonPath,
        aePath,
        reaperPath,
        exportDir,
        tempDir,
        port: portNumber,
        host,
        scriptingPath,
      });
      setMessage(result.message || 'Configuration saved. Restart ResolveLink to apply the changes.');
    } catch (err: any) {
      setError(err.message || 'Could not save the configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleDetect = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getSetup();
      setSetup(data);
      if (data.detected.pythonPath) setPythonPath(data.detected.pythonPath);
      if (data.detected.aePath) setAePath(data.detected.aePath);
      if (data.detected.reaperPath) setReaperPath(data.detected.reaperPath);
    } catch {
      setError('Auto-detect failed. You can still enter the paths manually.');
    }
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[480px] max-h-[85vh] bg-r-800 rounded-xl border border-r-700/50 shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-r-700/50">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-accent" />
            <div>
              <span id="setup-title" className="text-sm font-semibold text-r-100 block">Setup</span>
              <span className="text-[10px] text-r-400">Tell ResolveLink where your apps live. Everything is optional — auto-detect usually finds it.</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDetect}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-r-300 hover:text-r-100 rounded bg-r-750 hover:bg-r-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
              Auto-detect
            </button>
            <button onClick={onClose} className="text-r-400 hover:text-r-200 p-0.5" aria-label="Close setup">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="text-center py-8 text-r-400 text-sm">Checking your system…</div>
          ) : (
            <>
              {setup && !setup.hasEnv && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-accent/10 border border-accent/20">
                  <AlertTriangle size={12} className="text-accent shrink-0 mt-[1px]" />
                  <p className="text-[10px] text-r-300 leading-snug">
                    This looks like your first run. We pre-filled what we could find — just press
                    <strong> Save</strong> to get started.
                  </p>
                </div>
              )}

              {/* Detection results */}
              {setup && (
                <div className="space-y-1.5">
                  <Detected label="Python" value={setup.detected.pythonPath} version={setup.detected.pythonVersion} />
                  <Detected label="After Effects" value={setup.detected.aePath} />
                  <Detected
                    label="REAPER (optional)"
                    value={setup.detected.reaperPath}
                    version={setup.detected.reaperVersion}
                    optional
                  />
                </div>
              )}

              <div className="h-px bg-r-700/50" />

              {/* Paths */}
              <Field
                label="Python"
                value={pythonPath}
                onChange={setPythonPath}
                placeholder="e.g. C:\Python312\python.exe"
                hint="Needed to read your Resolve timeline. Install Python 3.10 or newer if this is empty."
              />
              <Field
                label="After Effects"
                value={aePath}
                onChange={setAePath}
                placeholder="e.g. C:\Program Files\Adobe\Adobe After Effects 2026\Support Files"
                hint="The folder that contains AfterFX.exe (Windows) or the .app (macOS)."
              />
              <Field
                label="REAPER (optional)"
                value={reaperPath}
                onChange={setReaperPath}
                placeholder="e.g. C:\Program Files\REAPER"
                icon={<Music size={12} />}
                hint="Only needed for the audio round-trip workflow."
              />
              <Field
                label="Resolve scripting modules (advanced)"
                value={scriptingPath}
                onChange={setScriptingPath}
                placeholder="Auto-detected if empty"
                hint="Leave empty unless Resolve is installed in a custom location."
              />

              <div className="h-px bg-r-700/50" />

              {/* Server */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Port" value={port} onChange={setPort} placeholder="3030" />
                <Field label="Host" value={host} onChange={setHost} placeholder="127.0.0.1" />
              </div>

              {/* Directories */}
              <Field
                label="Exports folder"
                value={exportDir}
                onChange={setExportDir}
                placeholder="./exports"
                icon={<FolderOpen size={12} />}
                hint="Rendered files are detected here and imported back to Resolve."
              />
              <Field
                label="Temporary folder"
                value={tempDir}
                onChange={setTempDir}
                placeholder="./temp"
                icon={<FolderOpen size={12} />}
                hint="Generated scripts and payloads live here. Safe to clear."
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-r-700/50 flex items-center justify-between gap-3">
          <div className="text-[11px] min-w-0">
            {message && (
              <span className="text-success flex items-start gap-1 leading-snug">
                <Check size={12} className="mt-[1px] shrink-0" />
                <span>{message}</span>
              </span>
            )}
            {error && (
              <span className="text-danger flex items-start gap-1 leading-snug">
                <AlertTriangle size={12} className="mt-[1px] shrink-0" />
                <span>{error}</span>
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] text-r-300 hover:text-r-100 rounded bg-r-750 hover:bg-r-700 transition-colors"
            >
              {message ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-3 py-1.5 text-[11px] font-medium text-white rounded bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detected({
  label,
  value,
  version,
  optional,
}: {
  label: string;
  value: string | null;
  version?: string | null;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-r-750 border border-r-700/30">
      {value ? (
        <Check size={12} className="text-success shrink-0" />
      ) : (
        <AlertTriangle size={12} className={optional ? 'text-r-500 shrink-0' : 'text-warn shrink-0'} />
      )}
      <span className="text-[11px] text-r-300">{label}:</span>
      <span className="text-[11px] text-r-100 font-mono truncate flex-1" title={value || undefined}>
        {value || (optional ? 'Not installed' : 'Not found')}{version ? ` (v${version})` : ''}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-r-400 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-r-850 border border-r-700/50 focus-within:border-accent/50 transition-colors">
        {icon && <span className="text-r-500">{icon}</span>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="flex-1 bg-transparent text-[12px] text-r-100 font-mono placeholder:text-r-600 outline-none"
        />
      </div>
      {hint && <p className="text-[10px] text-r-500 leading-snug">{hint}</p>}
    </div>
  );
}
