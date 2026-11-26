'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import styles from './notify.module.css';
import CommonButton from './CommonButton';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };
const VARIANT_CLASS: Record<ToastType, string> = { success: styles.toastSuccess, error: styles.toastError, info: styles.toastInfo };
// Errors stay on screen longer — a sales rep needs time to actually read what went wrong, not just see a flash.
const DURATIONS: Record<ToastType, number> = { success: 4000, error: 6500, info: 4500 };

const ToastContext = createContext<((message: string, type: ToastType) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => dismiss(id), DURATIONS[type]);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={styles.toastStack} role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className={`${styles.toast} ${VARIANT_CLASS[t.type]}`}>
              <span className={styles.toastIcon}><Icon size={16} /></span>
              <span className={styles.toastMessage}>{t.message}</span>
              <CommonButton variant="ghost" size="sm" iconOnly leadingIcon={<X />} onClick={() => dismiss(t.id)} aria-label="Dismiss" />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// Replaces alert() everywhere in the app — toast.error(...) for what used to be alert('...').
//
// The returned object is STABLE (same identity on every render). It used to be
// a fresh object each render, so any useCallback/useEffect that listed `toast`
// as a dependency re-ran on every render — Office Operation Expenses'
// fetchRecords effect did exactly that: fetch → setRecords → re-render → new
// `toast` → new fetchRecords → fetch again, an endless request loop.
export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('useToast must be used within a ToastProvider');
  return useMemo(
    () => ({
      success: (message: string) => showToast(message, 'success'),
      error: (message: string) => showToast(message, 'error'),
      info: (message: string) => showToast(message, 'info')
    }),
    [showToast]
  );
}
