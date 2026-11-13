'use client';

import { ButtonHTMLAttributes, ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './notify.module.css';
import controlsStyles from './controls.module.css';
import { useModalBehavior } from '@/lib/useModalBehavior';

export interface ModalProps {
  title: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide' | 'full';
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

  // Portalled to <body>, like ui/Popover.tsx, for two reasons:
  //
  //   * Valid DOM nesting. A caller that opens a modal from inside a table
  //     row — MarketingRequestsView's request detail — would otherwise render
  //     a <div> as a direct child of <tbody>, which React flags as invalid
  //     nesting and browsers recover from unpredictably. Rendering at the
  //     body makes a row-level modal legitimate instead of a special case to
  //     be hoisted out by hand.
  //   * The overlay is position:fixed, which is normally enough to escape
  //     layout — but a `transform`, `filter` or `contain` on ANY ancestor
  //     makes that ancestor the containing block, and the overlay then sizes
  //     to a card or a table instead of the viewport. The portal removes that
  //     whole class of bug.
  //
  // mounted gates the portal so the server render emits nothing rather than
  // touching document, and the markup appears on the client pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={() => dismissible && onClose()}>
      <div
        ref={cardRef}
        className={size === 'full' ? styles.fullCard : size === 'wide' ? styles.wideCard : styles.confirmCard}
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
    </div>,
    document.body
  );
}

export function ModalCancelButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.confirmCancel} {...props} />;
}

export function ModalOkButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.confirmOk} {...props} />;
}
