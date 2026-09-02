'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './notify.module.css';
import controlsStyles from './controls.module.css';
import { useModalBehavior } from '@/lib/useModalBehavior';

export interface ModalProps {
  title: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide';
  /** When false, Escape/overlay-click are disabled — e.g. while a save is in flight. */
  dismissible?: boolean;
}

const NOOP = () => {};

// Generic dialog shell composing notify.module.css (the app's existing
// overlay/card/title/actions styling — already used by ConfirmDialog,
// PromptDialog, ProjectQuickCreateDialog) with lib/useModalBehavior.ts
// (Escape, Tab focus trap, body scroll lock, focus restore) — the app's
// standard modal behavior, previously missing from ad-hoc dialogs like
// LeadsView's. Caller keeps the `{cond && <Modal .../>}` conditional-render
// pattern (no `open` prop), matching ConfirmDialog/ProjectQuickCreateDialog.
export default function Modal({ title, ariaLabel, onClose, children, footer, size = 'default', dismissible = true }: ModalProps) {
  const cardRef = useModalBehavior(dismissible ? onClose : NOOP);
  return (
    <div className={styles.overlay} role="presentation" onClick={() => dismissible && onClose()}>
      <div
        ref={cardRef}
        className={size === 'wide' ? styles.wideCard : styles.confirmCard}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.confirmTitle}>{title}</div>
        {children}
        {footer && <div className={`${styles.confirmActions} ${controlsStyles.modalFooter}`}>{footer}</div>}
      </div>
    </div>
  );
}

export function ModalCancelButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.confirmCancel} {...props} />;
}

export function ModalOkButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.confirmOk} {...props} />;
}
