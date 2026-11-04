'use client';

// Browser-side TTL cache for reference data — the client half of
// lib/memoCache.ts.
//
// The server already caches slow-changing lookup tables in-process
// (memoCache: roles, departments, module config, app settings). What it
// cannot do is stop the browser asking again. Every list screen fills its
// filter dropdowns from the same few staff and department endpoints, and
// re-requests them on every entry: /api/users/lite alone is fetched from
// twelve places, /api/departments from eight. Navigating Projects → Leads →
// Projects re-downloads the same staff list three times.
//
// So this is a transport-level cache. Same URL, same data in the dropdown,
// one request instead of N per session.
//
// THE RULES, which matter more than the code:
//
//   1. Reference data only. Slow-changing lookup lists that fill a picker —
//      staff, departments, product catalogue. NEVER a user's permissions,
//      role, active status or session (/api/auth/me is deliberately not
//      cached), and never workflow state like an approval. Those must be
//      read live, for the same reason memoCache's own comment gives.
//   2. Live business data stays live. The list a screen is built around —
//      /api/leads, /api/projects?remarks=1 for the Projects list, the stats
//      beside them — is read fresh every time, auto-refresh included. A
//      cached dropdown of names is a convenience; a cached list of records
//      people are working on is a bug.
//
//      The same URL can be both, and /api/projects is: the Projects screen
//      reads it as live data and is NOT cached, while eleven other screens
//      read it only to fill a picker or to label a project_id. Those are
//      cached for OPTIONS_TTL_MS and invalidated when a project is created,
//      which is the one event a picker must not miss.
//   3. A failure is never cached, so the next caller retries.
//
// Staleness is bounded by the TTL *and* by invalidateCached on the write
// paths — same belt-and-braces as the server cache. A new employee appears
// in other people's dropdowns when User Management invalidates the entry, or
// within the TTL at worst.

/** Staff, department and catalogue lists. They change a few times a month. */
export const REFERENCE_TTL_MS = 5 * 60_000;

/**
 * Lists of live records used only to fill a picker — project and client
 * options. Short, because somebody who has just created a project expects to
 * be able to pick it.
 */
export const OPTIONS_TTL_MS = 60_000;

interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/**
 * Requests that have gone out but not come back.
 *
 * Without this, a screen whose three components each ask for
 * /api/users/lite on mount still makes three requests — the first has not
 * resolved yet, so none of them finds a cache entry. Sharing the promise is
 * most of the saving on a cold screen.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * How many times each URL has been invalidated, plus a counter for the
 * whole cache. Compared across a request so one already in flight cannot
 * store an answer that a write has since superseded — see fetchCached.
 */
const epochs = new Map<string, number>();
let globalEpoch = 0;

/** Compared as a pair, not packed into one number — no magic multiplier to overflow. */
function epochOf(url: string): string {
  return `${globalEpoch}:${epochs.get(url) ?? 0}`;
}

function bump(url: string): void {
  epochs.set(url, (epochs.get(url) ?? 0) + 1);
}

/**
 * Is this entry still usable? Pure, so the decision is testable without a
 * DOM or a clock.
 *
 * A clock that moved backwards — manual change, DST, a laptop resuming — is
 * treated as stale rather than as fresh-for-longer. The same defence as
 * shouldRefresh in lib/useAutoRefresh.ts, and for the same reason: the
 * failure mode of guessing wrong is serving data for an unbounded time.
 */
export function isFresh(entry: { storedAt: number; expiresAt: number } | undefined, now: number): boolean {
  if (!entry) return false;
  if (now < entry.storedAt) return false;
  return now < entry.expiresAt;
}

/**
 * GET a reference list, from memory when it is fresh.
 *
 * Throws on a non-2xx or on unparseable JSON, so callers keep whatever
 * fallback they already had:
 *
 *   fetchCached<User[]>('/api/users/lite').then(setUsers).catch(() => setUsers([]));
 */
