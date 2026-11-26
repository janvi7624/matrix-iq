import { describe, it, expect, vi } from 'vitest';
import { dedupeKey, withFetchDedupe } from '../../lib/fetchDedupe';
import { shouldRefreshOnReturn, DEFAULT_REFRESH_MS } from '../../lib/useAutoRefresh';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('dedupeKey — which requests may be joined', () => {
  it('joins plain GETs to our API', () => {
    expect(dedupeKey('/api/dashboard')).not.toBeNull();
    expect(dedupeKey('/api/dashboard', { method: 'get' })).toBe(dedupeKey('/api/dashboard'));
  });

  it('never joins writes, bodies or abortable requests', () => {
    expect(dedupeKey('/api/notifications', { method: 'PATCH' })).toBeNull();
    expect(dedupeKey('/api/x', { method: 'POST', body: '{}' })).toBeNull();
    expect(dedupeKey('/api/x', { signal: new AbortController().signal })).toBeNull();
  });

  it('never joins non-API or external URLs', () => {
    expect(dedupeKey('/login')).toBeNull();
    expect(dedupeKey('https://example.com/api/x')).toBeNull();
  });

  it('keys on query string and headers', () => {
    expect(dedupeKey('/api/a?x=1')).not.toBe(dedupeKey('/api/a?x=2'));
    expect(dedupeKey('/api/a', { headers: { accept: 'text/csv' } })).not.toBe(dedupeKey('/api/a'));
  });
});

describe('withFetchDedupe', () => {
  it('concurrent identical GETs make ONE network request; each caller reads its own body', async () => {
    const real = vi.fn(async () => jsonResponse({ n: 1 }));
    const f = withFetchDedupe(real as unknown as typeof fetch);
    // What React Strict Mode does: the same effect fires twice at once.
    const [a, b] = await Promise.all([f('/api/dashboard'), f('/api/dashboard')]);
    expect(real).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
  });

  it('does not cache: a later call after the first finished is a fresh request', async () => {
    const real = vi.fn(async () => jsonResponse({}));
    const f = withFetchDedupe(real as unknown as typeof fetch);
    await f('/api/health');
    await f('/api/health');
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('different URLs are independent', async () => {
    const real = vi.fn(async () => jsonResponse({}));
    const f = withFetchDedupe(real as unknown as typeof fetch);
    await Promise.all([f('/api/a'), f('/api/b')]);
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('a failure reaches every joined caller and is not kept', async () => {
    const real = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(jsonResponse({}));
    const f = withFetchDedupe(real as unknown as typeof fetch);
    const results = await Promise.allSettled([f('/api/x'), f('/api/x')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await expect(f('/api/x')).resolves.toBeInstanceOf(Response);
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('writes are never joined', async () => {
    const real = vi.fn(async () => jsonResponse({}));
    const f = withFetchDedupe(real as unknown as typeof fetch);
    await Promise.all([f('/api/x', { method: 'PATCH', body: '{}' }), f('/api/x', { method: 'PATCH', body: '{}' })]);
    expect(real).toHaveBeenCalledTimes(2);
  });
});

describe('shouldRefreshOnReturn — returning to the tab', () => {
  const t0 = 1_000_000;
  it('does not refetch when the data on screen is still fresh', () => {
    expect(shouldRefreshOnReturn(t0, t0 + 5_000, DEFAULT_REFRESH_MS)).toBe(false);
    expect(shouldRefreshOnReturn(t0, t0 + DEFAULT_REFRESH_MS - 1, DEFAULT_REFRESH_MS)).toBe(false);
  });
  it('refetches once the data is stale', () => {
    expect(shouldRefreshOnReturn(t0, t0 + DEFAULT_REFRESH_MS, DEFAULT_REFRESH_MS)).toBe(true);
  });
});
