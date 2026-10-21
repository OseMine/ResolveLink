import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  subscribeWebSocket,
  subscribeWebSocketStatus,
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
  editingLinks: Set<string>;
  error: string | null;
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
    error: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial links
  useEffect(() => {
    api.getLinks().then((links) => {
      setState((s) => ({ ...s, links }));
    }).catch(() => {});
  }, []);

  // WebSocket connection — one shared socket for the whole app.
  useEffect(() => {
    const unsubscribeStatus = subscribeWebSocketStatus((connected) => {
      setState((s) => (s.connected === connected ? s : { ...s, connected }));
    });

    const unsubscribe = subscribeWebSocket((type, payload) => {
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

    return () => {
      unsubscribe();
      unsubscribeStatus();
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
  const sendToAE = useCallback(async (clipData?: ResolveClipData[], settings?: any, presetName?: string) => {
    setState((s) => ({ ...s, error: null }));

    let clips = clipData;

    // If no clip data provided, try to fetch from Resolve
    if (!clips || clips.length === 0) {
      const selection = await fetchSelection();
      if (selection && selection.clips && selection.clips.length > 0) {
        clips = selection.clips;
      }
    }

    if (!clips || clips.length === 0) {
      const err = 'No clips selected in Resolve timeline';
      setState((s) => ({ ...s, error: err }));
      throw new Error(err);
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
      mediaType: clip.mediaType === 'audio' ? 'audio' : 'video',
      sourceFps: clip.sourceFps || clip.fps,
    }));

    // Use selection-level resolution if available, then clip-level, then defaults
    const firstClip = clips[0];
    const selectionData = state.selection;
    const fps = settings?.fps || firstClip?.fps || selectionData?.fps || 24;

    // Duration = span from the earliest start to the latest end. Summing
    // durations over-counts whenever clips overlap on different tracks.
    const firstStart = clips.reduce((min, c) => Math.min(min, c.start || 0), Infinity);
    const lastEnd = clips.reduce((max, c) => Math.max(max, (c.start || 0) + (c.duration || 0)), 0);
    const span = Number.isFinite(firstStart) ? Math.max(0, lastEnd - firstStart) : 0;

    const resolvedSettings = {
      width: settings?.width || selectionData?.width || firstClip?.resolution?.width || 1920,
      height: settings?.height || selectionData?.height || firstClip?.resolution?.height || 1080,
      fps,
      duration: settings?.duration || (fps > 0 ? span / fps : 10),
      ...settings,
    };

    // Timeline markers are a nice-to-have: never block sending if unavailable.
    const markers = await api.getMarkers()
      .then((data) => data.markers || [])
      .catch(() => []);

    try {
      const result = await api.linkClip(clipPayload, resolvedSettings, presetName, markers);

      // Trigger the auto-workflow: opens AE, renders, imports to Resolve
      try {
        await api.autoWorkflow(result.linkId);
      } catch (autoErr: any) {
        setState((s) => ({ ...s, error: autoErr.message || 'Auto-workflow failed' }));
        throw autoErr;
      }

      return result;
    } catch (err: any) {
      setState((s) => ({ ...s, error: err.message || 'Failed to send to AE' }));
      throw err;
    }
  }, [fetchSelection, state.selection]);

  const deleteLink = useCallback(async (id: string) => {
    await api.deleteLink(id);
  }, []);

  const triggerRender = useCallback(async (id: string) => {
    const link = state.links.find((item) => item.id === id);
    // REAPER links use a different auto-workflow endpoint than AE links.
    if (link?.target === 'reaper') {
      await api.reaperAuto(id);
      return;
    }
    await api.triggerRender(id);
  }, [state.links]);

  return {
    ...state,
    sendToAE,
    deleteLink,
    triggerRender,
    fetchSelection,
  };
}