// The default type parameter is `any` deliberately, and it is not a
// loosening: what it replaces is `response.json()`, which is already
// Promise<any>. So a call site that annotates its own callback — and most of
// them do, `.then((users: User[]) => ...)` — types exactly as well as it did
// before, and one that wants the type checked passes fetchCached<User[]>().
// Defaulting to unknown instead would type-error all 30 existing sites into
// needing an annotation they never had.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchCached<T = any>(url: string, ttlMs: number = REFERENCE_TTL_MS, init?: RequestInit): Promise<T> {
  const now = Date.now();
  const hit = store.get(url);
  if (isFresh(hit, now)) return hit!.value as T;

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  // Read BEFORE the request goes out, and compared after it comes back.
  //
  // Without this there is a race that defeats the invalidation entirely: a
  // request that left before a write lands can resolve after it, and store
  // the pre-write answer — so User Management invalidating the staff lists on
  // save is silently undone by a read already in flight, and the stale list
  // then lives for the full TTL. The window is small and the symptom is "I
  // added an employee and they are still not in the dropdown", which is
  // exactly the complaint this cache must not cause.
  const epoch = epochOf(url);

  const request = (async () => {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    const value = (await response.json()) as T;
    // Set only on success: a cached failure would turn one bad moment into
    // ttlMs of an empty dropdown. And only if nothing invalidated this URL
    // while the request was out — the caller still gets the value either
    // way, it just does not become the cached answer.
    if (epochOf(url) === epoch) {
      const at = Date.now();
      store.set(url, { value, storedAt: at, expiresAt: at + ttlMs });
    }
    return value;
  })();

  inflight.set(url, request);
  try {
    return (await request) as T;
  } finally {
    inflight.delete(url);
  }
}

/** Drop one URL, so the next read goes to the server. */
export function invalidateCached(url: string): void {
  store.delete(url);
  inflight.delete(url);
  bump(url);
}

/**
 * Drop every cached URL that starts with `prefix`.
 *
 * For the endpoints that vary by query string: /api/users/list?scope=sales
 * and ?scope=handover are separate entries, and adding a user invalidates
 * both. Matching on the prefix means a write path does not have to know
 * which scopes some screen happened to ask for.
 */
export function invalidateCachedPrefix(prefix: string): void {
  // Collected BEFORE anything is deleted. A request in flight is exactly the
  // one the race is about, and deleting it from `inflight` first would hide
  // it from the bump that stops its answer being stored.
  const affected = [...new Set([...store.keys(), ...inflight.keys(), ...epochs.keys()])].filter((key) => key.startsWith(prefix));
  for (const key of affected) {
    store.delete(key);
    inflight.delete(key);
    bump(key);
  }
}

/**
 * Everything. Called on sign-out, where it is load-bearing rather than
 * belt-and-braces: three of the four sign-out paths finish with
 * router.push('/login'), which is a CLIENT-side navigation and leaves module
 * state intact. Without this, the next person to sign in on the same browser
 * would read the previous session's staff and department lists.
 */
export function clearFetchCache(): void {
  store.clear();
  inflight.clear();
  epochs.clear();
  // Bumped rather than reset: a request that left before the sign-out must
  // not be able to store the previous session's data afterwards. Clearing
  // the per-URL epochs alone would let it, since its captured value would
  // match the fresh zero.
  globalEpoch += 1;
}

/** The endpoints a write path invalidates. Named so the call sites read. */
export const REFERENCE_URLS = {
  users: '/api/users/lite',
  /** Every ?scope= variant. */
  userListPrefix: '/api/users/list',
  departments: '/api/departments',
  departmentManagers: '/api/departments/managers',
  technicalRoster: '/api/technical-roster',
  tmsAssignableUsers: '/api/tms/assignable-users',
  leadAssignees: '/api/leads/assignees',
  products: '/api/products',
  /** The picker read of the project list. Not the Projects screen's own. */
  projects: '/api/projects'
} as const;

/**
 * After a project is created, so every picker shows it.
 *
 * Edits are deliberately not invalidated: a renamed client in a dropdown
 * corrects itself within the minute, while a project that cannot be selected
 * at all blocks whatever the person was filling in.
 */
export function invalidateProjectCaches(): void {
  invalidateCached(REFERENCE_URLS.projects);
}

/**
 * After anything that changes who exists or what they may do.
 *
 * Every people-shaped endpoint at once, deliberately: they are six different
 * scoped views of the same staff table — /api/users/list?scope=sales,
 * /api/technical-roster, /api/leads/assignees and the rest — and a caller
 * that has just edited a user should not have to know which of them the
 * screen it is about to open happens to read.
 */
export function invalidatePeopleCaches(): void {
  invalidateCached(REFERENCE_URLS.users);
  invalidateCachedPrefix(REFERENCE_URLS.userListPrefix);
  invalidateCached(REFERENCE_URLS.departments);
  invalidateCached(REFERENCE_URLS.departmentManagers);
  invalidateCachedPrefix(REFERENCE_URLS.technicalRoster);
  invalidateCached(REFERENCE_URLS.tmsAssignableUsers);
  invalidateCached(REFERENCE_URLS.leadAssignees);
}
