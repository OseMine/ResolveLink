import { Inbox, ArrowRight, Radio, MousePointerClick, Wand2, Settings } from 'lucide-react';
import { LinkCard } from './LinkCard';
import type { Link } from '../lib/api';

interface LinkQueueProps {
  links: Link[];
  onDelete: (id: string) => void | Promise<void>;
  onRender: (id: string) => void | Promise<void>;
  editingLinks?: Set<string>;
  resolveConnected?: boolean;
  onOpenSetup?: () => void;
}

function Step({ number, icon, title, detail }: { number: number; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 text-left">
      <div className="relative shrink-0 mt-0.5">
        <div className="w-6 h-6 rounded-md bg-r-750 border border-r-700/50 flex items-center justify-center text-r-400">
          {icon}
        </div>
        <span className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-accent text-white text-[8px] font-bold flex items-center justify-center">
          {number}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-r-200">{title}</p>
        <p className="text-[10px] text-r-400 leading-snug">{detail}</p>
      </div>
    </div>
  );
}

export function LinkQueue({
  links,
  onDelete,
  onRender,
  editingLinks,
  resolveConnected = false,
  onOpenSetup,
}: LinkQueueProps) {
  if (links.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 animate-fade-in"
        role="status"
        aria-live="polite"
        aria-label="No active links"
      >
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-r-750 border border-r-700/50 flex items-center justify-center">
            <Inbox size={24} className="text-r-500" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-r-800 border border-r-700 flex items-center justify-center">
            <ArrowRight size={10} className="text-r-400" />
          </div>
        </div>

        {resolveConnected ? (
          <>
            <p className="text-[13px] font-semibold text-r-200 mb-1">Ready when you are</p>
            <p className="text-[11px] text-r-400 text-center max-w-[230px] leading-relaxed mb-4">
              Send your first shot to After Effects in three steps.
            </p>
            <div className="space-y-3 max-w-[260px] w-full px-2">
              <Step number={1} icon={<MousePointerClick size={11} />} title="Select clips in Resolve" detail="Pick one or more clips on your timeline." />
              <Step number={2} icon={<Wand2 size={11} />} title="Click Send" detail="A synchronized composition is created for you." />
              <Step number={3} icon={<ArrowRight size={11} />} title="Edit, then render" detail="Rendered results come back to Resolve automatically." />
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] font-semibold text-r-200 mb-1">Connect DaVinci Resolve</p>
            <p className="text-[11px] text-r-400 text-center max-w-[240px] leading-relaxed mb-4">
              ResolveLink cannot see Resolve yet. This is usually a one-time setting.
            </p>
            <div className="space-y-3 max-w-[270px] w-full px-2">
              <Step number={1} icon={<Radio size={11} />} title="Open DaVinci Resolve" detail="Load a project and open a timeline." />
              <Step number={2} icon={<Settings size={11} />} title="Turn on scripting" detail="Preferences → System → General → External scripting using → Local." />
              <Step number={3} icon={<ArrowRight size={11} />} title="Come back here" detail="The status turns green within a few seconds." />
            </div>
            {onOpenSetup && (
              <button onClick={onOpenSetup} className="btn-ghost !text-[10px] mt-4 flex items-center gap-1.5">
                <Settings size={10} />
                Open Setup
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 -mr-1"
      role="list"
      aria-label="Active links"
      aria-live="polite"
    >
      {links.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          onDelete={onDelete}
          onRender={onRender}
          isEditing={editingLinks?.has(link.id) || false}
        />
      ))}
    </div>
  );
}
