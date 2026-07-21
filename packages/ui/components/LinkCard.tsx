import { Trash2, ExternalLink, Play, Clock, Pencil, Music } from 'lucide-react';
import { StatusBadge } from './StatusIndicator';
import type { Link } from '../lib/api';

interface LinkCardProps {
  link: Link;
  onDelete: (id: string) => void;
  onRender: (id: string) => void;
  isEditing?: boolean;
}

function formatTimecode(frames: number, fps: number = 24): string {
  const totalSeconds = frames / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const remainingFrames = Math.floor(frames % fps);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(remainingFrames).padStart(2, '0')}`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(frames: number, fps: number): string {
  const seconds = frames / fps;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}m ${sec}s`;
}

export function LinkCard({ link, onDelete, onRender, isEditing }: LinkCardProps) {
  const fps = link.settings.fps;
  const totalFrames = link.clips.reduce((sum, c) => sum + ((c.duration || 0) * fps), 0);
  const isReaper = link.target === 'reaper';

  return (
    <div className="card animate-fade-in group !p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-r-700/30 bg-r-750/20">
        <div className="flex items-center gap-2.5">
          <StatusBadge status={link.status} />
          {isReaper ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/20">
              <Music size={8} />
              REAPER
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20">
              AE
            </span>
          )}
          {isEditing && (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9px] font-semibold bg-accent/15 text-accent border border-accent/20 animate-pulse-dot">
              <Pencil size={8} />
              Editing
            </span>
          )}
          <span className="text-[10px] text-r-400 font-mono">
            {link.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {link.status === 'created' && (
            <button
              onClick={() => onRender(link.id)}
              className="p-1.5 rounded-md text-r-400 hover:text-success hover:bg-success/10 transition-all duration-150"
              title={isReaper ? "Open in REAPER" : "Open in After Effects"}
            >
              <Play size={11} fill="currentColor" />
            </button>
          )}
          {link.exportPath && (
            <button
              onClick={() => {}}
              className="p-1.5 rounded-md text-r-400 hover:text-accent hover:bg-accent/10 transition-all duration-150"
              title="Show in Explorer"
            >
              <ExternalLink size={11} />
            </button>
          )}
          <button
            onClick={() => onDelete(link.id)}
            className="p-1.5 rounded-md text-r-400 hover:text-danger hover:bg-danger/10 transition-all duration-150"
            title="Remove link"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Clip list */}
      <div className="divide-y divide-r-700/20">
        {link.clips.map((clip, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-3 py-1.5 hover:bg-r-650/20 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono text-r-500 w-4 text-right shrink-0">
                {i + 1}
              </span>
              <span className="text-[11px] text-r-200 truncate">
                {clip.name}
              </span>
            </div>
            <span className="text-[10px] font-mono text-r-500 shrink-0 ml-2">
              {formatTimecode((clip.duration || 0) * fps, fps)}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-r-700/30 bg-r-750/20">
        <div className="flex items-center gap-3">
          {isReaper ? (
            <span className="text-[9px] font-mono text-r-500 bg-r-700/50 px-1.5 py-[2px] rounded">
              {link.settings.fps}fps · Audio
            </span>
          ) : (
            <>
              <span className="text-[9px] font-mono text-r-500 bg-r-700/50 px-1.5 py-[2px] rounded">
                {link.settings.width}x{link.settings.height}
              </span>
              <span className="text-[9px] font-mono text-r-500 bg-r-700/50 px-1.5 py-[2px] rounded">
                {link.settings.fps}fps
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-r-500">
          <Clock size={8} />
          <span>{formatDuration(totalFrames, fps)}</span>
          <span className="text-r-600">&middot;</span>
          <span>{formatTime(link.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
