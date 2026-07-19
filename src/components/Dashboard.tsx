import { Link2, Film, Zap } from 'lucide-react';
import type { ResolveStatus, ResolveProject } from '../lib/api';

interface DashboardProps {
  linkCount: number;
  connected: boolean;
  resolve: ResolveStatus;
  project: ResolveProject | null;
}

export function Dashboard({ linkCount, connected, resolve, project }: DashboardProps) {
  return (
    <div className="space-y-2.5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10">
            <Link2 size={13} className="text-accent" />
          </div>
          <span className="text-[12px] font-semibold text-r-100">
            Active Links
          </span>
          <span className="text-[11px] font-mono font-bold text-accent bg-accent/10 px-1.5 py-[1px] rounded">
            {linkCount}
          </span>
        </div>
        {resolve.connected && resolve.version && (
          <div className="flex items-center gap-1.5 text-[10px] text-r-400 font-mono bg-r-750 px-2 py-1 rounded-md border border-r-700/50">
            <Zap size={8} className="text-success" />
            Resolve {resolve.version}
          </div>
        )}
      </div>

      {/* Project info */}
      {project && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gradient-to-r from-r-750/80 to-r-800/80 border border-r-700/40 animate-fade-in shadow-inner-light">
          <div className="flex items-center justify-center w-5 h-5 rounded bg-accent/10 shrink-0">
            <Film size={10} className="text-accent" />
          </div>
          <span className="text-[11px] font-medium text-r-100 truncate flex-1">{project.name}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-r-400 font-mono">{project.frameRate}fps</span>
            <span className="text-[10px] text-r-500">|</span>
            <span className="text-[10px] text-r-400 font-mono">{project.resolution.width}x{project.resolution.height}</span>
          </div>
        </div>
      )}
    </div>
  );
}
