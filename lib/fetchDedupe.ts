'use client';

// App-wide de-duplication of IDENTICAL, CONCURRENT GET requests to our own
// API (/api/...).
//
// Why: the same request was regularly sent twice at the same moment —
//   - React Strict Mode (on in development) mounts every component twice, so
//     every "fetch on mount" fired twice: notifications, dashboard, health,
//     celebrations, appreciations… all doubled on a dashboard load;
//   - two components on one screen asking for the same list on mount.
// The second caller now joins the request that is already in flight and gets
// its own clone of the same Response. Nothing is CACHED: once the response
// arrives the entry is dropped, so the next call after that is a real,
// fresh request. Live data stays live.
//
// Deliberately narrow — only joined when all of these hold:
//   - GET (or no method), no body
//   - same-origin URL under /api/
//   - no AbortSignal (one caller aborting must never cancel another's request)
//   - same headers (part of the key)
// Everything else goes straight to the real fetch, untouched.

type FetchFn = typeof fetch;

const inflight = new Map<string, Promise<Response>>();

function apiPath(input: RequestInfo | URL): string | null {
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.href;
  else return null; // a Request object may carry a body/signal — leave it alone
  if (raw.startsWith('/api/')) return raw;
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(raw, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) return u.pathname + u.search;
    } catch {
      return null;
    }
  }
  return null;
}

function headerKey(headers: HeadersInit | undefined): string {
  if (!headers) return '';
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  return JSON.stringify(entries.map(([k, v]) => [k.toLowerCase(), v]).sort());
}

/** The key two requests must share to be joined, or null if this request must not be joined. Exported for tests. */
export function dedupeKey(input: RequestInfo | URL, init?: RequestInit): string | null {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET') return null;
  if (init?.body != null || init?.signal) return null;
  const path = apiPath(input);
  if (!path) return null;
  return `${path}|${headerKey(init?.headers)}`;
}

/** Wraps a fetch implementation with in-flight GET de-duplication. Exported for tests. */
export function withFetchDedupe(realFetch: FetchFn): FetchFn {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const key = dedupeKey(input, init);
    if (!key) return realFetch(input, init);
    let shared = inflight.get(key);
    if (!shared) {
      shared = realFetch(input, init);
      inflight.set(key, shared);
      const drop = () => {
        if (inflight.get(key) === shared) inflight.delete(key);
      };
      shared.then(drop, drop);
    }
    // Every caller — the first included — gets its own clone, so each can
    // read the body independently; the shared original is never consumed.
    return shared.then((res) => res.clone());
  };
  return wrapped as FetchFn;
}

const INSTALLED = Symbol.for('mx.fetchDedupe.installed');

/** Installs the wrapper on window.fetch once. Runs at module load so it is in place before any component's effects. */
export function installFetchDedupe(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<symbol, boolean> & { fetch: FetchFn };
  if (w[INSTALLED]) return;
  w.fetch = withFetchDedupe(w.fetch.bind(window));
  w[INSTALLED] = true;
}

installFetchDedupe();
