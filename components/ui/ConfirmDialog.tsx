'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import styles from './notify.module.css';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red "Delete" style button instead of the default green "continue" style. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, []);

  function respond(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className={styles.overlay} role="presentation" onClick={() => respond(false)}>
          <div className={styles.confirmCard} role="alertdialog" aria-modal="true" aria-label={pending.title || 'Please confirm'} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmTitle}>{pending.title || 'Are you sure?'}</div>
            <div className={styles.confirmMessage}>{pending.message}</div>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmCancel} onClick={() => respond(false)}>
                {pending.cancelLabel || 'Cancel'}
              </button>
              <button type="button" className={pending.danger ? styles.confirmDanger : styles.confirmOk} onClick={() => respond(true)}>
                {pending.confirmLabel || 'Yes, continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// Replaces window.confirm(...) everywhere — await confirm({ message, danger: true }) resolves to a boolean.
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}
