'use client';

// Session-scoped store for the app chrome's own data: the sidebar payload
// (modules, viewer, nav badges) and the viewer's Quick Actions.
//
// Before this, every page rendered its own AppShell, so the Sidebar,
// PortalHeader and GlobalSearch remounted on EVERY navigation and each one
// re-requested its data: /api/sidebar (a heavy endpoint that lists leads,
// marketing, travel, demo and back-office rows just to count badges),
// /api/profile/quick-actions, /api/modules (header breadcrumb) and
// /api/auth/me (search). A page change should only load that page's data.
//
// Now the chrome data is fetched ONCE per login and reused:
//   - in memory across client-side navigations,
//   - in sessionStorage across a full reload of the same tab,
//   - concurrent callers share one in-flight request,
//   - cleared on sign-out (via clearFetchCache) and on a successful login,
//     so one person's menu can never be shown to the next.
// Call refreshShellData() after a change that should be reflected in the
// menu straight away (e.g. Module Manager saving visibility).

import { useSyncExternalStore } from 'react';
import type { ModuleConfigRecord, UserRole } from './types';
import { onFetchCacheClear } from './fetchCached';

export interface ShellViewer {
  name: string;
  username: string;
  role: UserRole;
  department?: string;
  designation?: string;
  isPartner?: boolean;
  isPrivileged?: boolean;
}

export interface SidebarPayload {
  modules: ModuleConfigRecord[];
  viewer: ShellViewer | null;
  badges: Record<string, number>;
}

export interface QuickActionsPayload {
  keys: string[];
  max: number | null;
}

interface ShellState {
  sidebar: SidebarPayload | null;
  /** True once the sidebar request has finished (even if it failed). */
  sidebarSettled: boolean;
  quick: QuickActionsPayload | null;
}

const STORAGE_KEY = 'mx-shell-data-v1';

let state: ShellState = { sidebar: null, sidebarSettled: false, quick: null };
let sidebarInflight: Promise<SidebarPayload | null> | null = null;
let quickInflight: Promise<QuickActionsPayload | null> | null = null;
/** Bumped on clear so a request that left before sign-out can't store its answer afterwards. */
let generation = 0;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebar: state.sidebar, quick: state.quick }));
  } catch {
    // storage blocked/full — memory cache still works
  }
}

function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { sidebar?: SidebarPayload | null; quick?: QuickActionsPayload | null };
    state = {
      sidebar: parsed.sidebar ?? null,
      sidebarSettled: Boolean(parsed.sidebar),
      quick: parsed.quick ?? null
    };
  } catch {
    // corrupt entry — ignore, it is refetched
  }
}

function setState(patch: Partial<ShellState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

/** Loads /api/sidebar once per login. Later calls return the cached payload without a request. */
export function loadSidebarData(): Promise<SidebarPayload | null> {
  hydrate();
  if (state.sidebar) return Promise.resolve(state.sidebar);
  if (sidebarInflight) return sidebarInflight;
  const gen = generation;
  sidebarInflight = fetch('/api/sidebar')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (gen !== generation) return null;
      const payload: SidebarPayload | null = data
        ? { modules: data.modules ?? [], viewer: data.viewer ?? null, badges: data.badges ?? {} }
        : null;
      // A failure is never cached, so the next mount retries.
      setState({ sidebar: payload, sidebarSettled: true });
      return payload;
    })
    .catch(() => {
      if (gen === generation) setState({ sidebarSettled: true });
      return null;
    })
    .finally(() => {
      if (gen === generation) sidebarInflight = null;
    });
  return sidebarInflight;
}

/** Loads the viewer's Quick Actions once per login. */
export function loadQuickActions(): Promise<QuickActionsPayload | null> {
  hydrate();
  if (state.quick) return Promise.resolve(state.quick);
  if (quickInflight) return quickInflight;
  const gen = generation;
  quickInflight = fetch('/api/profile/quick-actions')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (gen !== generation || !data) return null;
      const payload: QuickActionsPayload = {
        keys: Array.isArray(data.keys) ? data.keys : [],
        max: typeof data.max === 'number' ? data.max : null
      };
      setState({ quick: payload });
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      if (gen === generation) quickInflight = null;
    });
  return quickInflight;
}

/** Record a saved Quick Actions choice without refetching. */
export function setQuickActionKeys(keys: string[]) {
  hydrate();
  setState({ quick: { keys, max: state.quick?.max ?? null } });
}

/** Drop the cached sidebar so the next load re-requests it (e.g. after Module Manager changes visibility). */
export function refreshShellData(): Promise<SidebarPayload | null> {
  hydrate();
  generation += 1;
  sidebarInflight = null;
  state = { ...state, sidebar: null, sidebarSettled: false };
  return loadSidebarData();
}

/** Forget everything — sign-out and sign-in both call this. */
export function clearShellData() {
  generation += 1;
  sidebarInflight = null;
  quickInflight = null;
  state = { sidebar: null, sidebarSettled: false, quick: null };
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

// Every sign-out path already calls clearFetchCache(); hook into it so none
// of them can forget the chrome data.
onFetchCacheClear(clearShellData);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ShellState {
  hydrate();
  return state;
}

const SERVER_SNAPSHOT: ShellState = { sidebar: null, sidebarSettled: false, quick: null };
function getServerSnapshot(): ShellState {
  return SERVER_SNAPSHOT;
}

/** React binding: the current chrome data, re-rendering when it loads or clears. */
export function useShellData(): ShellState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
