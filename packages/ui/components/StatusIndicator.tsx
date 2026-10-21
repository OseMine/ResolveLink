import { cn } from '../lib/utils';

type Status =
  | 'linked'
  | 'rendering'
  | 'rendered'
  | 'error'
  | 'pending'
  | 'created'
  | 'sending'
  | 'queued'
  | 'imported'
  | 'completed'
  | 'sent';

interface StatusIndicatorProps {
  status: Status;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

/**
 * Plain-language status labels. "created" means the link exists but AE has not
 * picked it up yet — non-technical users should never have to decode enums.
 */
const statusConfig: Record<Status, { color: string; label: string; help: string; pulse?: boolean }> = {
  created: { color: 'bg-accent', label: 'Ready', help: 'Link created. Send it to After Effects or open it again.' },
  sending: { color: 'bg-accent', label: 'Opening…', help: 'Opening After Effects and preparing the composition.' },
  queued: { color: 'bg-accent', label: 'Waiting for AE', help: 'Queued. The After Effects panel will pick it up automatically.' },
  linked: { color: 'bg-success', label: 'Linked', help: 'The composition is open in After Effects.' },
  rendering: { color: 'bg-warn', label: 'Rendering…', help: 'After Effects is rendering the composition.', pulse: true },
  rendered: { color: 'bg-success', label: 'Rendered', help: 'The render finished and is ready to import.' },
  imported: { color: 'bg-success', label: 'Imported', help: 'The render is on your Resolve timeline.' },
  completed: { color: 'bg-success', label: 'Done', help: 'This link finished successfully.' },
  sent: { color: 'bg-success', label: 'Sent', help: 'The job was sent to the target application.' },
  pending: { color: 'bg-r-500', label: 'Pending', help: 'Waiting to start.' },
  error: { color: 'bg-danger', label: 'Needs attention', help: 'Something failed. Open History for the error details.' },
};

export function StatusIndicator({ status, size = 'sm', showLabel = false }: StatusIndicatorProps) {
  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={cn('inline-flex items-center gap-1.5', showLabel && 'text-xs')} title={config.help}>
      <span
        className={cn(
          'rounded-full shrink-0',
          config.color,
          size === 'sm' ? 'w-[6px] h-[6px]' : 'w-2 h-2',
          config.pulse && 'animate-pulse-dot'
        )}
      />
      {showLabel && <span className="text-r-300 font-medium">{config.label}</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status] || statusConfig.pending;

  const badgeClass =
    status === 'linked' || status === 'rendered' || status === 'imported' ||
    status === 'completed' || status === 'sent'
      ? 'badge-rendered'
      : status === 'rendering' || status === 'sending' || status === 'queued'
        ? 'badge-rendering'
        : status === 'error'
          ? 'badge-error'
          : status === 'created'
            ? 'badge-created'
            : 'badge-pending';

  return (
    <span className={badgeClass} title={config.help}>
      {config.label}
    </span>
  );
}
