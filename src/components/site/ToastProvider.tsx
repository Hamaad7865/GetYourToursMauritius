'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconCheck, IconInfo, IconX } from '@/components/ui/icons';

type ToastVariant = 'success' | 'info' | 'error';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (toast: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ACCENT: Record<ToastVariant, string> = {
  success: 'text-teal',
  info: 'text-ink',
  error: 'text-coral',
};

/**
 * Minimal app-wide toast. `useToast().showToast(...)` drops a transient card in the
 * bottom-centre, announced politely to assistive tech and auto-dismissed after a few seconds.
 * Wrap the app once (outside AuthProvider so sign-in can fire one).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue['showToast']>(
    ({ title, description, variant = 'success' }) => {
      const id = (idRef.current += 1);
      setToasts((prev) => [...prev, { id, title, description, variant }]);
      timers.current.set(id, setTimeout(() => remove(id), 4500));
    },
    [remove],
  );

  // Clear any pending dismiss timers if the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((t) => {
          const Icon =
            t.variant === 'success' ? IconCheck : t.variant === 'error' ? IconX : IconInfo;
          return (
            <div
              key={t.id}
              className="animate-fade-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.45)]"
            >
              <span className={`mt-0.5 shrink-0 ${ACCENT[t.variant]}`}>
                <Icon width={20} height={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-ink">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-ink-muted hover:bg-cream hover:text-ink"
              >
                <IconX width={16} height={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns the toast dispatcher. Falls back to a no-op if no provider is mounted. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? { showToast: () => {} };
}
