'use client';

import { RefObject, useEffect, useRef } from 'react';

// Mount-order stack of every currently-open modal using this hook. A modal
// opened from inside another one (e.g. Person Performance Dashboard opened
// from within Department Health detail) is the only one that should react
// to Escape/Tab — without this, both modals' listeners fire on the same
// keydown (stopPropagation doesn't stop sibling listeners on the same
// target) and Escape would close both at once instead of just the top one.
const modalStack: symbol[] = [];

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
  const idRef = useRef<symbol>(undefined);
  if (!idRef.current) idRef.current = Symbol('modal');

  useEffect(() => {
    modalStack.push(idRef.current as symbol);
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? cardRef.current)?.focus();
    return () => {
      const i = modalStack.indexOf(idRef.current as symbol);
      if (i !== -1) modalStack.splice(i, 1);
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not the topmost modal — leave this key event for whichever one is.
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
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
