'use client';

import { ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './drawer.module.css';
import { useModalBehavior } from '@/lib/useModalBehavior';

export interface DrawerProps {
  title: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  // Pinned to the bottom, outside the scrolling body — e.g. Cancel/Save —
  // so primary actions stay reachable without scrolling a long form.
  footer?: ReactNode;
}

// Right-side slide-over — same Escape/focus-trap/scroll-lock behavior as
// Modal (lib/useModalBehavior.ts), just a different shell shape. Used by
// Task Planner to open a task's full detail (GeneralTaskDetailPanel)
// without navigating away from the Board/List/Calendar.
export default function Drawer({ title, ariaLabel, onClose, children, footer }: DrawerProps) {
  const panelRef = useModalBehavior(onClose);
  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>{title}</div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
