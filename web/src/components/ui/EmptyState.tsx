import { Inbox } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';
import IconTile from '@/components/ui/IconTile';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  /** Accent color for the icon tile — defaults to the app's primary blue. */
  color?: string;
}

export default function EmptyState({ icon, title, description, action, secondaryAction, color = '#2563eb' }: EmptyStateProps) {
  return (
    <div className="gito-card p-12 text-center flex flex-col items-center">
      <IconTile color={color} icon={icon || <Inbox className="w-8 h-8" />} size="lg" className="mb-5" />
      <h3 className="text-base font-bold text-th-primary mb-1.5 tracking-tight">{title}</h3>
      {description && <p className="text-sm text-th-secondary mb-6 max-w-sm">{description}</p>}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <button onClick={action.onClick} className={btn.primary}>
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} className={btn.ghost}>
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
