'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: React.ReactNode;
  /** Gradient brand header instead of the plain title bar (e.g. connection setup guides). */
  headerVariant?: 'plain' | 'gradient';
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Cap panel height and let the body scroll (long content, e.g. audit log detail). */
  scrollBody?: boolean;
  /** Pinned action row below the (scrollable) body — stays visible, never scrolls away. */
  footer?: React.ReactNode;
  /** Override the stacking context — e.g. a confirm dialog that must sit above another modal. */
  zIndexClass?: string;
  children: React.ReactNode;
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '2xl': 'max-w-4xl' } as const;

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerVariant = 'plain',
  icon,
  size = 'md',
  scrollBody = false,
  footer,
  zIndexClass = 'z-50',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center ${zIndexClass} p-4`}
      onClick={onClose}
    >
      <div
        className={`gito-card relative w-full ${SIZE[size]} overflow-hidden ${scrollBody ? 'max-h-[80vh] flex flex-col' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {title && headerVariant === 'gradient' && (
          <div className="px-6 py-4 bg-gradient-to-r from-primary-600 to-primary-700 flex items-start justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {icon && <div className="flex-shrink-0 text-white">{icon}</div>}
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white truncate">{title}</h3>
                {subtitle && <p className="text-xs text-white/80 mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <button onClick={onClose} className="flex-shrink-0 text-white/80 hover:text-white transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {title && headerVariant === 'plain' && (
          <div className="px-6 pt-6 flex items-start justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {icon && <div className="flex-shrink-0">{icon}</div>}
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-th-primary truncate">{title}</h3>
                {subtitle && <p className="text-sm text-th-secondary mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <button onClick={onClose} className="flex-shrink-0 text-th-muted hover:text-th-primary transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {!title && (
          <button onClick={onClose} className="absolute top-4 right-4 text-th-muted hover:text-th-primary transition-colors z-10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        )}

        <div className={`p-6 ${title ? 'pt-4' : ''} ${scrollBody ? 'overflow-y-auto' : ''}`}>
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0 border-t border-th-default px-6 py-4 bg-page">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
