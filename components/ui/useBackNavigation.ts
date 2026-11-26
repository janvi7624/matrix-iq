'use client';

import { MouseEvent, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  hasPreviousInAppScreen,
  NAV_STACK_STORAGE_KEY,
  parseNavStack,
  recordNavigation,
  resolveFallbackRoute
} from '@/lib/backNavigation';

function readStack(): string[] {
  try {
    return parseNavStack(window.sessionStorage.getItem(NAV_STACK_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  try {
    window.sessionStorage.setItem(NAV_STACK_STORAGE_KEY, JSON.stringify(stack));
  } catch {
    // Private mode / storage blocked — the back button then always uses the fallback route.
  }
}

export interface UseBackNavigationOptions {
  /** Where to go when there is no in-app screen behind this one. Defaults to the nearest parent page. */
  fallbackRoute?: string;
  /** Root used when no parent page exists (e.g. the partner portal home). Defaults to '/'. */
  rootRoute?: string;
}

/**
 * Back behaviour for CommonHeader. Uses the router's history when this tab
 * has an in-app screen behind the current one, otherwise navigates to the
 * fallback route. The history stack lives in sessionStorage, per tab.
 */
export function useBackNavigation({ fallbackRoute, rootRoute = '/' }: UseBackNavigationOptions = {}) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  useEffect(() => {
    writeStack(recordNavigation(readStack(), pathname));
  }, [pathname]);

  const target = fallbackRoute ?? resolveFallbackRoute(pathname, rootRoute);

  const canUseHistory = useCallback(() => hasPreviousInAppScreen(readStack()) && window.history.length > 1, []);

  /** Programmatic back: history when possible, else the fallback route. */
  const goBack = useCallback(() => {
    if (canUseHistory()) router.back();
    else router.push(target);
  }, [router, target, canUseHistory]);

  /**
   * Click handler for a back control rendered as a link to `fallbackRoute`.
   * A plain left click with history available is turned into router.back();
   * modified clicks (new tab/window) and the no-history case fall through to
   * the link's own navigation.
   */
  const handleBackClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (canUseHistory()) {
        e.preventDefault();
        router.back();
      }
    },
    [router, canUseHistory]
  );

  return { goBack, handleBackClick, fallbackRoute: target };
}
