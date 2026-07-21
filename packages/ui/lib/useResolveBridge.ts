import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  createWebSocket,
  Link,
  ServerFile,
  ResolveStatus,
  ResolveSelection,
  ResolveClipData,
} from '../lib/api';

interface AppState {
  connected: boolean;
  links: Link[];
  newFiles: ServerFile[];
  resolve: ResolveStatus;
  selection: ResolveSelection | null;
  selectionLoading: boolean;
  editingLinks: Set<string>; // link IDs currently being edited in AE
}

export function useResolveBridge() {
  const [state, setState] = useState<AppState>({
    connected: false,
    links: [],
    newFiles: [],
    resolve: { connected: false },
    selection: null,
    selectionLoading: false,
    editingLinks: new Set(),
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial links
  useEffect(() => {
    api.getLinks().then((links) => {
      setState((s) => ({ ...s, links }));
    }).catch(() => {});
  }, []);

  // WebSocket connection — guard against duplicate instances
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    // Close any existing connection before creating a new one
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = createWebSocket((type, payload) => {
      switch (type) {
        case 'init':
          setState((s) => ({ ...s, connected: true, links: payload.links }));
          break;
        case 'link:created':
        case 'link:updated':
          setState((s) => {
            const exists = s.links.find((l) => l.id === payload.id);
            return {
              ...s,
              links: exists
                ? s.links.map((l) => (l.id === payload.id ? payload : l))
                : [...s.links, payload],
            };
          });
          break;
        case 'link:deleted':
          setState((s) => ({
            ...s,
            links: s.links.filter((l) => l.id !== payload.id),
          }));
          break;
        case 'link:rendered':
          setState((s) => ({
            ...s,
            links: s.links.map((l) =>
              l.id === payload.id ? { ...l, ...payload, status: 'rendered' as const } : l
            ),
          }));
          break;
        case 'file:new':
          setState((s) => ({
            ...s,
            newFiles: [...s.newFiles, payload],
          }));
          break;
        case 'resolve:status':
          setState((s) => ({ ...s, resolve: payload }));
          break;
        case 'link:editing':
          setState((s) => {
            const next = new Set(s.editingLinks);
            if (payload.editing) next.add(payload.id);
            else next.delete(payload.id);
            return { ...s, editingLinks: next };
          });
          break;
      }
    });

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // Poll Resolve status when bridge is connected
  useEffect(() => {
    if (!state.connected) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const check = async () => {
      try {
        const status = await api.resolveStatus();
        setState((s) => ({ ...s, resolve: status }));
      } catch {
        setState((s) => ({
          ...s,
          resolve: { connected: false, error: 'Bridge unreachable' },
        }));
      }
    };

    check();
    pollRef.current = setInterval(check, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.connected]);

  // Fetch selection from Resolve
  const fetchSelection = useCallback(async (track?: number) => {
    setState((s) => ({ ...s, selectionLoading: true }));
    try {
      const selection = await api.resolveSelection(track);
      setState((s) => ({ ...s, selection, selectionLoading: false }));
      return selection;
    } catch {
      setState((s) => ({ ...s, selectionLoading: false }));
      return null;
    }
  }, []);

  // Send to AE - uses real selection data if available, otherwise falls back
  const sendToAE = useCallback(async (clipData?: ResolveClipData[], settings?: any) => {
    let clips = clipData;

    // If no clip data provided, try to fetch from Resolve
    if (!clips || clips.length === 0) {
      const selection = await fetchSelection();
      if (selection && selection.clips && selection.clips.length > 0) {
        clips = selection.clips;
      }
    }

    if (!clips || clips.length === 0) {
      throw new Error('No clips selected in Resolve timeline');
    }

    // Convert ResolveClipData to ClipData format for the backend
    const clipPayload = clips.map((clip) => ({
      name: clip.name,
      start: clip.start,
      duration: clip.duration,
      sourcePath: clip.sourcePath,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      trackIndex: clip.trackIndex,
    }));

    // Use selection-level resolution if available, then clip-level, then defaults
    const firstClip = clips[0];
    const selectionData = state.selection;
    const resolvedSettings = {
      width: settings?.width || selectionData?.width || firstClip?.resolution?.width || 1920,
      height: settings?.height || selectionData?.height || firstClip?.resolution?.height || 1080,
      fps: settings?.fps || firstClip?.fps || 24,
      duration: settings?.duration || Math.ceil(
        clips.reduce((sum, c) => sum + c.duration, 0) / (firstClip?.fps || 24)
      ),
      ...settings,
    };

    const result = await api.linkClip(clipPayload, resolvedSettings);

    // Trigger the auto-workflow: opens AE, renders, imports to Resolve
    try {
      await api.autoWorkflow(result.linkId);
    } catch {
      // Auto-workflow might fail if AE isn't installed, that's ok
    }

    return result;
  }, [fetchSelection]);

  const deleteLink = useCallback(async (id: string) => {
    await api.deleteLink(id);
  }, []);

  const triggerRender = useCallback(async (id: string) => {
    await api.triggerRender(id);
  }, []);

  return {
    ...state,
    sendToAE,
    deleteLink,
    triggerRender,
    fetchSelection,
  };
}
