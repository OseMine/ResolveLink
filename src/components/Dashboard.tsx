import { useEffect, useState, useRef } from 'react';
import { Link2, Film, Zap, Bug, Lightbulb } from 'lucide-react';
import type { ResolveStatus, ResolveProject, ProjectStats } from '../lib/api';
import { api } from '../lib/api';

interface DashboardProps {
  linkCount: number;
  connected: boolean;
  resolve: ResolveStatus;
  project: ResolveProject | null;
}

function AnimatedCounter({ value, label, icon, color }: { value: number; label: string; icon: React.ReactNode; color: string }) {
  const [display, setDisplay] = useState(0);
  const animRef = useRef<number>();

  useEffect(() => {
    let start: number | null = null;
    const from = display;
    const dur = 800;

    function tick(now: number) {
      if (!start) start = now;
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.floor(from + (value - from) * eased));
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [value]);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border cursor-default"
      style={{ borderColor: `${color}33`, background: `${color}0d` }}
      title={`${label}: ${value}`}
    >
      <span style={{ color }} className="shrink-0">{icon}</span>
      <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color }}>
        {display}
      </span>
      <span className="text-[10px] text-r-400 font-mono">{label}</span>
    </div>
  );
}

export function Dashboard({ linkCount, connected, resolve, project }: DashboardProps) {
  const [stats, setStats] = useState<ProjectStats>({ bugs: 0, features: 0, bugLabels: [], featureLabels: [] });

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    const id = setInterval(() => api.stats().then(setStats).catch(() => {}), 30000);
    return () => clearInterval(id);
  }, []);

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
        <div className="flex items-center gap-1.5">
          <AnimatedCounter value={stats.bugs} label="bugs" icon={<Bug size={10} />} color="#ef4444" />
          <AnimatedCounter value={stats.features} label="features" icon={<Lightbulb size={10} />} color="#a855f7" />
          {resolve.connected && resolve.version && (
            <div className="flex items-center gap-1.5 text-[10px] text-r-400 font-mono bg-r-750 px-2 py-1 rounded-md border border-r-700/50">
              <Zap size={8} className="text-success" />
              Resolve {resolve.version}
            </div>
          )}
        </div>
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
