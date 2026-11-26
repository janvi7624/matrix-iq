import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Minimal browser globals for the store (it persists to sessionStorage).
const storage = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  }
};

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

const SIDEBAR = { modules: [{ key: 'leads', href: '/leads', section: 'Sales' }], viewer: { username: 'u', name: 'U', role: 'user', isPrivileged: true }, badges: { leads: 3 } };

async function freshStore() {
  vi.resetModules();
  const fc = await import('../../lib/fetchCached');
  const store = await import('../../lib/shellDataStore');
  return { ...store, clearFetchCache: fc.clearFetchCache };
}

beforeEach(() => {
  storage.clear();
  fetchMock.mockReset();
});

describe('shellDataStore — sidebar fetched once per login', () => {
  it('concurrent callers share one request, later callers make none', async () => {
    const s = await freshStore();
    fetchMock.mockImplementation(() => ok(SIDEBAR));
    const [a, b] = await Promise.all([s.loadSidebarData(), s.loadSidebarData()]);
    await s.loadSidebarData();
    await s.loadSidebarData();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/sidebar');
    expect(a).toEqual(b);
    expect(a?.badges.leads).toBe(3);
  });

  it('survives a full reload of the tab via sessionStorage (no new request)', async () => {
    let s = await freshStore();
    fetchMock.mockImplementation(() => ok(SIDEBAR));
    await s.loadSidebarData();
    s = await freshStore(); // simulates a reload: new module instance, same sessionStorage
    const again = await s.loadSidebarData();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again?.viewer?.username).toBe('u');
  });

  it('does not cache a failure, so the next mount retries', async () => {
    const s = await freshStore();
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }));
    expect(await s.loadSidebarData()).toBeNull();
    fetchMock.mockImplementation(() => ok(SIDEBAR));
    expect(await s.loadSidebarData()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sign-out (clearFetchCache) forgets it, including the sessionStorage copy', async () => {
    const s = await freshStore();
    fetchMock.mockImplementation(() => ok(SIDEBAR));
    await s.loadSidebarData();
    s.clearFetchCache();
    expect(storage.size).toBe(0);
    await s.loadSidebarData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a response that lands after sign-out is not stored', async () => {
    const s = await freshStore();
    let resolve!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = s.loadSidebarData();
    s.clearShellData();
    resolve({ ok: true, json: () => Promise.resolve(SIDEBAR) });
    expect(await pending).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('refreshShellData re-requests on purpose (Module Manager save)', async () => {
    const s = await freshStore();
    fetchMock.mockImplementation(() => ok(SIDEBAR));
    await s.loadSidebarData();
    await s.refreshShellData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('shellDataStore — quick actions fetched once', () => {
  it('loads once and records a save without refetching', async () => {
    const s = await freshStore();
    fetchMock.mockImplementation(() => ok({ keys: ['leads'], max: 6 }));
    await s.loadQuickActions();
    await s.loadQuickActions();
    s.setQuickActionKeys(['leads', 'projects']);
    const after = await s.loadQuickActions();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(after?.keys).toEqual(['leads', 'projects']);
    expect(after?.max).toBe(6);
  });
});

describe('link prefetching is off app-wide', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) return n === 'node_modules' || n === '.next' ? [] : tsxFiles(full);
      return /\.tsx?$/.test(n) ? [full] : [];
    });
  }

  it('no file imports next/link directly except the AppLink wrapper', () => {
    const root = join(__dirname, '..', '..');
    const offenders = [...tsxFiles(join(root, 'components')), ...tsxFiles(join(root, 'app'))]
      .filter((f) => !f.endsWith(join('ui', 'AppLink.tsx')))
      .filter((f) => /from ['"]next\/link['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('AppLink defaults prefetch to false', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'ui', 'AppLink.tsx'), 'utf8');
    expect(src).toMatch(/prefetch = false/);
  });
});
