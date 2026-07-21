import { useState, useEffect, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { Dashboard } from './components/Dashboard';
import { SendButton } from './components/SendButton';
import { LinkQueue } from './components/LinkQueue';
import { JobHistory } from './components/JobHistory';
import { SetupWizard } from './components/SetupWizard';
import { UpdateNotification } from './components/UpdateNotification';
import { TimelineMarkers } from './components/TimelineMarkers';
import { BatchExport } from './components/BatchExport';
import { RenderPresets } from './components/RenderPresets';
import { useKeyboardShortcuts, ShortcutHint as KeyboardShortcutsHint } from './components/KeyboardShortcuts';
import { useResolveBridge } from './lib/useResolveBridge';
import { api, createWebSocket } from './lib/api';
import type { ResolveProject } from './lib/api';

export default function App() {
  const {
    connected,
    links,
    resolve,
    selection,
    selectionLoading,
    editingLinks,
    sendToAE,
    deleteLink,
    triggerRender,
    fetchSelection,
  } = useResolveBridge();

  const [project, setProject] = useState<ResolveProject | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<string | undefined>();

  // Keyboard shortcuts
  const handleSendShortcut = useCallback(async () => {
    if (!connected || !selection?.clips) return;
    try { await sendToAE(); } catch {}
  }, [connected, selection, sendToAE]);

  useKeyboardShortcuts({
    onRefresh: fetchSelection,
    onSend: handleSendShortcut,
    onToggleTools: () => setShowPanels((p) => !p),
    onSetup: () => setShowSetup(true),
  });

  useEffect(() => {
    if (!resolve.connected) {
      setProject(null);
      return;
    }

    api.resolveProject().then((p) => {
      if (p && !('error' in p)) {
        setProject(p);
      }
    }).catch(() => {});
  }, [resolve.connected]);

  // First-run detection: show setup wizard if no .env exists
  useEffect(() => {
    api.getSetup().then((data) => {
      if (!data.hasEnv) setShowSetup(true);
    }).catch(() => {});
  }, []);

  // Desktop notifications on render completion
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const ws = createWebSocket((type, payload) => {
      if (type === 'link:updated' && payload.status === 'imported') {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('ResolveLink', {
            body: `Render imported to Resolve successfully`,
          });
        }
      }
      if (type === 'link:updated' && payload.status === 'error') {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('ResolveLink', {
            body: `Import failed — check job history for details`,
          });
        }
      }
    });
    return () => ws.close();
  }, []);

  return (
    <div className="flex flex-col h-full bg-r-900">
      <Titlebar onSetup={() => setShowSetup(true)} />

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* Update notification */}
        <UpdateNotification />

        {/* Header */}
        <Dashboard
          linkCount={links.length}
          connected={connected}
          resolve={resolve}
          project={project}
        />

        {/* Divider */}
        <div className="divider" />

        {/* Send Action */}
        <SendButton
          connected={connected}
          resolveConnected={resolve.connected}
          selection={selection}
          selectionLoading={selectionLoading}
          onSend={sendToAE}
          onRefreshSelection={fetchSelection}
        />

        {/* Divider */}
        <div className="divider" />

        {/* Links section header */}
        {links.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="section-label">Links</span>
            <span className="text-[10px] text-r-500 font-mono">{links.length}</span>
          </div>
        )}

        {/* Links List */}
        <div className="flex-1 overflow-hidden">
          <LinkQueue
            links={links}
            onDelete={deleteLink}
            onRender={triggerRender}
            editingLinks={editingLinks}
          />
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* Job History */}
        <JobHistory />

        {/* Expandable panels toggle */}
        <div className="divider" />
        <button
          onClick={() => setShowPanels(!showPanels)}
          className="btn-ghost w-full flex items-center justify-center gap-2 text-[10px]"
        >
          <span className="section-label">{showPanels ? 'Hide Tools' : 'Show Tools'}</span>
          <span className={`text-r-500 transition-transform ${showPanels ? 'rotate-180' : ''}`}>&#9660;</span>
        </button>

        {showPanels && (
          <div className="space-y-4 animate-slide-up">
            <TimelineMarkers resolveConnected={resolve.connected} />
            <div className="divider" />
            <BatchExport resolveConnected={resolve.connected} />
            <div className="divider" />
            <RenderPresets currentPreset={currentPreset} onSelect={setCurrentPreset} />
            <div className="divider" />
            <KeyboardShortcutsHint />
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 divider">
          <div className="flex items-center justify-center">
            <span className="text-[10px] text-r-500 font-mono tracking-wider">
              ResolveLink v1.0.0
            </span>
          </div>
        </div>
      </div>

      <SetupWizard open={showSetup} onClose={() => setShowSetup(false)} />
    </div>
  );
}
