'use client';

import { useEffect, useRef } from 'react';

/**
 * Publishes the app bar's live height as --mx-header-h, and how much of it is
 * still on screen as --mx-header-visible, on the document root. The sidebar
 * uses them to be exactly "the rest of the screen" at every scroll position,
 * and fill-the-screen list pages (.mx-fill-page) to size their table.
 *
 * Measured rather than hard-coded: the header has flex-wrap and becomes two
 * rows on a narrow window. ResizeObserver catches a wrap caused by a longer
 * page title too, not only a window resize.
 *
 *   const headerRef = usePublishHeaderHeight();
 *   <CommonHeader ref={headerRef} … />
 */
export function usePublishHeaderHeight() {
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let frame = 0;
    let lastHeight = -1;
    let lastVisible = -1;
    const publish = () => {
      frame = 0;
      const height = Math.round(el.getBoundingClientRect().height);
      if (height !== lastHeight) {
        lastHeight = height;
        document.documentElement.style.setProperty('--mx-header-h', `${height}px`);
      }
      const visible = Math.max(0, height - Math.round(window.scrollY));
      // Only written when it changes: past the first screenful this is 0 on
      // every scroll event, and rewriting a root custom property invalidates
      // style for the whole document each time.
      if (visible !== lastVisible) {
        lastVisible = visible;
        document.documentElement.style.setProperty('--mx-header-visible', `${visible}px`);
      }
    };
    // Coalesced to one write per frame — scroll fires far faster than paint.
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(publish);
    };
    publish();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return headerRef;
}
