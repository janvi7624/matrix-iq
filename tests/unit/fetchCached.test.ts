import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearFetchCache,
  fetchCached,
  invalidateCached,
  invalidateCachedPrefix,
  invalidatePeopleCaches,
  isFresh,
  OPTIONS_TTL_MS,
  REFERENCE_TTL_MS
} from '../../lib/fetchCached';

// The browser-side reference cache.
//
// The whole value of this is "the second caller does not hit the network",
// so that is what most of these assert — by counting calls to a stubbed
// fetch rather than by inspecting the cache, which is what a component
// actually observes.
//
// The two properties worth more than the hit rate: a FAILURE is never
// cached (a cached failure turns one bad moment into minutes of an empty
// dropdown), and concurrent callers share one request (three components
// mounting together is the normal case, and none of them finds a cache entry
// because the first has not resolved yet).

let calls: string[] = [];
const original = globalThis.fetch;

/** A fetch that counts, and can be told to fail. */
function stubFetch(handler?: (url: string) => { ok?: boolean; status?: number; body?: unknown }): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const result = handler ? handler(url) : {};
    const ok = result.ok ?? true;
    return {
      ok,
      status: result.status ?? (ok ? 200 : 500),
      json: async () => result.body ?? [{ id: 'u1' }]
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  clearFetchCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = original;
});

describe('isFresh', () => {
  const entry = { storedAt: 1_000, expiresAt: 2_000 };

  it('treats a missing entry as stale', () => {
    expect(isFresh(undefined, 1_500)).toBe(false);
  });

  it('is fresh up to the expiry and stale from it', () => {
    expect(isFresh(entry, 1_999)).toBe(true);
    expect(isFresh(entry, 2_000)).toBe(false);
    expect(isFresh(entry, 2_001)).toBe(false);
  });

  // A clock that moved backwards would otherwise read as fresh for longer
  // than the TTL — unbounded staleness, which is the one outcome a TTL
  // exists to prevent. Same defence as shouldRefresh in useAutoRefresh.
  it('treats a backwards clock as stale rather than as fresh for longer', () => {
    expect(isFresh(entry, 999)).toBe(false);
  });
});

describe('fetchCached', () => {
  it('returns the parsed body', async () => {
    const users = await fetchCached<{ id: string }[]>('/api/users/lite');
    expect(users).toEqual([{ id: 'u1' }]);
    expect(calls).toEqual(['/api/users/lite']);
  });

  it('serves the second caller from memory', async () => {
    await fetchCached('/api/users/lite');
    await fetchCached('/api/users/lite');
    await fetchCached('/api/users/lite');
    expect(calls).toHaveLength(1);
  });

  it('refetches once the TTL has passed', async () => {
    await fetchCached('/api/users/lite', REFERENCE_TTL_MS);
    vi.advanceTimersByTime(REFERENCE_TTL_MS - 1);
    await fetchCached('/api/users/lite', REFERENCE_TTL_MS);
    expect(calls).toHaveLength(1);

    vi.advanceTimersByTime(2);
    await fetchCached('/api/users/lite', REFERENCE_TTL_MS);
    expect(calls).toHaveLength(2);
  });

  it('keeps different URLs apart, query string included', async () => {
    await fetchCached('/api/users/list?scope=sales');
    await fetchCached('/api/users/list?scope=handover');
    await fetchCached('/api/users/list?scope=sales');
    expect(calls).toEqual(['/api/users/list?scope=sales', '/api/users/list?scope=handover']);
  });

  // Three components mounting at once is the normal case on a cold screen,
  // and this is where most of the saving is: none of them can find a cache
  // entry, because the first request has not come back yet.
  it('shares one request between concurrent callers', async () => {
    const all = await Promise.all([
      fetchCached<{ id: string }[]>('/api/users/lite'),
      fetchCached<{ id: string }[]>('/api/users/lite'),
      fetchCached<{ id: string }[]>('/api/users/lite')
    ]);
    expect(calls).toHaveLength(1);
    // And all three get the data, not just the one that asked first.
    for (const result of all) expect(result).toEqual([{ id: 'u1' }]);
  });

  it('throws on a non-2xx so the caller keeps its own fallback', async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    await expect(fetchCached('/api/users/lite')).rejects.toThrow('503');
  });

  // The important one. A cached failure would leave the dropdown empty for
  // the whole TTL, long after the server recovered.
  it('does not cache a failure, and the next caller retries', async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await expect(fetchCached('/api/users/lite')).rejects.toThrow();
    expect(calls).toHaveLength(1);

    stubFetch(() => ({ body: [{ id: 'recovered' }] }));
    expect(await fetchCached('/api/users/lite')).toEqual([{ id: 'recovered' }]);
    expect(calls).toHaveLength(2);
  });

  it('does not leave a failed request behind to be shared', async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    const first = fetchCached('/api/users/lite');
    const second = fetchCached('/api/users/lite');
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();

    stubFetch();
    await expect(fetchCached('/api/users/lite')).resolves.toBeTruthy();
  });

  it('honours a shorter TTL for picker options', async () => {
    await fetchCached('/api/projects', OPTIONS_TTL_MS);
    vi.advanceTimersByTime(OPTIONS_TTL_MS + 1);
    await fetchCached('/api/projects', OPTIONS_TTL_MS);
    expect(calls).toHaveLength(2);
  });
});

