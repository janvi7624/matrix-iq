'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './popover.module.css';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  ariaLabel: string;
}

// Generic click-to-toggle popover — trigger button + floating panel. No such
// primitive existed anywhere in this app before (used here for Contacts /
// Product Handlers / Projects / Remarks "View more" cells in Client Master).
//
// Rendered through a portal into document.body with position: fixed, computed
// from the trigger's own bounding rect — NOT a plain absolutely-positioned
// child of the table cell, because .tableWrap sets overflow-x: auto
// (components/quotationHistory.module.css), which establishes a scroll/clip
// container that would cut off a popover opened near the table's edge.
export default function Popover({ trigger, children, triggerClassName, ariaLabel }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Always anchored below the trigger; clamp both axes so a trigger near
    // the viewport's right/bottom edge never pushes the panel off-screen
    // (the panel's own max-height + internal scroll, in popover.module.css,
    // handles the case where there simply isn't room to show everything).
    const panelWidth = 320;
    const maxPanelHeight = 320;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8);
    const top = Math.min(rect.bottom + 6, window.innerHeight - maxPanelHeight - 8);
    setCoords({ top: Math.max(8, top), left });
  }

  useEffect(() => {
    if (!open) return;
    place();
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName || styles.trigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-label={ariaLabel}
            style={{ top: coords.top, left: coords.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
