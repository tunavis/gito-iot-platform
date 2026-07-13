'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { btn } from '@/components/ui/buttonStyles';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'default';
  resolve: (value: boolean) => void;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; variant?: 'danger' | 'default' }) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5 text-green-500" />,
  error: <XCircle className="w-5 h-5 text-red-500" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
  info: <Info className="w-5 h-5 text-blue-500" />,
};

const STYLES: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50',
  error: 'border-red-200 bg-red-50',
  warning: 'border-yellow-200 bg-yellow-50',
  info: 'border-blue-200 bg-blue-50',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${++counterRef.current}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 6000 : 4000);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const success = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message, duration: 8000 });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  }, [addToast]);

  const confirm = useCallback((
    message: string,
    options?: { title?: string; confirmLabel?: string; variant?: 'danger' | 'default' }
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        title: options?.title ?? 'Confirm',
        message,
        confirmLabel: options?.confirmLabel ?? 'Confirm',
        confirmVariant: options?.variant ?? 'default',
        resolve,
      });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info, confirm }}>
      {children}

      {/* Confirm Dialog */}
      <Modal
        open={!!confirmState}
        onClose={() => handleConfirm(false)}
        size="sm"
        zIndexClass="z-[200]"
        title={confirmState?.title}
        icon={confirmState && (
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            confirmState.confirmVariant === 'danger' ? 'bg-red-100' : 'bg-amber-100'
          }`}>
            {confirmState.confirmVariant === 'danger'
              ? <Trash2 className="w-5 h-5 text-red-600" />
              : <AlertTriangle className="w-5 h-5 text-amber-600" />
            }
          </div>
        )}
      >
        {confirmState && (
          <>
            <p className="text-sm text-th-secondary mb-5">{confirmState.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => handleConfirm(false)} className={btn.secondary}>
                Cancel
              </button>
              <button
                onClick={() => handleConfirm(true)}
                className={confirmState.confirmVariant === 'danger' ? btn.danger : btn.primary}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Toast Container - fixed bottom-right */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-sm animate-slide-in-right ${STYLES[toast.type]}`}
          >
            <div className="flex-shrink-0 mt-0.5">
              {ICONS[toast.type]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-th-primary">{toast.title}</p>
              {toast.message && (
                <p className="text-sm text-th-secondary mt-0.5">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 text-th-muted hover:text-th-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}