import { cn } from '../lib/utils';

type Status = 'linked' | 'rendering' | 'rendered' | 'error' | 'pending' | 'created' | 'sending' | 'queued' | 'imported';

interface StatusIndicatorProps {
  status: Status;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const statusConfig: Record<Status, { color: string; label: string; pulse?: boolean }> = {
  linked: { color: 'bg-success', label: 'Linked' },
  rendered: { color: 'bg-success', label: 'Rendered' },
  rendering: { color: 'bg-warn', label: 'Rendering', pulse: true },
  sending: { color: 'bg-accent', label: 'Sending', pulse: true },
  queued: { color: 'bg-accent', label: 'Queued', pulse: true },
  imported: { color: 'bg-success', label: 'Imported' },
  error: { color: 'bg-danger', label: 'Error' },
  pending: { color: 'bg-r-500', label: 'Pending' },
  created: { color: 'bg-accent', label: 'Created' },
};

export function StatusIndicator({ status, size = 'sm', showLabel = false }: StatusIndicatorProps) {
  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={cn('inline-flex items-center gap-1.5', showLabel && 'text-xs')}>
      <span
        className={cn(
          'rounded-full shrink-0',
          config.color,
          size === 'sm' ? 'w-[6px] h-[6px]' : 'w-2 h-2',
          config.pulse && 'animate-pulse-dot'
        )}
      />
      {showLabel && (
        <span className="text-r-300 font-medium">{config.label}</span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const badgeClass =
    status === 'linked' || status === 'rendered' || status === 'imported'
      ? 'badge-rendered'
      : status === 'rendering' || status === 'sending' || status === 'queued'
      ? 'badge-rendering'
      : status === 'error'
      ? 'badge-error'
      : status === 'created'
      ? 'badge-created'
      : 'badge-pending';

  return <span className={badgeClass}>{status}</span>;
}
