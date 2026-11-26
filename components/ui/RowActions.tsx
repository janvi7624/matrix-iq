'use client';

import { KeyboardEvent, MouseEvent, ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import Link from './AppLink';
import CommonButton, { CommonButtonVariant } from './CommonButton';
import styles from './rowActions.module.css';

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  /** Navigates instead of calling onClick. */
  href?: string;
  /** Plain <a> (downloads, API file routes, external) instead of next/link. */
  native?: boolean;
  /** Opens in a new tab (implies native). */
  newTab?: boolean;
  /** Delete / reject / remove — shown in red. */
  destructive?: boolean;
  disabled?: boolean;
  /** Not rendered at all (permission-gated actions). */
  hidden?: boolean;
  /** Visual style when it is rendered as a button. */
  variant?: CommonButtonVariant;
  title?: string;
  /**
   * Decision actions (Approve / Reject …) are always shown directly as
   * buttons, never tucked into the ⋮ menu.
   */
  pinned?: boolean;
}

export interface RowActionsProps {
  actions: RowAction[];
  /** Accessible name for the ⋮ trigger, e.g. "Actions for MEETIQ v1". */
  label?: string;
  /**
   * How many non-pinned actions may show as plain buttons before they all
   * collapse into ⋮. Default 1: a single action (e.g. "View") is a button;
   * two or more (Edit + Delete …) go into the ⋮ menu.
   */
  maxInline?: number;
  size?: 'sm' | 'md';
}

/** Which actions render as buttons and which go into the menu. Pure — exported for tests. */
export function splitRowActions(actions: RowAction[], maxInline = 1): { inline: RowAction[]; menu: RowAction[] } {
  const visible = actions.filter((a) => !a.hidden);
  const pinned = visible.filter((a) => a.pinned);
  const rest = visible.filter((a) => !a.pinned);
  if (rest.length <= maxInline) return { inline: [...pinned, ...rest], menu: [] };
  return { inline: pinned, menu: rest };
}

/**
 * Row actions for tables (and cards).
 * - Decision actions (`pinned`: Approve / Reject) always show as buttons.
 * - Everything else: one action → a button; two or more → a single ⋮ button
 *   that opens a menu with all of them (Edit, Delete, View, Duplicate …).
 *
 * The menu is portalled to <body> with fixed positioning, so a table's
 * scroll wrapper can't clip it; it flips above the trigger near the bottom of
 * the screen. Keyboard: Enter/Space/↓ opens, ↑/↓/Home/End move, Enter
 * activates, Esc/Tab closes and returns focus to the trigger.
 */
export default function RowActions({ actions, label = 'Row actions', maxInline = 1, size = 'sm' }: RowActionsProps) {
  const { inline, menu } = splitRowActions(actions, maxInline);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Place the menu under (or above) the trigger, right-aligned, inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!t || !m) return;
      const mw = m.offsetWidth;
      const mh = m.offsetHeight;
      const below = t.bottom + 6;
      const top = below + mh > window.innerHeight - 8 && t.top - 6 - mh > 8 ? t.top - 6 - mh : below;
      const left = Math.min(Math.max(8, t.right - mw), window.innerWidth - mw - 8);
      setPos({ top, left });
    };
    place();
    // Focus the first enabled item once the menu is in place.
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // Scrolling or resizing would leave the menu detached from its row.
    const onMove = () => close(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  if (!inline.length && !menu.length) return null;

  // Pinned decision actions (and a lone action) as real buttons.
  const inlineButtons = inline.map((a) => {
    const variant = a.variant ?? (a.destructive ? 'destructive' : a.pinned ? 'success' : 'secondary');
    const common = { size, variant, leadingIcon: a.icon, disabled: a.disabled, title: a.title } as const;
    return a.href ? (
      <CommonButton
        key={a.key}
        {...common}
        href={a.href}
        native={a.native || a.newTab}
        target={a.newTab ? '_blank' : undefined}
        rel={a.newTab ? 'noopener noreferrer' : undefined}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {a.label}
      </CommonButton>
    ) : (
      <CommonButton
        key={a.key}
        {...common}
        onClick={(e: MouseEvent) => {
          e.stopPropagation(); // never also trigger a clickable row
          a.onClick?.();
        }}
      >
        {a.label}
      </CommonButton>
    );
  });

  if (!menu.length) return <span className={styles.inline} data-row-actions="">{inlineButtons}</span>;

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!items.length) return;
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].focus();
    }
  }

  const activate = (a: RowAction) => {
    if (a.disabled) return;
    close();
    a.onClick?.();
  };

  return (
    <span className={styles.inline} data-row-actions="">
      {inlineButtons}
      <CommonButton
        ref={triggerRef}
        size={size}
        variant="ghost"
        iconOnly
        leadingIcon={<MoreVertical />}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className={styles.menu}
            // Measured off-screen first, then placed (useLayoutEffect) — no visible jump.
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            onKeyDown={onMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.map((a, i) => {
              const cls = [styles.item, a.destructive ? styles.danger : ''].filter(Boolean).join(' ');
              // A thin divider before the first destructive item, so Delete sits apart.
              const divider = a.destructive && i > 0 && !menu[i - 1].destructive ? <div className={styles.divider} role="separator" /> : null;
              const content = (
                <>
                  {a.icon}
                  <span>{a.label}</span>
                </>
              );
              if (a.href && !a.disabled) {
                const external = a.native || a.newTab;
                return (
                  <span key={a.key} style={{ display: 'contents' }}>
                    {divider}
                    {external ? (
                      <a
                        role="menuitem"
                        tabIndex={-1}
                        className={cls}
                        href={a.href}
                        target={a.newTab ? '_blank' : undefined}
                        rel={a.newTab ? 'noopener noreferrer' : undefined}
                        title={a.title}
                        onClick={() => close(false)}
                      >
                        {content}
                      </a>
                    ) : (
                      <Link role="menuitem" tabIndex={-1} className={cls} href={a.href} title={a.title} onClick={() => close(false)}>
                        {content}
                      </Link>
                    )}
                  </span>
                );
              }
              return (
                <span key={a.key} style={{ display: 'contents' }}>
                  {divider}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cls}
                    disabled={a.disabled}
                    aria-disabled={a.disabled || undefined}
                    title={a.title}
                    onClick={() => activate(a)}
                  >
                    {content}
                  </button>
                </span>
              );
            })}
          </div>,
          document.body
        )}
    </span>
  );
}
