import { Inbox, ArrowRight } from 'lucide-react';
import { LinkCard } from './LinkCard';
import type { Link } from '../lib/api';

interface LinkQueueProps {
  links: Link[];
  onDelete: (id: string) => void;
  onRender: (id: string) => void;
  editingLinks?: Set<string>;
}

export function LinkQueue({ links, onDelete, onRender, editingLinks }: LinkQueueProps) {
  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-r-750 border border-r-700/50 flex items-center justify-center">
            <Inbox size={24} className="text-r-500" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-r-800 border border-r-700 flex items-center justify-center">
            <ArrowRight size={10} className="text-r-400" />
          </div>
        </div>
        <p className="text-[13px] font-semibold text-r-200 mb-1">No active links</p>
        <p className="text-[11px] text-r-400 text-center max-w-[200px] leading-relaxed">
          Select clips in your Resolve timeline and send them to After Effects
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 -mr-1">
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