// The race that makes invalidation real.
//
// A request that left BEFORE a write can come back AFTER it. Without a guard
// it stores the pre-write answer, which silently undoes the invalidation the
// write path just did — and the stale list then lives for the whole TTL. The
// symptom is "I added an employee and they are still not in the dropdown",
// which is the one complaint this cache must not cause.
describe('a request in flight when the cache is invalidated', () => {
  /** A fetch whose response can be released on command. */
  function deferredFetch(): { release: (body: unknown) => void } {
    let release!: (body: unknown) => void;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Promise((resolve) => {
        release = (body) => resolve({ ok: true, status: 200, json: async () => body } as Response);
      });
    }) as typeof fetch;
    return { release: (body) => release(body) };
  }

  it('does not store an answer that a single-URL invalidation has superseded', async () => {
    const gate = deferredFetch();
    const inFlight = fetchCached('/api/users/lite');

    invalidateCached('/api/users/lite'); // the write lands mid-request
    gate.release([{ id: 'stale' }]);
    // The caller still gets its value — only the caching is suppressed.
    expect(await inFlight).toEqual([{ id: 'stale' }]);

    stubFetch(() => ({ body: [{ id: 'fresh' }] }));
    expect(await fetchCached('/api/users/lite')).toEqual([{ id: 'fresh' }]);
  });

  it('does not store one that a PREFIX invalidation has superseded', async () => {
    const gate = deferredFetch();
    const inFlight = fetchCached('/api/users/list?scope=sales');

    invalidateCachedPrefix('/api/users/list');
    gate.release([{ id: 'stale' }]);
    await inFlight;

    stubFetch(() => ({ body: [{ id: 'fresh' }] }));
    expect(await fetchCached('/api/users/list?scope=sales')).toEqual([{ id: 'fresh' }]);
  });

  it('does not store one that invalidatePeopleCaches has superseded', async () => {
    const gate = deferredFetch();
    const inFlight = fetchCached('/api/technical-roster');

    invalidatePeopleCaches();
    gate.release([{ id: 'stale' }]);
    await inFlight;

    stubFetch(() => ({ body: [{ id: 'fresh' }] }));
    expect(await fetchCached('/api/technical-roster')).toEqual([{ id: 'fresh' }]);
  });

  // The session boundary, where storing the old answer would mean one user
  // reading data fetched for another.
  it('does not store one that a sign-out has superseded', async () => {
    const gate = deferredFetch();
    const inFlight = fetchCached('/api/users/lite');

    clearFetchCache();
    gate.release([{ id: 'previous-session' }]);
    await inFlight;

    stubFetch(() => ({ body: [{ id: 'this-session' }] }));
    expect(await fetchCached('/api/users/lite')).toEqual([{ id: 'this-session' }]);
  });

  // The ordinary case must still cache, or the guard has broken the feature
  // it exists to protect.
  it('still caches when nothing invalidated it', async () => {
    const gate = deferredFetch();
    const inFlight = fetchCached('/api/users/lite');
    gate.release([{ id: 'u1' }]);
    await inFlight;

    await fetchCached('/api/users/lite');
    expect(calls).toHaveLength(1);
  });
});

describe('invalidation', () => {
  it('drops one URL and leaves the rest', async () => {
    await fetchCached('/api/users/lite');
    await fetchCached('/api/departments');
    invalidateCached('/api/users/lite');

    await fetchCached('/api/users/lite');
    await fetchCached('/api/departments');
    expect(calls).toEqual(['/api/users/lite', '/api/departments', '/api/users/lite']);
  });

  // The scoped endpoints are the reason this exists: a write path should not
  // have to know which ?scope= some screen happened to read.
  it('drops every scope of an endpoint by prefix', async () => {
    await fetchCached('/api/users/list?scope=sales');
    await fetchCached('/api/users/list?scope=handover');
    invalidateCachedPrefix('/api/users/list');

    await fetchCached('/api/users/list?scope=sales');
    await fetchCached('/api/users/list?scope=handover');
    expect(calls).toHaveLength(4);
  });

  it('does not drop a URL that merely contains the prefix later on', async () => {
    await fetchCached('/api/tms/assignable-users');
    invalidateCachedPrefix('/api/users');
    await fetchCached('/api/tms/assignable-users');
    expect(calls).toHaveLength(1);
  });

  // Editing a user has to reach all six scoped views of the staff table,
  // because the caller cannot know which one the next screen reads.
  it('clears every people-shaped endpoint at once', async () => {
    const people = [
      '/api/users/lite',
      '/api/users/list?scope=sales',
      '/api/departments',
      '/api/departments/managers',
      '/api/technical-roster',
      '/api/tms/assignable-users',
      '/api/leads/assignees'
    ];
    for (const url of people) await fetchCached(url);
    expect(calls).toHaveLength(people.length);

    invalidatePeopleCaches();
    for (const url of people) await fetchCached(url);
    expect(calls).toHaveLength(people.length * 2);
  });

  // Live record lists are not cached at all, so invalidating people must not
  // pretend to cover them.
  it('leaves an unrelated cached URL alone', async () => {
    await fetchCached('/api/products');
    invalidatePeopleCaches();
    await fetchCached('/api/products');
    expect(calls).toHaveLength(1);
  });

  it('clears everything on sign-out', async () => {
    await fetchCached('/api/users/lite');
    await fetchCached('/api/products');
    clearFetchCache();
    await fetchCached('/api/users/lite');
    await fetchCached('/api/products');
    expect(calls).toHaveLength(4);
  });
});
