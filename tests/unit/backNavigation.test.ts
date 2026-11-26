import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  PAGE_ROUTES,
  resolveFallbackRoute,
  recordNavigation,
  hasPreviousInAppScreen,
  parseNavStack,
  NAV_STACK_LIMIT
} from '../../lib/backNavigation';

const APP_DIR = join(__dirname, '..', '..', 'app');

function findPages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'api') continue;
      out.push(...findPages(full));
    } else if (name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

/** A page whose whole body is a redirect() — never a real back target. */
function isRedirectOnly(file: string): boolean {
  const src = readFileSync(file, 'utf8');
  return /^\s*redirect\(/m.test(src) && !/return\s*\(?\s*</.test(src) && !/<[A-Z]/.test(src);
}

describe('PAGE_ROUTES', () => {
  it('lists exactly the non-redirect pages under app/', () => {
    const actual = findPages(APP_DIR)
      .filter((f) => !isRedirectOnly(f))
      .map((f) => {
        const rel = relative(APP_DIR, f).split(sep).slice(0, -1).join('/');
        return rel ? `/${rel}` : '/';
      })
      .sort();
    expect([...PAGE_ROUTES].sort()).toEqual(actual);
  });
});

describe('resolveFallbackRoute', () => {
  it.each([
    ['/tms/tasks/abc-123', '/tms/tasks'],
    ['/tms/bom-requests/9', '/tms/bom-requests'],
    ['/projects/42', '/projects'],
    ['/admin/users/import', '/admin/users'],
    ['/admin/users/7', '/admin/users'],
    ['/admin/partners/analytics', '/admin/partners'],
    ['/admin-expenses/b1/edit', '/admin-expenses'],
    ['/office-operation-expenses/new', '/office-operation-expenses'],
    ['/travel-schedule/5', '/travel-schedule'],
    ['/my-tasks/1', '/my-tasks'],
    ['/support/77', '/support'],
    ['/partners/new', '/partners'],
    // No /hr, /admin or /tms page exists (the last is a redirect) → dashboard.
    ['/hr/attendance', '/'],
    ['/admin/settings', '/'],
    ['/tms/team', '/'],
    ['/leads', '/'],
    ['/', '/']
  ])('%s → %s', (path, expected) => {
    expect(resolveFallbackRoute(path)).toBe(expected);
  });

  it('roots partner pages at the portal home', () => {
    expect(resolveFallbackRoute('/partner/projects/3', '/partner')).toBe('/partner/projects');
    expect(resolveFallbackRoute('/partner/team', '/partner')).toBe('/partner');
  });

  it('ignores query strings, hashes and trailing slashes', () => {
    expect(resolveFallbackRoute('/tms/tasks/1/?tab=x#y')).toBe('/tms/tasks');
  });

  it('only ever returns a real static page (or the root)', () => {
    const statics = new Set(PAGE_ROUTES.filter((r) => !r.includes('[')));
    for (const route of PAGE_ROUTES.filter((r) => r !== '/')) {
      const concrete = route.replace(/\[[^\]]+\]/g, 'x');
      const target = resolveFallbackRoute(concrete);
      expect(statics.has(target)).toBe(true);
      expect(target).not.toBe(concrete);
    }
  });
});

describe('recordNavigation / hasPreviousInAppScreen', () => {
  it('first landing has no previous screen', () => {
    const s = recordNavigation([], '/leads');
    expect(s).toEqual(['/leads']);
    expect(hasPreviousInAppScreen(s)).toBe(false);
  });

  it('pushes forward navigations', () => {
    let s = recordNavigation([], '/leads');
    s = recordNavigation(s, '/projects');
    s = recordNavigation(s, '/projects/1');
    expect(s).toEqual(['/leads', '/projects', '/projects/1']);
    expect(hasPreviousInAppScreen(s)).toBe(true);
  });

  it('pops when the user goes back to the previous entry', () => {
    const s = recordNavigation(['/leads', '/projects', '/projects/1'], '/projects');
    expect(s).toEqual(['/leads', '/projects']);
  });

  it('is idempotent for re-renders, reloads and query-only changes', () => {
    expect(recordNavigation(['/a', '/b'], '/b')).toEqual(['/a', '/b']);
    expect(recordNavigation(['/a', '/b'], '/b?tab=2')).toEqual(['/a', '/b']);
  });

  it('caps the stack length', () => {
    let s: string[] = [];
    for (let i = 0; i < NAV_STACK_LIMIT + 20; i++) s = recordNavigation(s, `/p/${i}`);
    expect(s.length).toBe(NAV_STACK_LIMIT);
    expect(s[s.length - 1]).toBe(`/p/${NAV_STACK_LIMIT + 19}`);
  });
});

describe('parseNavStack', () => {
  it('tolerates missing or corrupt storage', () => {
    expect(parseNavStack(null)).toEqual([]);
    expect(parseNavStack('not json')).toEqual([]);
    expect(parseNavStack('{"a":1}')).toEqual([]);
    expect(parseNavStack('["/a", 3, "/b"]')).toEqual(['/a', '/b']);
  });
});
