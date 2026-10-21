import { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Check } from 'lucide-react';
import { api, type RenderPreset } from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { toast } from './Toast';

export function RenderPresets({ currentPreset, onSelect }: { currentPreset?: string; onSelect?: (name: string) => void }) {
  const [presets, setPresets] = useState<RenderPreset[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    api.getPresets().then((data) => setPresets(data.presets || [])).catch(() => {});
  }, []);

  const savePreset = async () => {
    if (!newName.trim()) return;
    try {
      await api.savePreset({ name: newName.trim(), template: newTemplate.trim() || undefined });
      const data = await api.getPresets();
      setPresets(data.presets || []);
      setNewName('');
      setNewTemplate('');
      setShowForm(false);
      toast('success', 'Preset saved', `"${newName.trim()}" is ready to use.`);
    } catch (err: any) {
      toast('error', 'Could not save preset', err?.message || 'Please try again.');
    }
  };

  const deletePreset = async (name: string) => {
    try {
      await api.deletePreset(name);
      setPresets((prev) => prev.filter((p) => p.name !== name));
      if (currentPreset === name) onSelect?.('');
      toast('info', 'Preset removed', `"${name}" was deleted.`);
    } catch (err: any) {
      toast('error', 'Could not delete preset', err?.message || 'Please try again.');
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="section-label">Render Presets</span>
        <button onClick={() => setShowForm(!showForm)} className="btn-ghost !p-1">
          <Plus size={11} />
        </button>
      </div>

      {showForm && (
        <div className="card !p-2 space-y-2 animate-slide-up">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Preset name"
            className="w-full bg-r-750 border border-r-700/50 rounded px-2.5 py-1.5 text-[11px] text-r-200 placeholder:text-r-500 outline-none focus:border-accent/50 transition-colors"
          />
          <input
            type="text"
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value)}
            placeholder="AE render template (optional)"
            className="w-full bg-r-750 border border-r-700/50 rounded px-2.5 py-1.5 text-[11px] text-r-200 placeholder:text-r-500 outline-none focus:border-accent/50 transition-colors"
          />
          <div className="flex gap-2">
            <button onClick={savePreset} disabled={!newName.trim()} className="btn-primary !py-1.5 !text-[11px] flex-1">
              Save
            </button>
            <button onClick={() => setShowForm(false)} className="btn-ghost !text-[11px]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {presets.length === 0 && !showForm && (
        <p className="text-[10px] text-r-500 text-center py-1">No presets saved</p>
      )}

      {presets.map((preset) => (
        <div key={preset.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-r-850 border border-r-700/30">
          <button
            onClick={() => onSelect?.(preset.name)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            {currentPreset === preset.name ? (
              <Check size={10} className="text-accent shrink-0" />
            ) : (
              <Settings size={10} className="text-r-500 shrink-0" />
            )}
            <span className="text-[11px] text-r-200 truncate">{preset.name}</span>
            {preset.template && (
              <span className="text-[9px] font-mono text-r-500 truncate">{preset.template}</span>
            )}
          </button>
          <button
            onClick={() => setPendingDelete(preset.name)}
            className="p-1 text-r-500 hover:text-danger transition-colors"
            title={`Delete ${preset.name}`}
            aria-label={`Delete ${preset.name}`}
          >
            <Trash2 size={10} />
          </button>
        </div>
      ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this preset?"
        message={`"${pendingDelete || ''}" will be removed. Existing links keep their current settings.`}
        confirmLabel="Delete"
        onConfirm={() => pendingDelete && deletePreset(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
