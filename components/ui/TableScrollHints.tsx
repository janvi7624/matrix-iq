'use client';

import { useEffect } from 'react';
import { scrollEdges } from '@/lib/scrollEdges';

const WRAP = '.mx-rtable-wrap';

/**
 * Marks every table scroll wrapper (.mx-rtable-wrap) with data-more-left /
 * data-more-right while it has columns hidden off that side, so the CSS in
 * app/globals.css ("Horizontal-scroll cues") can show a "scroll for more"
 * hint, fade the hidden edge and give a pinned Actions column its shadow.
 * Renders nothing; does no work for tables that fit.
 */
export default function TableScrollHints() {
  useEffect(() => {
    const tracked = new WeakSet<Element>();
    const resizeObserver = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)));

    function update(el: HTMLElement) {
      const { left, right } = scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth);
      if (left) el.setAttribute('data-more-left', '');
      else el.removeAttribute('data-more-left');
      if (right) el.setAttribute('data-more-right', '');
      else el.removeAttribute('data-more-right');
    }

    function onScroll(e: Event) {
      update(e.currentTarget as HTMLElement);
    }

    function track() {
      document.querySelectorAll<HTMLElement>(WRAP).forEach((el) => {
        if (tracked.has(el)) {
          update(el); // rows may have arrived
          return;
        }
        tracked.add(el);
        el.addEventListener('scroll', onScroll, { passive: true });
        resizeObserver.observe(el);
        // The table inside grows when data loads — watch it too.
        const table = el.querySelector('table');
        if (table) resizeObserver.observe(table);
        update(el);
      });
    }

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        track();
      });
    };
    track();
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll<HTMLElement>(WRAP).forEach((el) => el.removeEventListener('scroll', onScroll));
    };
  }, []);

  return null;
}
