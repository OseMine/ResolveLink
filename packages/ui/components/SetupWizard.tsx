import { useState, useEffect } from 'react';
import { Settings, FolderOpen, Check, AlertTriangle, RefreshCw } from 'lucide-react';
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
  const [exportDir, setExportDir] = useState('');
  const [tempDir, setTempDir] = useState('');
  const [port, setPort] = useState('3030');
  const [host, setHost] = useState('127.0.0.1');
  const [scriptingPath, setScriptingPath] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getSetup()
      .then((data) => {
        setSetup(data);
        setPythonPath(data.config.pythonPath || data.detected.pythonPath || '');
        setAePath(data.config.aePath || data.detected.aePath || '');
        setExportDir(data.config.exportDir);
        setTempDir(data.config.tempDir);
        setPort(String(data.config.port));
        setHost(data.config.host);
        setScriptingPath(data.config.scriptingPath);
      })
      .catch(() => setError('Failed to load setup'))
      .finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await api.saveSetup({
        pythonPath,
        aePath,
        exportDir,
        tempDir,
        port: parseInt(port) || 3030,
        host,
        scriptingPath,
      });
      setMessage(result.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDetect = async () => {
    setLoading(true);
    try {
      const data = await api.getSetup();
      setSetup(data);
      if (data.detected.pythonPath) setPythonPath(data.detected.pythonPath);
      if (data.detected.aePath) setAePath(data.detected.aePath);
    } catch {}
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] max-h-[80vh] bg-r-800 rounded-xl border border-r-700/50 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-r-700/50">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-accent" />
            <span className="text-sm font-semibold text-r-100">Setup Wizard</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDetect}
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-r-300 hover:text-r-100 rounded bg-r-750 hover:bg-r-700 transition-colors"
            >
              <RefreshCw size={10} />
              Auto-detect
            </button>
            <button onClick={onClose} className="text-r-400 hover:text-r-200 text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="text-center py-8 text-r-400 text-sm">Loading...</div>
          ) : (
            <>
              {/* Detection results */}
              {setup && (
                <div className="space-y-1.5">
                  <Detected label="Python" value={setup.detected.pythonPath} version={setup.detected.pythonVersion} />
                  <Detected label="After Effects" value={setup.detected.aePath} />
                </div>
              )}

              <div className="h-px bg-r-700/50" />

              {/* Paths */}
              <Field label="Python Path" value={pythonPath} onChange={setPythonPath} placeholder="e.g. C:\Python314\python.exe" />
              <Field label="After Effects Path" value={aePath} onChange={setAePath} placeholder="e.g. C:\Program Files\Adobe\Adobe After Effects 2026\Support Files" />
              <Field label="Resolve Scripting Modules" value={scriptingPath} onChange={setScriptingPath} placeholder="Auto-detected if empty" />

              <div className="h-px bg-r-700/50" />

              {/* Server */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Port" value={port} onChange={setPort} placeholder="3030" />
                <Field label="Host" value={host} onChange={setHost} placeholder="127.0.0.1" />
              </div>

              {/* Directories */}
              <Field label="Export Directory" value={exportDir} onChange={setExportDir} placeholder="./exports" icon={<FolderOpen size={12} />} />
              <Field label="Temp Directory" value={tempDir} onChange={setTempDir} placeholder="./temp" icon={<FolderOpen size={12} />} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-r-700/50 flex items-center justify-between">
          <div className="text-[11px]">
            {message && <span className="text-success flex items-center gap-1"><Check size={12} /> {message}</span>}
            {error && <span className="text-error flex items-center gap-1"><AlertTriangle size={12} /> {error}</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-r-300 hover:text-r-100 rounded bg-r-750 hover:bg-r-700 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-[11px] font-medium text-r-900 rounded bg-accent hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save & Restart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detected({ label, value, version }: { label: string; value: string | null; version?: string | null }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-r-750 border border-r-700/30">
      {value ? (
        <Check size={12} className="text-success shrink-0" />
      ) : (
        <AlertTriangle size={12} className="text-warning shrink-0" />
      )}
      <span className="text-[11px] text-r-300">{label}:</span>
      <span className="text-[11px] text-r-100 font-mono truncate flex-1">
        {value || 'Not found'}{version ? ` (v${version})` : ''}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
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
          className="flex-1 bg-transparent text-[12px] text-r-100 font-mono placeholder:text-r-600 outline-none"
        />
      </div>
    </div>
  );
}
