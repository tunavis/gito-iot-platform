import { Inbox } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="gito-card p-12 text-center flex flex-col items-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)', color: 'var(--color-text-muted)' }}
      >
        {icon || <Inbox className="w-8 h-8" />}
      </div>
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
