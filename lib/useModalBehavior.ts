'use client';

import { RefObject, useEffect, useRef } from 'react';

// The three things every modal in this app needs and which most of them were
// missing: Escape from anywhere (not just while one specific input has focus),
// a Tab focus trap so keyboard users can't wander into the page behind, and a
// body scroll lock so the background doesn't move under the overlay. Also
// returns focus to whatever was focused before the modal opened, instead of
// dropping the user at the top of the document on close.
//
// Attach the returned ref to the dialog's own card element (the thing with
// role="dialog"), not the overlay.
export function useModalBehavior(onClose: () => void): RefObject<HTMLDivElement | null> {
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusable = cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // Capture phase so Escape reaches this before any inner control that also
    // listens for it (e.g. a search input that clears on Escape).
    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return cardRef;
}
